#!/bin/sh
# Final rollout of everything in deploy/openshift, in order. Run from the repo root on the commit to ship:
#   sh deploy/openshift/rollout.sh
# Optional: REUSE_GATE_LLM_TIERS=together,featherless sh deploy/openshift/rollout.sh   (while Aitta is down)
# Builds come from a clean git archive export, never from the working directory. Prints no key.
set -eu
NS=${NS:-ztothez-dev}
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
oc rollout status deploy/reuse-gate --timeout=300s

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
