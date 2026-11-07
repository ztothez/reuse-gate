# Pitch, demo path and submission text

For the finals (4 minutes plus 6 minutes of questions) and the submission form. Every number here is in `/evaluation` or
`docs/quality_report.md`; modelled numbers are said to be modelled.

## Before going on stage

1. `oc whoami`, then `sh deploy/openshift/wake.sh`.
2. `curl -s https://reuse-gate-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com/healthz` shows `"decision_backend": "kserve"` and
   `"reachable": true`.
3. Sign in with your role codes in the browser you present from: business, analyst, developer and approver, using Add a role.
   Give judges a business or analyst code if they want to try it; the approver code stays with you.
4. Open the tabs below in advance. If a model provider is down, say so: decisions never depend on a model.

## 4-minute pitch

| Time | Say | Show |
| --- | --- | --- |
| 0:00 to 0:30 | Self-service BI is fast, and every new question becomes a new dashboard. Bayer's brief names the cost: sprawl, duplicate logic, unclear ownership, technical debt. Reuse Gate sits before the build: should we build anything at all? | Ask page, the line "57 of 150 modelled requests avoid a new build" |
| 0:30 to 1:15 | A business user types a messy request. The first prompt is rarely clean: in our 21 messy prompts, 8 were read cleanly at first and 20 after at most three rounds of questions. The rules choose the questions, a model only words them. | Business view, a request with an open question, answer it; Evidence tab, "From the first prompt to the decision" |
| 1:15 to 2:00 | The answer is one card: extend Nubeqa Gross-to-Net Monthly, it covers 2 of 3 KPIs, Forecast Variance needs adding. Switch the view to Analyst: every row behind it, and one row that blocks release, a failed refresh on SM-021. | `SAMPLE-01` as Business, then `?as=analyst` |
| 2:00 to 3:00 | Governance before release. Oncology needs a new build on SM-065, but its owner is inactive. The approver simulates one active owner, the gates go from 5 of 7 to 7 of 7, and approves with an owner and a review date. The record keeps the gates before and after. Across the estate, one owner fix moves passing specs from 13 to 93 of 124, modelled. | `SAMPLE-07` as Approver: Gates tab, approval queue, then Activity |
| 3:00 to 3:30 | The developer gets a spec, not a blank page: semantic model, canonical measures, owner, review date, as JSON. Change the configuration, not the report. | Developer view, Build queue, Spec tab |
| 3:30 to 4:00 | It runs on Red Hat OpenShift AI: decisions are served by a KServe InferenceService, a Tekton pipeline runs tests, governance, evaluation and security gates before rollout, and the top bar shows where each decision ran. Build less, build better, with a person in charge. | Top bar "decisions on KServe"; one slide or 10 s of the OpenShift AI Deployments page |

Use cases across domains, for the question "does it generalise": commercial (Nubeqa sales, extend), launch and market access
(Beyonttra, repair and reuse), supply (supply risk, extend), portfolio (oncology, new build after an owner fix), migration
(Tableau to Power BI: human review while the first prompt is ambiguous, migrate once the report is named).

## Demo links

Live UI: https://reuse-gate-ui-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com

- `/?as=business`: the Ask page
- `/requests/SAMPLE-01?as=business`, then `?as=analyst`: the same request for two people
- `/requests/SAMPLE-07?as=approver`: the owner fix and approval (answer "yes" to the market question first)
- `/?as=developer`: the build queue
- `/overview`: 57 of 150, 13 to 93 of 124, estate 360, 510 without a check, 451 with Reuse Gate (modelled)

## Questions to expect

- **How do you know the recommendation is right?** There is no ground truth in the data pack, so we measure what we can: every
  decision cites rows, and all 1,098 citations exist (validity 1.0); a faithfulness guard replaces any explanation that mentions a
  fact not in the decision; the rules are tested on 150 requests and 24 edge cases. A 20-row human gold set is prepared; real
  users would close the loop, as Panu said.
- **Why not let the LLM decide?** Decisions must be auditable and repeatable. A model reads the request and words the
  explanation; the decision is deterministic and cited, and the UI says which component did what.
- **What if the model provider is down?** Tiers fall back (Together, then Featherless, then rules) with a circuit breaker.
  Decisions are identical with every model unreachable; tested on 194 decisions.
- **Is this enterprise ready?** The parts that are: least privilege enforced by the API (each role gets only its own rows and
  fields, business users see only their own requests, records name the signed-in approver), health probes, a non-root read-only
  container, a state volume, a gated pipeline, a recorded decision trail, and no fallback to bundled data. Not yet: single sign-on
  in place of role codes (the seam is one function), scope-based approval rights, and a real connector to Power BI or Fabric
  metadata. The data pack is synthetic, as the challenge provides it.
- **Why 57 of 150?** 150 requests come from 10 distinct texts, and the estate is deliberately messy, so reuse as-is is 0. If only
  canonical KPI definitions may count, it is 33 of 150; the README shows both.
- **Why KServe for rules?** The decision service is the model being served: versioned, health-checked and scaled by OpenShift AI
  like any model. An in-cluster language model was tried on CPU and rejected (too slow, unusable intents); with a GPU it plugs in
  as a tier through environment variables.

## Submission text (Bayer)

Reuse Gate checks whether an existing report can be reused, repaired, extended, migrated or retired before anyone builds a new
dashboard. A requester writes a request in plain language; a clarification loop of at most three rounds turns a messy request into
a clear intent (8 of 21 messy prompts were clear at first, 20 of 21 after the loop). Deterministic rules then decide, citing the
rows of the estate they used, and seven gates block release until a model is healthy and an active owner and review date exist.
A person approves, and the decision record keeps the gates before and after any fix. Different people see the same work item
differently: the business user gets one plain answer with audio, the analyst the cited evidence, the developer a spec to build
from, the approver the gates. On Bayer's synthetic data pack, 57 of 150 requests avoid a new build, and one owner fix on a shared
model would move passing specs from 13 to 93 of 124 (modelled). Language models only read requests and word explanations; the
decisions are rules, so they are repeatable and auditable. Runs on Red Hat OpenShift AI with a KServe decision service and a gated
Tekton pipeline.

## Submission text (Red Hat award)

Link: https://reuse-gate-ui-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com

Use the description in `docs/openshift.md` section 7. Add a screenshot of the OpenShift AI Deployments page once taken
(`docs/openshift-ai-deployment.png`).
