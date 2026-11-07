# Reuse Gate progress

Last updated: 2026-11-07. Everything below reflects what was actually run. Anything not verified says so.

## Results
| Check | Result |
| --- | --- |
| All Python tests (`python3 -m unittest discover -s backend/tests -t backend -p 'test_*.py'`) | 179 pass |
| Frontend tests (`npm test`), TypeScript | 28 pass, no type errors, production build passes |
| Baseline (`scripts/run_batch.py`) | 57/150 avoid a new build, 1098 citations, 0 invalid. New builds 93, extend 31, repair 4, retire 2, consolidate later 2. A test enforces these numbers |
| Spec gates over 150 requests | 124 specs, 13 pass every gate, 111 blocked with a named reason, 0 crashes |
| Edge cases | 24 cases, all end in a safe, explained outcome |
| Live API (`reuse-gate` route) | `/health` ok. A fresh request answered by `openai/gpt-oss-120b` (`ai.intent_source` = `llm`) in 11.3 seconds. All 10 chips answered from the saved file in under a second, with no model call |
| Live KServe `:predict` | Cited decision (`AST-0209`, 24 citations), `ai.source` = `rules` |
| PipelineRun `reuse-gate-verify-bsqjv` | Succeeded: unit tests (179 run, 4 skipped because frontend and deploy files are not in the image), governance gate, rollout |
| Live evaluation | 4 backends, 10 requests each, see `docs/eval_results.md` |

## Done
1. **State check:** this file.
2. **Frontend end to end:** ran against the live API in headless Chromium: request, flow view, approval, spec and gates, Radar, Decision log, with no console errors. Response shapes match `data/mock_api.json`, and the new fields (`pipeline`, `gates`) are additive.
   Fixed: dropped connections on non-object JSON, a 4xx silently switching to demo data, the stale frontend mock.
3. **Spec gates and edge cases:** `backend/reuse_gate/spec_gate.py`, `backend/reuse_gate/edge_cases.py`, `backend/tests/test_spec_gate.py`, `backend/tests/test_edge_cases.py`, `docs/quality_report.md`, `docs/edge_cases.md`.
   **Flow view:** `backend/reuse_gate/pipeline.py` is the one path for API, mock and tests. `FlowView.tsx` shows Intent, Evidence, Decision, Spec and Gates with the input and output of each.
4. **Live evaluation:** `scripts/eval_intent.py`, `docs/eval_report.json`, `docs/eval_results.md`, and the first prompt version in `docs/eval_results_prompt_v1.md`. Recommended backend: `openai/gpt-oss-120b`.
5. **Embeddings:** both models work on Aitta. `backend/reuse_gate/kpi_match.py` uses `intfloat/multilingual-e5-large`, threshold 0.8, LLM confirms, requester confirms. Probe: 12/16 correct, `docs/embedding_probe.md`. Worked live on one Finnish request.
6. **n8n:** `deploy/n8n/approval_workflow.json` and `deploy/n8n/radar_digest_workflow.json`, verified in n8n 2.46.6: import, webhook 403 without key, 200 valid, 400 invalid, digest run status success.
7. **README:** deployment and governance, data assumptions, AI approach, limitations, edge-case table.
- **Not Pharma-specific:** division vocabulary moved to `data/catalog.json`, and a test keeps division terms out of the logic files.
- **Ad hoc market:** read from the request text in `backend/reuse_gate/recommend.py` (`resolve_market`, aliases in `data/catalog.json`). Batch requests keep their metadata market. Checked in the browser and through the live LLM path.
- **KPI coverage:** the rationale, `target.coverage`, citations and the frontend target card list covered KPIs with `Asset_KPI_Map` ids. A test keeps both mock files equal to the pipeline output.
- **Clarification loop:** answers go back to `/recommend`, are applied by field, and the request is decided again, replacing the result. Tested in Python, in the frontend, over HTTP, and in a browser with real models.
- **Live backends:** gpt-oss-120b on Aitta, automatic fallback to GLM-5.2 on Featherless, then the rules. `scripts/warmup.py` ran against all three models. Failover was forced with a dead primary, and GLM-5.2 answered live.
- **Retire rule:** retire only low-usage, uncertified duplicates of the target. Every other overlapping asset goes to "consolidate later" with its note. All are cited. The UI shows 5 per list and "+N more".
- **Listen button:** `POST /speak` and `ListenButton.tsx`, verified with a live ElevenLabs call and in a browser. The owner has listened to the audio and accepted the voice. The key comes only from `ELEVENLABS_API_KEY`, which `.env` now uses, and audio is cached on disk by the sha256 of the text.
- **Radar ping:** `POST /radar-ping` returns the digest with no key for a Knative PingSource. Read-only, and it ignores the body.
- **Primary KPI rule:** a target must cover a requested KPI as primary. Secondary rows are shown and cited but not counted. The canonical-only version (33/150) is measured in `docs/quality_report.md` for information, and the rule does not use it.
- **Repo layout:** reorganized into `backend/reuse_gate`, `backend/tests`, `scripts`, `data`, `deploy`, `docs` and `frontend` with no behavior change: API responses, batch output and mock data were compared with the previous layout and are identical. `frontend/package-lock.json` replaces `bun.lock`.
- **OpenShift rollout:** the Reliability work is live on image digest `e7eccf8b5e28`, built from a clean `git archive` export. The API has the model and audio keys through the cluster secrets `reuse-gate-llm` and `reuse-gate-elevenlabs`, and the n8n key through `reuse-gate-n8n`, all declared in `deploy/openshift/api.yaml`. The KServe predictor has no keys, so it serves the decision logic only.
- **Work items (not on the cluster yet):** `POST /requests`, `GET /requests`, `GET /requests/{id}`, statuses, an activity trail, 10 seeded samples, and an optional write token. `backend/reuse_gate/workitems.py`, `backend/tests/test_workitems.py`.
- **Ownership remediation (not on the cluster yet):** all 80 SM-065 specs fail only on the owner gates. One active owner on SM-065 makes all 80 pass. `POST /remediate` simulates owner assignments on an in-memory copy, `/approve` stores a server-built record, and Radar has `ownership_bottlenecks`. `backend/reuse_gate/remediate.py`, `backend/tests/test_remediate.py`. Decisions were compared with the previous commit on 150 batch requests, 10 chips and 24 edge cases: identical.
- **Clarification loop (not on the cluster yet):** per-field confidence, up to 3 rounds, rules choose the questions, the model only words them, every round is recorded, and the loop ends clear or in `human_review`. `backend/reuse_gate/clarify.py`, `backend/tests/test_clarify.py`. Clean decisions were compared with the previous commit across 150 batch requests, 10 ad hoc requests and 10 saved chips: identical. Edge cases: same actions, and the Finnish and German questions now propose a KPI.
- **Messy to clean:** `data/messy_requests.jsonl`, `scripts/eval_messy.py`, `docs/messy_to_clean.md`.
- **Flow view:** shows the rounds, the intent diff and confidence, and uses Bayer's legend on each stage. Checked in a browser with the rules only.
- **Estate impact:** before-and-after figure in `docs/quality_report.md` and `docs/estate_impact.svg`. A projection, not a measurement.
- **Deployed UI:** static site at https://reuse-gate-ui-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com, built from a clean `git archive` export. Checked in headless Chromium against the live API: request, Listen, approval, Decision log and Radar all work, with no demo badge and no console errors. `STATIC_SPA=1` prerenders the page; `npm run dev` and the default build are unchanged.
- **Reliability:** fallback on 429, 5xx, timeouts and truncated responses, 20 seconds per Aitta call, 40 per GLM-5.2 call, 60 per request, a 90-second route timeout, a global concurrency limit, answers saved by normalized text, and a visible source line with the reason. Decisions were compared with the previous commit and are identical. Tested in a browser with both providers unreachable.
- **Example chips:** `data/prewarmed_answers.json` was regenerated with real models. 6 of 10 chips have AI intents and AI explanations, and 4 use the rules by design because the model gave no usable KPI.
- **Repo:** private at `ztothez/reuse-gate`, with `main` and `reuse-gate-build` pushed.
- **Data pack:** committed as `1a0d8ce`, synthetic, created by SinceAI. `.env` is ignored.

