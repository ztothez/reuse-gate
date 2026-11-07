# Reuse Gate: Since AI Hackathon 2026, Bayer challenge

Solo team ZtotheZ (Roosa). Turku, 6-8 Nov 2026. Challenge: "Build Less, Build Better: AI for Governed Analytics".
**Hard submission deadline: Sunday 10:00 Turku time. Aim to submit by about 08:00.**
Finals pitch: 4 min + 6 min jury. Need: working end-to-end workflow, short demo, repo, README/architecture note
(data assumptions, AI approach, governance controls, enterprise-BI integration).

## Working style (how Roosa wants help)
- Never use em dashes.
- This is hackathon build/ship mode: give full commands and working patches, concise explanations, no teaching detours.
- Accept her statements literally. Challenge only for correctness, security, architecture or deadline risk.
- Keep decision logic simple. Do not add enterprise abstractions.

## Idea
Before anyone builds a new dashboard, check whether an existing report can be reused, repaired, extended,
migrated or retired. A human approves, the new asset is registered with an owner and review date, and a Radar view
shows problems (conflicting KPIs, ownerless, uncertified high-reach, dead assets) without anyone asking.

Bayer's evaluation weights: 30% problem fit and business value, 25% governance and maintainability,
20% technical quality and meaningful AI use, 15% usability, 10% scalability and demo.

## Architecture
- Decisions are deterministic Python, no LLM, so they are auditable. Every recommendation cites rows of the data pack.
- The LLM is used only for: /grill-me intent parsing with clarifying questions, plain-language explanations, DashboardSpec generation.
- Data: Bayer's synthetic Builder Data Pack (xlsx) loaded into SQLite (`data/estate.db`).
- Front end: Lovable app ("Reuse Gate", React + Tailwind) in `frontend/`. It reads `VITE_API_URL`
  and falls back to `data/mock_api.json` ("Demo data" badge).

## Files
- `scripts/load_estate.py` xlsx -> SQLite. `scripts/profile_estate.py` data profile.
- `backend/reuse_gate/estate.py` Estate class (assets, models, owners, kpis, usage, signals, rules, backlog, requests).
- `data/catalog.json` division vocabulary, so nothing Pharma-specific lives in the logic.
- `backend/reuse_gate/pipeline.py` `run_request`, the one path: Intent -> Evidence -> Decision -> Spec -> Gates. `backend/reuse_gate/spec_gate.py` quality gates and batch report.
- `backend/reuse_gate/edge_cases.py`, `backend/tests/test_edge_cases.py`, `backend/tests/test_spec_gate.py`. `scripts/eval_intent.py` live evaluation. `backend/reuse_gate/kpi_match.py`, `scripts/embed_probe.py` embeddings.
- `backend/reuse_gate/clarify.py` the clarification loop: confidence, rounds, human_review after 3. `data/messy_requests.jsonl`, `scripts/eval_messy.py`, `docs/messy_to_clean.md`.
- `backend/reuse_gate/remediate.py` `POST /remediate` (simulated owner assignment, gates before and after), the `/approve` record, and Radar `ownership_bottlenecks`.
- `backend/reuse_gate/speech.py` ElevenLabs text to speech behind `POST /speak`, for the Listen button.
- `backend/reuse_gate/answers.py` LLM answers saved by a hash of the normalized text. `data/prewarmed_answers.json` the 10 chips, built by `scripts/prewarm.py`. See "Reliability" in the README.
- `scripts/warmup.py` wakes the live models. `Containerfile`, `deploy/openshift/` OpenShift packaging.
- `PROGRESS.md` current status, kept honest. Read it before the TODO list below, which predates it.
- `backend/reuse_gate/recommend.py` `parse_request` (rule-based baseline), `assess`, `recommend`, `_migration`. Actions: reuse,
  repair_and_reuse, extend, new_build, retire_and_reuse, migrate, retire, human_review.
- `backend/reuse_gate/server.py` stdlib HTTP API: POST /recommend, GET /radar, POST /approve, GET /log, GET /health. CORS open.
- `backend/reuse_gate/export_mock.py` builds `data/mock_api.json` (response shapes the front end consumes). Keep shapes stable.
- `scripts/run_batch.py` runs all 150 business requests. `backend/tests/test_recommend.py` 7 property tests.
- `backend/reuse_gate/spec.py` DashboardSpec dataclasses (earlier work, useful for the spec stage).
- `docs/LOVABLE_PROMPT.md` the prompt used to generate the front end.

