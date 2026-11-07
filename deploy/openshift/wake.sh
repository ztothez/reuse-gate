#!/bin/sh
# Wake the demo after the Sandbox has recycled or idled the pods, and say what is ready. Safe to run again and again.
# It only scales a Deployment back to 1 when the Sandbox scaled it to 0, waits, warms the models and checks each part.
# Run from the repo root: sh deploy/openshift/wake.sh     Exit 0 when every part is green, 1 otherwise.
set -u
NS=${NS:-ztothez-dev}
APPS=${APPS:-apps.rm1.0a51.p1.openshiftapps.com}
API=${REUSE_GATE_API_URL:-https://reuse-gate-$NS.$APPS}
UI=https://reuse-gate-ui-$NS.$APPS
KSERVE=https://reuse-gate-kserve-$NS.$APPS
FAILED=0
green() { printf '\033[32mGREEN\033[0m %s\n' "$1"; }
red() { printf '\033[31mRED\033[0m   %s\n' "$1"; FAILED=1; }
yellow() { printf '\033[33mAMBER\033[0m %s\n' "$1"; }

if ! WHO=$(oc whoami 2>/dev/null); then
  red "not logged in: run oc login first"
  exit 1
fi
echo "logged in as $WHO, project $NS"

for d in reuse-gate reuse-gate-ui reuse-gate-kserve-predictor; do
  replicas=$(oc -n "$NS" get deploy "$d" -o jsonpath='{.spec.replicas}' 2>/dev/null)
  if [ -z "$replicas" ]; then
    red "$d: no such Deployment"
    continue
  fi
  if [ "$replicas" = 0 ]; then
    echo "$d was scaled to 0 by the Sandbox, scaling to 1"
    oc -n "$NS" scale deploy "$d" --replicas=1 >/dev/null
  fi
done
oc -n "$NS" get pods -l 'app in (reuse-gate,reuse-gate-ui)' --no-headers 2>/dev/null
oc -n "$NS" get pods -l serving.kserve.io/inferenceservice=reuse-gate-kserve --no-headers 2>/dev/null
for d in reuse-gate reuse-gate-ui reuse-gate-kserve-predictor; do
  if oc -n "$NS" rollout status deploy "$d" --timeout=240s >/dev/null 2>&1; then green "$d pods ready"; else red "$d pods not ready after 240s"; fi
done
if [ "$(oc -n "$NS" get isvc reuse-gate-kserve -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = True ]; then
  green "InferenceService reuse-gate-kserve Ready"
else
  red "InferenceService reuse-gate-kserve not Ready"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$UI/")
[ "$code" = 200 ] && green "UI $UI" || red "UI $UI answered $code"

health=$(curl -s -m 20 "$API/healthz")
if echo "$health" | grep -q '"ok": true'; then
  backend=$(echo "$health" | python3 -c 'import json,sys; h=json.load(sys.stdin); k=h.get("kserve") or {}; print(h.get("decision_backend"), "kserve reachable:", k.get("reachable"))' 2>/dev/null)
  green "API $API ($backend)"
  echo "$backend" | grep -q "^kserve kserve reachable: False" && red "API is in kserve mode but cannot reach KServe: decisions fall back to local"
else
  red "API $API did not answer /healthz"
fi

if curl -s -m 20 "$KSERVE/v1/models/reuse-gate-kserve" | grep -q '"ready": true'; then green "KServe route $KSERVE"; else red "KServe route $KSERVE not ready"; fi

python3 -I scripts/warmup.py "$API"
case $? in
  0) green "models: first tier ready" ;;
  1) yellow "models: only a later tier ready, the demo runs on the fallback" ;;
  *) red "models: no tier ready, the demo runs on the rules" ;;
esac

[ "$FAILED" = 0 ] && echo "all green" || echo "something is red, see above"
exit "$FAILED"
