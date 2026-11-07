#!/bin/sh
# Final rollout of everything in deploy/openshift, in order. Run from the repo root on the commit to ship:
#   sh deploy/openshift/rollout.sh
# Optional, combine as needed:
#   REUSE_GATE_LLM_TIERS=together,featherless          model tiers in order (while Aitta is down)
#   REUSE_GATE_DECISION_BACKEND=kserve                  decisions on the KServe InferenceService; the default stays local
#   REUSE_GATE_KSERVE_URL=http://...                    only to override the in-cluster predictor URL below
# Example: REUSE_GATE_DECISION_BACKEND=kserve REUSE_GATE_LLM_TIERS=together,featherless sh deploy/openshift/rollout.sh
# Builds come from a clean git archive export, never from the working directory. Prints no key.
set -eu
NS=${NS:-ztothez-dev}
API_URL=${REUSE_GATE_API_URL:-https://reuse-gate-$NS.apps.rm1.0a51.p1.openshiftapps.com}
BACKEND=${REUSE_GATE_DECISION_BACKEND:-local}
KSERVE_URL=${REUSE_GATE_KSERVE_URL:-http://reuse-gate-kserve-predictor.$NS.svc.cluster.local}
case "$BACKEND" in local|kserve) ;; *) echo "REUSE_GATE_DECISION_BACKEND must be local or kserve"; exit 1 ;; esac
oc whoami >/dev/null
oc project "$NS" >/dev/null
git diff --quiet HEAD -- backend scripts data Containerfile deploy frontend || { echo "uncommitted changes: commit first, the build uses HEAD"; exit 1; }

echo "== 1. secrets: key names only"
for s in reuse-gate-llm reuse-gate-elevenlabs reuse-gate-n8n reuse-gate-access; do
  keys=$(oc get secret "$s" -o go-template='{{range $k, $v := .data}}{{$k}} {{end}}' 2>/dev/null || true)
  echo "  $s: ${keys:-missing (optional; see deploy/openshift/secrets.template.yaml)}"
done

echo "== 2. API image from a clean export of HEAD"
EXPORT=$(mktemp -d)
git archive HEAD | tar -x -C "$EXPORT"
oc start-build reuse-gate --from-dir="$EXPORT" --follow --wait
rm -rf "$EXPORT"

echo "== 3. ServingRuntime and InferenceService, Tekton pipeline, PingSource"
oc apply -f deploy/openshift/inferenceservice.yaml
oc apply -f deploy/openshift/tekton-pipeline.yaml
oc apply -f deploy/openshift/pingsource.yaml
oc wait --for=condition=Ready isvc/reuse-gate-kserve --timeout=300s

echo "== 4. pipeline: unit tests, governance, evaluation and security gates on the new image, then restart API and predictor"
RUN=$(oc create -o name -f - <<'EOF'
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: reuse-gate-verify-
spec:
  pipelineRef: {name: reuse-gate-verify}
  taskRunTemplate: {serviceAccountName: pipeline}
EOF
)
echo "  $RUN"
oc wait --for=condition=Succeeded "$RUN" --timeout=20m || { oc get "$RUN" -o jsonpath='{.status.conditions[0].message}'; echo; exit 1; }

echo "== 5. API manifest: state volume, probes, security context, KServe decision path"
oc apply -f deploy/openshift/api.yaml
if [ -n "${REUSE_GATE_LLM_TIERS:-}" ]; then
  oc set env deploy/reuse-gate REUSE_GATE_LLM_TIERS="$REUSE_GATE_LLM_TIERS"
fi
if [ "$BACKEND" = kserve ]; then
  oc set env deploy/reuse-gate REUSE_GATE_DECISION_BACKEND=kserve REUSE_GATE_KSERVE_URL="$KSERVE_URL" REUSE_GATE_KSERVE_MODEL=reuse-gate-kserve
fi
oc rollout status deploy/reuse-gate --timeout=300s

echo "== 5b. decision backend check: /healthz (asked for: $BACKEND)"
HEALTH=""
for i in $(seq 1 12); do
  HEALTH=$(curl -s -m 15 "$API_URL/healthz" || true)
  echo "$HEALTH" | grep -q '"ok": true' && break
  sleep 5
done
echo "  $HEALTH"
if [ "$BACKEND" = kserve ]; then
  # /healthz checks KServe at most every 30 seconds; ask again until it reports reachable or a minute passes
  for i in $(seq 1 7); do
    echo "$HEALTH" | grep -q '"decision_backend": "kserve"' && echo "$HEALTH" | grep -q '"reachable": true' && break
    sleep 10
    HEALTH=$(curl -s -m 15 "$API_URL/healthz" || true)
  done
  if echo "$HEALTH" | grep -q '"decision_backend": "kserve"' && echo "$HEALTH" | grep -q '"reachable": true'; then
    echo "  OK: decisions go to reuse-gate-kserve, and it is reachable from the API"
  else
    echo "  FAILED: asked for kserve, but /healthz says: $HEALTH"
    echo "  Decisions still work (local_fallback). To go back to local: oc set env deploy/reuse-gate REUSE_GATE_DECISION_BACKEND=local"
    exit 1
  fi
fi

echo "== 6. UI image from a clean export of frontend/, then roll out"
oc apply -f deploy/openshift/frontend.yaml
EXPORT=$(mktemp -d)
git archive HEAD:frontend | tar -x -C "$EXPORT"
oc start-build reuse-gate-ui --from-dir="$EXPORT" --follow --wait
rm -rf "$EXPORT"
oc rollout restart deploy/reuse-gate-ui
oc rollout status deploy/reuse-gate-ui --timeout=300s

echo "== 7. wake and check"
sh deploy/openshift/wake.sh
