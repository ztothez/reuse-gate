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

## Final rollout (2026-11-07, verified live)
`REUSE_GATE_DECISION_BACKEND=kserve REUSE_GATE_LLM_TIERS=together,featherless sh deploy/openshift/rollout.sh` from `0b45b4e`:
API build 9 (image `sha256:7f373455`) and the UI build, pipeline run `reuse-gate-verify-brz8t` with all five tasks green
(unit tests, governance, evaluation, security, rollout).
- `/healthz`: `decision_backend: kserve`, KServe reachable, `llm_tiers: together, featherless`, estate `sha256:d20e45cf...`.
- Live requests (Beyonttra, oncology, Kerendia) return `decision_backend: kserve` with the same actions and targets as the in-pod
  code. A fresh Kerendia request was read by the together tier (`openai/gpt-oss-120b`) in 8.3 s.
- The first attempt failed in the pipeline: two tests compared against `docs/` files that the image does not contain. They now skip
  that comparison when `docs/` is absent (`0b45b4e`).
- KServe undid the pipeline's `oc rollout restart` of the predictor, so the old predictor image answered with errors and the API
  recorded `local_fallback` (`bad_response`). Fixed by replacing the predictor pod; the pipeline now does that (`c58b91b`, applied).
- Write token: `reuse-gate-access` was first created empty; set again and verified: `/approve` and `/remediate` without the code
  or with a wrong code give 401, reads and `/requests` stay open.
- Three test approvals for request `X` (`REG-8C803B55`, `REG-21EF3F1B`, `REG-ECB4095C`) were written to the live decision log
  while the token was empty. Not removed yet.
- Aitta embeddings still answer HTTP 503.

## OpenShift AI recon (2026-11-07, read only)
- **Quota in `ztothez-dev`:** long-running pods (`compute-deploy`): requests 3 CPU and 30Gi memory, limits 30 CPU and 30Gi,
  0 GPU. In use: requests 210m CPU and 352Mi, limits 1300m and 1280Mi. Build pods (`compute-build`): requests 3 CPU and 14Gi.
  Storage: 10 PVCs and 80Gi, with 1 PVC (`workbench-storage`, 20Gi, gp3, RWO) in use. Ephemeral storage 15Gi.
  LimitRange: default request 10m CPU and 64Mi, default limit 1 CPU and 1000Mi per container, no maximum.
- **Serving runtimes:** none in the project. The cluster offers templates in `redhat-ods-applications`, including
  `vllm-cpu-x86-runtime-template` (`registry.redhat.io/rhaii/vllm-cpu-rhel9`, format `vLLM`, `--model=/mnt/models`),
  `vllm-cpu-runtime-template`, `kserve-ovms`, `mlserver-runtime-template` and GPU variants. None in the `openshift` namespace.
  The live InferenceService YAML is saved in `deploy/openshift/backup/inferenceservice-reuse-gate-kserve.live.yaml`.
- **What `reuse-gate-kserve` serves:** the Reuse Gate decision service itself, not a language model. It is a custom predictor
  container (`backend/reuse_gate/kserve_predictor.py`, same image as the API) in KServe `Standard` (raw deployment) mode,
  with no ServingRuntime object. It speaks the KServe v1 protocol: `GET /v1/models/reuse-gate-kserve` answers
  `{"name": "reuse-gate-kserve", "ready": true}`, and `POST /v1/models/reuse-gate-kserve:predict` with
  `{"instances": [{"text": "..."}]}` returns `{"predictions": [...]}`, one full recommendation per instance. It has no model
  keys, so its intent is always read by the rules (`ai.source` = `rules`). Checked live: a Nubeqa request returned
  `repair_and_reuse` on `AST-0209` with 24 citations. In-cluster address: `http://reuse-gate-kserve-predictor.ztothez-dev.svc.cluster.local`
  (port 80 to 8080), reachable from the API under the project's `allow-same-namespace` NetworkPolicy.
- **Does the live API call `reuse-gate-kserve`?** No. The live API decides in-process: `server.do_recommend` calls
  `pipeline.run_request` in the API pod, and no code in the API calls the InferenceService. The KServe service runs the same
  code in parallel, and only direct calls to its route use it.
- **LLM clients:** both CSC Aitta and Featherless are OpenAI-compatible (`POST {base}/chat/completions`, Bearer key).
  Base URLs and model names are constants in `backend/reuse_gate/llm.py` (`AITTA_URL`, `FEATHERLESS_URL`, `PRIMARY_MODEL`,
  `FALLBACK_MODEL`). Keys come only from the environment (`AITTA_API_KEY`, `FEATHERLESS_API_KEY` or `Featherless_AP_KEY`),
  which on the cluster comes from the secret `reuse-gate-llm`. Timeouts come from `LLM_TIMEOUT` and `LLM_FALLBACK_TIMEOUT`.

## OpenShift AI dashboard recognition (applied 2026-11-07)
`reuse-gate-kserve` now selects a real ServingRuntime, `reuse-gate-decision-runtime` (display name, `opendatahub.io/dashboard`,
model format `reuse-gate-decision` v1, protocol v1), instead of an inline container, and has a display name and description.
Applied after the backup in `deploy/openshift/backup/`. Verified: InferenceService `Ready`, `PredictorReady`, model state `Loaded`,
new predictor pod 3/3 (KServe added its model agent), and `:predict` gives the same answer (`repair_and_reuse`, `AST-0209`, 24
citations). Not verified: how the dashboard's Deployments page now shows it, since this session has no browser login. No hardware
profile is set: the project cannot list `hardwareprofiles`, so the field stays empty, which is expected for a custom CPU runtime.
Restore: `oc apply -f deploy/openshift/backup/inferenceservice-reuse-gate-kserve.live.yaml` after removing `status` and `resourceVersion`.