## Not done or not verified
- Demo recording and pitch outline: not started.
- `Bayer_SinceAI2026/` PDF and docx files are not committed. The permission covers the data pack only.
- `deploy/openshift/api.yaml` passes a server dry run but has not been applied. The live deployment got the same secret references through `oc set env`, and its route timeout through `oc annotate`.
- The failure paths are tested with simulated failures and local servers, not against a real Aitta 429.
- n8n ran on a throwaway local instance. The digest is not connected to email or Teams, and the PingSource's scheduled run has not been observed.
- `data/mock_api.json` has `owners`, `radar.ownership_bottlenecks` and `work_items`, but the frontend copy must be synced with `cp data/mock_api.json frontend/src/data/mock_api.json`. The frontend has no screen for work items, `/remediate` or the record.
- Work items and the decision log are files in the pod with no volume, so a restart loses them.
- The live API and UI do not have the clarification loop yet. Model wording is tested with a fake client, not a real model.
- `MESSY-21` ("not Xarelto") stays wrong: the rules do not read negation. The messy vocabulary was written with those prompts in view.
- The UI's Decision log is stored per browser in `localStorage`, so a fresh browser shows it empty even when the API's `GET /log` has entries.
- Paths with no route (only `/` exists) show the app's 404 page, with a recovered React hydration error in the console.
- The catalog swap is tested with a sample catalog, not a real second division estate.
- ESLint still flags `react-refresh/only-export-components` (7) and one `no-unused-expressions` in the frontend. They do not affect behaviour.

## Known limitations
See "Honest limitations" in `README.md`.

## How to run
```bash
python3 -m unittest discover -s backend/tests -t backend -p 'test_*.py'
python3 -I scripts/run_batch.py data/estate.db
python3 -I scripts/eval_intent.py data/estate.db     # cached, so a rerun is nearly free
python3 -I scripts/embed_probe.py data/estate.db
python3 -I scripts/warmup.py
export PYTHONPATH=backend
python3 -m reuse_gate.spec_gate data/estate.db
python3 -m reuse_gate.edge_cases data/estate.db docs/edge_cases.md
python3 -m reuse_gate.server data/estate.db 8000     # reads .env
cd frontend && npm ci && npm test && VITE_API_URL=http://localhost:8000 npm run dev
```
Vite needs Node 20.19+ or 22.12+. The frontend tests last ran on Node 22.