## Commands
Run from the repo root.
```bash
pip install openpyxl
python3 -I scripts/load_estate.py data/<data-pack>.xlsx data/estate.db
python3 -m unittest discover -s backend/tests -t backend -p 'test_*.py'
python3 -I scripts/run_batch.py data/estate.db   # expect: 57/150 new builds avoided, 1098 citations, 0 invalid
python3 -I scripts/warmup.py
export PYTHONPATH=backend
python3 -m reuse_gate.server data/estate.db 8000
python3 -m reuse_gate.export_mock data/estate.db data/mock_api.json && cp data/mock_api.json frontend/src/data/mock_api.json
```
Front end (`frontend/`): `npm ci`, `.env.local` with `VITE_API_URL=http://localhost:8000`, `npm run dev`. Needs Node 20.19+ or 22.12+. The repo keeps `package-lock.json` only.

## Current results (baseline, rule-based parser)
150 requests: new_build 93, extend 31, human_review 17, repair_and_reuse 4, migrate 5.
57/150 (38%) avoid a new build; 2 assets proposed for retirement and 2 to consolidate later. A target must cover a requested KPI as primary. No ground truth exists in the pack, so the
honest metrics are rule compliance and citation validity. Reuse-as-is is 0 because the estate is deliberately messy.
"alive" = lifecycle active AND at least 100 views in the last 3 months (lifecycle status does not correlate with usage in the data).
The 150 requests are only 10 distinct texts: cache LLM outputs by request text.

## Model backends (OpenAI-compatible, `live_client()` in `backend/reuse_gate/llm.py`)
- Primary: `openai/gpt-oss-120b` on CSC Aitta, `https://aitta-api.csc.fi/openai/v1`, key `AITTA_API_KEY`. Availability is "as-is".
- Automatic fallback: `zai-org/GLM-5.2` on Featherless, `https://api.featherless.ai/v1`, key `FEATHERLESS_API_KEY` or `Featherless_AP_KEY`.
  $25 credit. 403 = gated model, 503 = retry.
- No retries. Aitta and embeddings get 20 seconds per call (`LLM_TIMEOUT`), GLM-5.2 gets 40 (`LLM_FALLBACK_TIMEOUT`), a request 60 (`LLM_REQUEST_DEADLINE`), and the server to 4 model calls at once (`LLM_MAX_CONCURRENT`).
- If both fail, the rule parser takes over and the UI shows "Source: rules". `LLM_MODE=rules` turns models off. `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` no longer select the live backend.
- `python3 -I scripts/warmup.py` before a demo. Exit 0 primary ready, 1 only fallback, 2 neither.
- Embeddings: `intfloat/multilingual-e5-large` on Aitta.
- Text to speech: ElevenLabs, key only from env `ELEVENLABS_API_KEY`. Capped, budgeted and cached in `backend/reuse_gate/speech.py`.
- On the cluster, keys come from the secrets `reuse-gate-llm`, `reuse-gate-elevenlabs` and `reuse-gate-n8n`, declared in `deploy/openshift/api.yaml`.
- Never commit keys. Use `.env`.

## TODO, in order
1. LLM layer: /grill-me intent parsing (structured JSON out, ask clarifying questions when unsure), explanations,
   wired into `/recommend`. Keep the rule-based parser as fallback and as a comparison baseline.
2. Eval: run the 10 distinct requests through both backends, report agreement with the rule-based parser, document it.
3. Front end: verify result view and approval flow against the real API. Add a Reason column to the Radar
   "dead" table and rename it "Retire or review". Verify the KPI legend wording against the data pack.
4. DashboardSpec generation for the approved "new_build" and "extend" cases (`backend/reuse_gate/spec.py`), with a simple preview.
5. Optional n8n: approval webhook and a scheduled radar digest. Only if steps 1-4 are done.
6. Red Hat OpenShift AI award: Containerfile for the API, KServe InferenceService manifest, a portability section in the
   README (solution does not need to run in the sandbox, but Red Hat must be able to verify it could).
   Evidence needs an https link plus a 40+ character description.
7. README / architecture note, demo recording, 4-minute pitch outline. Submit by about 08:00 Sunday.

## Open questions and constraints
- The data pack may go in the public repo (confirmed by Bayer's judge): `data/estate.db` and the xlsx are committed. It is
  synthetic, created by SinceAI, and the README says so. `.env` stays ignored.
- Ask what "maximum field, maximum quality and dashboard error" means for scoring.
- Known simplification: unnamed products default to "All Pharma" for ad hoc requests, and the clarification asks the user to confirm.