## Red Hat OpenShift AI work (2026-11-07, not rolled out)
See `docs/openshift.md`. Done and tested locally: env-driven model tiers with the answering and failed tiers in every result;
an optional Together AI tier; `REUSE_GATE_DECISION_BACKEND=kserve` with a recorded local fallback and a parity test; `/healthz`;
a state volume with startup reload; pipeline evaluation and security gates; probes, non-root read-only API pods; `wake.sh` and
`rollout.sh`; the write token on `/approve` and `/remediate` only; load-time cleaning of asset and KPI names. Applied live: the
ServingRuntime for `reuse-gate-kserve`. In-cluster model tier: measured and rejected (no-go), trial service deleted.

## Bayer constraints for the Red Hat work
Sources: `Bayer_SinceAI2026/Since_AI_Bayer_Challenge_Brief_FINAL.pdf` (and the same text in the docx),
`Analytics_Dashboard_Factory_Hackathon.pdf` (Bayer's technical talk), `Red_Hat_SinceAI2026_FINAL_BUILDER_GUIDE-2.pdf`.

a) **Confidentiality.** The Bayer brief has no NDA or confidentiality clause. It says: "No proprietary Bayer data is required.
   Use synthetic, anonymized or public data", and the data pack is "mock BI estate; no Bayer data". Bayer's judge confirmed the
   data pack may be in the public repo (see CLAUDE.md). The Red Hat guide asks for "a short, team-approved, non-confidential
   demo" and says "do not disclose protected client datasets or NDA-covered materials". What our demo and docs show:

   | Shown | Where | Allowed? |
   | --- | --- | --- |
   | Asset ids and names (`AST-0209`, `Nubeqa Inventory Monthly`, `Xarelto Budget New`, `All Pharma Demand - US`, `Hyrnuo Launch Monthly`, `Kerendia Inventory Copy`, ...) | README, docs, UI, demo | Yes: synthetic records in the SinceAI data pack |
   | Owner names (for example `Nina Garcia`) and `@synthetic.example` emails | UI and API only; no owner name appears in the docs | Yes: synthetic records (`synthetic_record = 1`), not real people |
   | Product names (Nubeqa, Kerendia, Eylea, Xarelto, Lynkuet, Beyonttra, Hyrnuo) | everywhere | Yes: the pack takes them from Bayer's public annual report ("used only for realistic product naming") |
   | Figures (57/150, 1098 citations, 13/124 specs, 360/451/510 assets) | README, docs, evaluation | Yes: computed by us from the synthetic pack, not Bayer figures |
   | Bayer's reference flow and legend (Prompt, `/grill-me`, Intent, `/explore`, `/to-spec`, Spec, `.PBIP`) | README mapping section | Yes as a description: presented to all builders in Bayer's talk, no confidentiality marking. The PDFs themselves are not committed, and the demo should not show the slides without Bayer's approval |
   | The Bayer contact's name and email | not in the repo | Keep it out |

   No conflict found, so no docs needed fixing.
b) **Hosting, data location, security, BI integration.** The brief sets no hosting or data location requirement. It asks the
   README to cover "data assumptions, AI approach, governance controls and enterprise-BI integration", and names Bayer's
   "Tableau-to-Power BI migration". The talk places the source and sandbox workspace in Microsoft Fabric and ends in a `.PBIP`
   report. So the OpenShift story must not claim that Bayer's BI runs on OpenShift: Reuse Gate is the decision and governance
   layer next to Power BI and Fabric, and real requests would carry estate metadata to whichever model tier is configured.
c) **Bayer's wording for the business problem:** "Enterprise self-service BI creates speed, but also dashboard sprawl, duplicate
   logic, unclear ownership and technical debt." "Build a prototype that helps organizations create, reuse, maintain or retire
   analytics products intelligently while preserving governance and business value." Guiding question: "turn business questions
   into fewer, better, maintainable and governed analytics products - without multiplying dashboards, inconsistent KPIs and
   technical debt". Approaches: "recommendations to reuse, consolidate or retire analytics assets", "human-in-the-loop
   approval". Success: "reduce analytics sprawl while preserving ownership, KPI consistency, human oversight and lifecycle control."

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
- **Security (not on the cluster yet):** `docs/security.md`, CORS allow-list, security headers, per-address rate limits, JSON errors without traces, secret redaction in logs, guard against instruction-like wording. `scripts/security_check.py` 17/17 against a local API with fake keys; secret scan 0 findings. `npm audit` has 9 open frontend findings (2 high), not fixed.
- **Faithfulness guard and evaluation (not on the cluster yet):** `ai.guard` on every AI explanation, `scripts/eval_quality.py`, `data/evaluation.json`, `GET /evaluation`, a 20-row gold labelling template and `scripts/score_gold.py`. Offline numbers: faithfulness 6/6, context precision 0.937, context recall 0.992 (the 5 migrate decisions do not cite the target's asset row), citation validity 1098/1098. The LLM judge has not run yet: it needs `AITTA_API_KEY` in the environment.
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
- Clarification question wording by a model is tested with a fake client, not checked against a real model.
- `Bayer_SinceAI2026/` PDF and docx files are not committed. The permission covers the data pack only.
- The failure paths are tested with simulated failures and local servers, not against a real Aitta 429.
- n8n ran on a throwaway local instance. The digest is not connected to email or Teams, and the PingSource's scheduled run has not been observed.
- `data/mock_api.json` has `owners`, `radar.ownership_bottlenecks` and `work_items`, but the frontend copy must be synced with `cp data/mock_api.json frontend/src/data/mock_api.json`. The frontend has no screen for work items, `/remediate` or the record.
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
