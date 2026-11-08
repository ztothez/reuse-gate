# Submission form text

## Project name
Reuse Gate

## Tagline
Before anyone builds a new dashboard, Reuse Gate checks what already exists and recommends reuse, repair or extension, with cited evidence.

## About the project
**The problem.** In self-service BI, every new business question tends to become a new dashboard. Bayer's brief names the cost: report sprawl, duplicate logic, conflicting KPI definitions, unclear ownership and technical debt. Nobody checks what already exists before building.

**Our solution.** Reuse Gate sits before the build. A business user describes the report they need in plain words. Reuse Gate asks what is unclear (at most three rounds), checks the existing reports, KPI definitions, semantic models and owners, and recommends one of: reuse, repair, extend, migrate, retire, new build, or human review. Every recommendation cites the rows of the estate it used. Seven governance gates block release until a healthy model, canonical KPIs, an active owner and a review date exist. A person always approves, and the decision record keeps the gates before and after any fix.

**How it works.** Intent, Evidence, Decision, Spec, Gates, human approval: the same visible path for every request, mapped to Bayer's reference flow. Decisions are deterministic Python rules, so they are repeatable and auditable. Language models only read the request, word the clarifying questions and explanations, and answer questions in a request's chat; a faithfulness guard rejects any model text that names a fact not in the decision. If every model is down, the decisions stay the same.

**Everyone gets their own app, and only their own data.** Least privilege is enforced by the API, not just hidden in the UI.
- Business: asks and gets one plain answer, with audio.
- Analyst: the cited evidence, and a dashboard studio that turns a request's spec into tiles filled with real rows (Bayer's render_preview step), with drag and drop, save, share and export.
- Developer: changes configuration, not reports. Every proposed rule change is measured on all 150 requests before review.
- Approver: gates, a what-if owner fix, approval with owner and review date; never approves their own change.
- Executive: a one-page report in plain words, with a source under every section, to print or email.
- Operator: a wall screen for gloves and distance: failed refreshes and who to call, query errors, supply risk.
- Admin: workflows and email through n8n, with an outbox of every message.

**Results on Bayer's synthetic data pack.** 57 of 150 requests avoid a new build (38%). All 1,098 citations exist. One owner fix on a shared semantic model would raise passing specs from 13 to 93 of 124. These are modelled outcomes on synthetic data, not measured savings; the evaluation page shows the method and caveats for each number. In 21 messy prompts, 8 were understood at first and 20 after the clarification loop.

**How we built it.** Runs on Red Hat OpenShift AI. The decision service is served as a model by a KServe InferenceService on its own ServingRuntime, visible in the OpenShift AI dashboard, and the API calls it for every decision, falling back to in-pod rules and saying so. An OpenShift Pipelines (Tekton) run executes unit tests and the governance, evaluation and security gates before each rollout. The API is standard-library Python with a SQLite copy of the data pack, in a non-root, read-only container with a state volume. The front end is React and TypeScript. Language models: gpt-oss-120b (Together AI, CSC Aitta) with GLM-5.2 on Featherless as fallback, then rules. Speech by ElevenLabs. Email through n8n with SMTP. 380 backend and 187 front-end tests.

**Challenges.** Messy first prompts: we built a clarification loop where rules choose the questions and a model only words them. The estate is deliberately messy, so reuse as-is is zero; the value is in repair and extension. Keeping AI useful but never in charge of the decision. Making seven different people see seven different, honest views of the same work item.

**What's next.** Single sign-on in place of access codes (one function changes), approval rights by domain, a real Power BI or Fabric metadata connector instead of the data pack, .pbip export from the dashboard studio, and a pilot with one Bayer division (see the pilot plan).

**Try it.** Sign in with the judge code JUDGE_CODE. "Viewing as" switches between all seven roles; the API serves each view exactly that role's data. Every request page has a Discussion button for the request's chat with the agent.

## Built with
Red Hat OpenShift AI, KServe, Python, React, TypeScript, OpenShift Pipelines (Tekton), SQLite, n8n, ElevenLabs, gpt-oss-120b, GLM-5.2, Tailwind CSS, Recharts, Vite

## Repository
https://github.com/ztothez/reuse-gate (branch `reuse-gate-build`; merge to main or set it as default before submitting)

## Demo URL
https://reuse-gate-ui-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com

## Demo video
The YouTube link (unlisted) of the 2-minute video.

## Files
- Source code: `reuse-gate-source.zip`
- Pitch deck: `reuse-gate-pitch-deck.pdf`
- Supporting document: `reuse-gate-pilot-plan.pdf`
