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
- Data: Bayer's synthetic Builder Data Pack (xlsx) loaded into SQLite (`estate.db`).
- Front end: Lovable app ("Reuse Gate", React + Tailwind) in a separate folder. It reads `VITE_API_URL`
  and falls back to `mock_api.json` ("Demo data" badge).

## Files
- `load_estate.py` xlsx -> SQLite. `profile_estate.py` data profile.
- `estate.py` Estate class (assets, models, owners, kpis, usage, signals, rules, backlog, requests).
- `catalog.json` division vocabulary, so nothing Pharma-specific lives in the logic.
- `pipeline.py` `run_request`, the one path: Intent -> Evidence -> Decision -> Spec -> Gates. `spec_gate.py` quality gates and batch report.
- `edge_cases.py`, `test_edge_cases.py`, `test_spec_gate.py`. `eval_intent.py` live evaluation. `kpi_match.py`, `embed_probe.py` embeddings.
- `speech.py` ElevenLabs text to speech behind `POST /speak`, for the Listen button.
- `warmup.py` wakes the live models. `Containerfile`, `deploy/openshift/` OpenShift packaging.
- `PROGRESS.md` current status, kept honest. Read it before the TODO list below, which predates it.
- `recommend.py` `parse_request` (rule-based baseline), `assess`, `recommend`, `_migration`. Actions: reuse,
  repair_and_reuse, extend, new_build, retire_and_reuse, migrate, retire, human_review.
- `server.py` stdlib HTTP API: POST /recommend, GET /radar, POST /approve, GET /log, GET /health. CORS open.
- `export_mock.py` builds `mock_api.json` (response shapes the front end consumes). Keep shapes stable.
- `run_batch.py` runs all 150 business requests. `test_recommend.py` 7 property tests.
- `spec.py` DashboardSpec dataclasses (earlier work, useful for the spec stage).
- `LOVABLE_PROMPT.md` the prompt used to generate the front end.

## Commands
```bash
pip install openpyxl
python3 -I load_estate.py <data-pack>.xlsx estate.db
python3 test_recommend.py
python3 run_batch.py estate.db          # expect: 79/150 new builds avoided, 1434 citations, 0 invalid
python3 -I warmup.py
python3 -I server.py estate.db 8000
python3 -I export_mock.py estate.db mock_api.json
```
Front end (Lovable project folder): `npm install --no-package-lock` (the repo keeps Lovable's `bun.lock`), `.env.local` with `VITE_API_URL=http://localhost:8000`, `npm run dev`. Needs Node 20.19+ or 22.12+.

## Current results (baseline, rule-based parser)
150 requests: new_build 71, extend 52, human_review 17, repair_and_reuse 5, migrate 5.
79/150 (53%) avoid a new build; 5 assets proposed for retirement and 7 to consolidate later. No ground truth exists in the pack, so the
honest metrics are rule compliance and citation validity. Reuse-as-is is 0 because the estate is deliberately messy.
"alive" = lifecycle active AND at least 100 views in the last 3 months (lifecycle status does not correlate with usage in the data).
The 150 requests are only 10 distinct texts: cache LLM outputs by request text.

## Model backends (OpenAI-compatible, `live_client()` in `llm.py`)
- Primary: `openai/gpt-oss-120b` on CSC Aitta, `https://aitta-api.csc.fi/openai/v1`, key `AITTA_API_KEY`. Availability is "as-is".
- Automatic fallback: `zai-org/GLM-5.2` on Featherless, `https://api.featherless.ai/v1`, key `FEATHERLESS_API_KEY` or `Featherless_AP_KEY`.
  $25 credit. 403 = gated model, 503 = retry.
- If both fail, the rule parser takes over. `LLM_MODE=rules` turns models off. `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` no longer select the live backend.
- `python3 -I warmup.py` before a demo. Exit 0 primary ready, 1 only fallback, 2 neither.
- Embeddings: `intfloat/multilingual-e5-large` on Aitta.
- Text to speech: ElevenLabs, key `ElevenLabs_API_KEY`. Capped, budgeted and cached in `speech.py`.
- Never commit keys. Use `.env`.

## TODO, in order
1. LLM layer: /grill-me intent parsing (structured JSON out, ask clarifying questions when unsure), explanations,
   wired into `/recommend`. Keep the rule-based parser as fallback and as a comparison baseline.
2. Eval: run the 10 distinct requests through both backends, report agreement with the rule-based parser, document it.
3. Front end: verify result view and approval flow against the real API. Add a Reason column to the Radar
   "dead" table and rename it "Retire or review". Verify the KPI legend wording against the data pack.
4. DashboardSpec generation for the approved "new_build" and "extend" cases (`spec.py`), with a simple preview.
5. Optional n8n: approval webhook and a scheduled radar digest. Only if steps 1-4 are done.
6. Red Hat OpenShift AI award: Containerfile for the API, KServe InferenceService manifest, a portability section in the
   README (solution does not need to run in the sandbox, but Red Hat must be able to verify it could).
   Evidence needs an https link plus a 40+ character description.
7. README / architecture note, demo recording, 4-minute pitch outline. Submit by about 08:00 Sunday.

## Open questions and constraints
- The data pack may go in the public repo (confirmed by Bayer's judge): `estate.db` and the xlsx are committed. It is
  synthetic, created by SinceAI, and the README says so. `.env` stays ignored.
- Ask what "maximum field, maximum quality and dashboard error" means for scoring.
- Known simplification: unnamed products default to "All Pharma" for ad hoc requests, and the clarification asks the user to confirm.
