# Reuse Gate progress

Last updated: 2026-11-07. Everything below reflects what was actually run. Anything not verified says so.

## Results
| Check | Result |
| --- | --- |
| All Python tests (`python3 -m unittest discover -s backend/tests -t backend -p 'test_*.py'`) | 172 pass |
| Frontend tests (`npm test`), TypeScript | 27 pass, no type errors |
| Baseline (`scripts/run_batch.py`) | 57/150 avoid a new build, 1098 citations, 0 invalid. New builds 93, extend 31, repair 4, retire 2, consolidate later 2. A test enforces these numbers |
| Spec gates over 150 requests | 124 specs, 13 pass every gate, 111 blocked with a named reason, 0 crashes |
| Edge cases | 24 cases, all end in a safe, explained outcome |
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
- **Listen button:** `POST /speak` and `ListenButton.tsx`, verified with a live ElevenLabs call and in a browser. Nobody has listened to the audio yet: the test confirms a real MP3 and that playback started. Checked against the spec as far as it was received: key only from `ELEVENLABS_API_KEY`, POST with `audio/mpeg`, disk cache by sha256 of the text. The received spec ended mid-sentence.
- **Radar ping:** `POST /radar-ping` returns the digest with no key for a Knative PingSource. Read-only, and it ignores the body.
- **Primary KPI rule:** a target must cover a requested KPI as primary. Secondary rows are shown and cited but not counted. The canonical-only version (33/150) is measured in `docs/quality_report.md` for information, and the rule does not use it.
- **Repo layout:** reorganized into `backend/reuse_gate`, `backend/tests`, `scripts`, `data`, `deploy`, `docs` and `frontend` with no behavior change: API responses, batch output and mock data were compared with the previous layout and are identical. `frontend/package-lock.json` replaces `bun.lock`.
- **OpenShift rollout:** the reorganized image (digest `75913c2e64b0`) is live, built from a clean `git archive` export. `/health` returns ok, KServe `:predict` returns a cited decision, and PipelineRun `reuse-gate-verify-rcspl` succeeded on all three tasks: unit tests (138 run, 2 skipped), governance gate, rollout.
- **Reliability:** fallback on 429, 5xx, timeouts and truncated responses, 20-second call limit, 45-second request deadline, global concurrency limit, answers saved by normalized text, 10 chips pre-warmed in `data/prewarmed_answers.json`, and a visible "Source: rules" with the reason. Decisions were compared with the previous commit and are identical. Tested in a browser with both providers unreachable. Not tested against a real Aitta 429.
- **Repo:** private at `ztothez/reuse-gate`, with `main` and `reuse-gate-build` pushed.
- **Data pack:** committed as `1a0d8ce`, synthetic, created by SinceAI. `.env` is ignored.

## Not done or not verified
- The deployed API and KServe predictor have no model or audio keys, so they run rules-only until a secret provides them.
- `Bayer_SinceAI2026/` PDF and docx files are not committed. The permission covers the data pack only.
- The live cluster still runs the image built before the Reliability work, so a rebuild is needed to deploy it.
- The committed chip file holds model intents but no AI explanations, because it was built from saved responses. Run `python3 -I scripts/prewarm.py data/estate.db` with keys available to add them.
- Demo recording and pitch outline: not started.
- n8n ran on a throwaway local instance with test keys, not on your own instance. `.env` has a key but no n8n URL. The digest is not connected to email or Teams.
- `.env` names the key `ElevenLabs_API_KEY`, which is no longer read. Rename it to `ELEVENLABS_API_KEY`, or Listen shows its "not available" message.
- `.env` still has `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. The live API no longer uses them.
- `frontend/.env.local` sets `VITE_API_URL` to something other than localhost. It was not read or changed. A running frontend uses that API, which needs this code deployed for the loop to work.
- The catalog swap is tested with a sample catalog, not a real second division estate.
- ESLint reports formatting (prettier) errors across the frontend, including older Lovable files. Not fixed, since it does not affect behaviour.

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
