# Evidence

Screenshots of the live system on Red Hat OpenShift AI, taken on 8 November 2026 while signed in with the judge code. Each one is
the live API's data for that role. The front end in the screenshots is the current repository build; the top bar's
"decisions on KServe" is read from the live API.

| File | What it shows |
| --- | --- |
| `01-business-answer.png` | Business view: one answer card, plain-language explanation, Listen, the five-stage strip |
| `02-analyst-evidence.png` | Analyst view: every cited row behind the decision |
| `03-analyst-dashboard-studio.png` | Dashboard studio: tiles filled with real rows of the data pack, each naming its source table |
| `04-approver-gates.png` | Approver view: the seven spec gates, one blocked by an inactive owner |
| `05-developer-config.png` | Developer view: configuration changes measured on all 150 requests |
| `06-executive-report.png` | Executive report: plain words, a source under every section |
| `07-operator-wall.png` | Operator wall: failed refreshes and owners, query errors, supply risk |
| `08-admin-workflows.png` | Admin: email through n8n, with the outbox of messages actually sent |
| `09-evaluation.png` | Evaluation: every metric with its method and caveat |
| `10-openshift-ai-cli.png` | `oc` and `curl` output: the KServe InferenceService (READY True) on its ServingRuntime, running pods, the OpenShift Pipelines run with all five tasks Succeeded, routes, the model's ready check, and the API health reporting `decision_backend: kserve` |

Manifests: [deploy/openshift/](../../deploy/openshift/). Write-up: [docs/openshift.md](../openshift.md).
