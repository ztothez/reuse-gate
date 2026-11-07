# Send decisions through reuse-gate-kserve

Not applied. The API decides in-process until this is set.

The one-line change on the running API Deployment:

```bash
oc set env deploy/reuse-gate REUSE_GATE_DECISION_BACKEND=kserve REUSE_GATE_KSERVE_URL=http://reuse-gate-kserve-predictor.ztothez-dev.svc.cluster.local REUSE_GATE_KSERVE_MODEL=reuse-gate-kserve
```

The same in YAML, under the `api` container's `env` in `deploy/openshift/api.yaml`:

```yaml
- {name: REUSE_GATE_DECISION_BACKEND, value: kserve}
- {name: REUSE_GATE_KSERVE_URL, value: "http://reuse-gate-kserve-predictor.ztothez-dev.svc.cluster.local"}
- {name: REUSE_GATE_KSERVE_MODEL, value: reuse-gate-kserve}
```

## Order

1. The predictor must run an image built from this commit or later: older predictors only accept `{"text": ...}` and answer
   the intent call with HTTP 400, which the API records as `local_fallback` with reason `http_400`. After the image build,
   restart it: `oc rollout restart deploy/reuse-gate-kserve-predictor`.
2. Then set the variables on the API. Setting them restarts the API pod.

## Check

```bash
API=https://reuse-gate-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com
curl -s $API/healthz                       # "decision_backend": "kserve", "kserve": {"reachable": true}
curl -s -X POST $API/recommend -H 'Content-Type: application/json' \
  -d '{"text":"I need a dashboard for Nubeqa net sales by region in EMEA"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["decision_backend"], d.get("decision_backend_reason"), d["ai"]["tier"])'
```

`kserve` means the predictor decided. `local_fallback` plus a reason (`timeout`, `unreachable`, `http_<code>`, `bad_response`,
`estate_mismatch`, `not_configured`) means the API decided itself because the predictor did not give a usable answer.
`estate_mismatch` means the predictor runs on a different `estate.db` than the API, so its answer was not used.

## Turn it off

```bash
oc set env deploy/reuse-gate REUSE_GATE_DECISION_BACKEND=local
```
