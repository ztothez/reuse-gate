# Reuse Gate progress

Last updated: 2026-11-07. Everything below reflects what was actually run. Anything not verified says so.

## Results
| Check | Result |
| --- | --- |
| Python tests (`test_recommend`, `test_llm`, `test_spec`, `test_n8n`, `test_spec_gate`, `test_edge_cases`) | 92 pass |
| `test_smoke.py` | passes |
| Frontend tests (`npm test`), TypeScript | 14 pass, no type errors |
| Baseline (`run_batch.py`) | 79/150 avoid a new build, 1057 citations, 0 invalid. A test enforces both numbers |
| Spec gates over 150 requests | 123 specs, 11 pass every gate, 112 blocked with a named reason, 0 crashes |
| Edge cases | 24 cases, all end in a safe, explained outcome |
| Live evaluation | 4 backends, 10 requests each, see `docs/eval_results.md` |

## Done
1. **State check:** this file.
2. **Frontend end to end:** ran against the live API in headless Chromium: request, flow view, approval, spec and gates, Radar, Decision log, with no console errors. Response shapes match `mock_api.json`, and the new fields (`pipeline`, `gates`) are additive.
   Fixed: dropped connections on non-object JSON, a 4xx silently switching to demo data, the stale frontend mock.
3. **Spec gates and edge cases:** `spec_gate.py`, `edge_cases.py`, `test_spec_gate.py`, `test_edge_cases.py`, `docs/quality_report.md`, `docs/edge_cases.md`.
   **Flow view:** `pipeline.py` is the one path for API, mock and tests. `FlowView.tsx` shows Intent, Evidence, Decision, Spec and Gates with the input and output of each.
4. **Live evaluation:** `eval_intent.py`, `eval_report.json`, `docs/eval_results.md`, and the first prompt version in `docs/eval_results_prompt_v1.md`. Recommended backend: `openai/gpt-oss-120b`.
5. **Embeddings:** both models work on Aitta. `kpi_match.py` uses `intfloat/multilingual-e5-large`, threshold 0.8, LLM confirms, requester confirms. Probe: 12/16 correct, `docs/embedding_probe.md`. Worked live on one Finnish request.
6. **n8n:** `n8n/approval_workflow.json` and `n8n/radar_digest_workflow.json`, verified in n8n 2.46.6: import, webhook 403 without key, 200 valid, 400 invalid, digest run status success.
7. **README:** deployment and governance, data assumptions, AI approach, limitations, edge-case table.
- **Not Pharma-specific:** division vocabulary moved to `catalog.json`, and a test keeps division terms out of the logic files.
- **Ad hoc market:** read from the request text in `recommend.py` (`resolve_market`, aliases in `catalog.json`). Batch requests keep their metadata market. Checked in the browser and through the live LLM path.
- **KPI coverage:** the rationale, `target.coverage`, citations and the frontend target card list covered KPIs with `Asset_KPI_Map` ids. A test keeps both mock files equal to the pipeline output.
- **Clarification loop:** answers go back to `/recommend`, are applied by field, and the request is decided again, replacing the result. Tested in Python, in the frontend, over HTTP, and in a browser with real models.
- **Live backends:** gpt-oss-120b on Aitta, automatic fallback to GLM-5.2 on Featherless, then the rules. `warmup.py` ran against all three models. Failover was forced with a dead primary, and GLM-5.2 answered live.
- **Data pack:** committed as `3a27c97`, synthetic, created by SinceAI. `.env` is ignored.

## Not done or not verified
- Nothing is pushed. No remote is configured.
- `Containerfile` and `deploy/openshift/api.yaml` exist, written outside this work and not tested here. The manifest sets no model keys, so a deployed API runs rules-only until a secret provides them. A KServe InferenceService manifest does not exist yet.
- `Bayer_SinceAI2026/` PDF and docx files are not committed. The permission covers the data pack only.
- Demo recording and pitch outline: not started.
- n8n ran on a throwaway local instance with test keys, not on your own instance. `.env` has a key but no n8n URL. The digest is not connected to email or Teams.
- `.env` still has `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. The live API no longer uses them.
- `FrontEnd/.env.local` sets `VITE_API_URL` to something other than localhost. It was not read or changed. A running frontend uses that API, which needs this code deployed for the loop to work.
- The catalog swap is tested with a sample catalog, not a real second division estate.
- ESLint reports formatting (prettier) errors across the frontend, including older Lovable files. Not fixed, since it does not affect behaviour.

## Known limitations
See "Honest limitations" in `README.md`.

## How to run
```bash
python3 -m unittest test_recommend test_llm test_spec test_n8n test_spec_gate test_edge_cases
python3 run_batch.py estate.db
python3 -I spec_gate.py estate.db
python3 -I edge_cases.py estate.db docs/edge_cases.md
python3 -I eval_intent.py estate.db     # cached, so a rerun is nearly free
python3 -I embed_probe.py estate.db
python3 -I warmup.py
python3 -I server.py estate.db 8000     # reads .env
cd FrontEnd && npm install --no-package-lock && npm test && VITE_API_URL=http://localhost:8000 npm run dev
```
The system Node on this machine is 18.19, and Vite needs 20.19+ or 22.12+. Tests here ran on Node 24 from a temporary session folder, so upgrade Node before running the frontend.
