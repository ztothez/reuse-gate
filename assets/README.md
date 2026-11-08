# Reuse Gate screenshots

Reuse Gate ran on a Red Hat OpenShift AI Developer Sandbox during the Since AI Hackathon 2026 (Turku, 6 to 8 November 2026).
The sandbox has been shut down, so these screenshots show the app and the platform as they ran on 8 November 2026. Every
screen shows the live API's data for that role, on Bayer's synthetic Builder Data Pack.

## The app, one view per role

Each role has its own app, and the API returns only that role's data.

### Business: one clear answer

A business user asks for a report in plain words and gets one answer card: here, extend an existing report instead of building
a new one. The five-stage strip shows where the request is, and Listen reads the answer aloud.

![Business view: the answer card](01-business-answer.png)

### Analyst: the evidence

Every row behind the decision, with what it found and what it supports.

![Analyst view: cited evidence](02-analyst-evidence.png)

### Analyst: dashboard studio

A request's spec becomes tiles filled with real rows from the data pack (Bayer's render_preview step). Drag measures and fields
onto the grid, then save, share or export JSON and CSV. Each tile names its source table.

![Dashboard studio](03-analyst-dashboard-studio.png)

### Approver: the gates

Seven gates block release until the model is healthy, the KPIs are canonical and an active owner and review date exist. Here one
gate is blocked by an inactive owner; the approver can simulate a fix before approving.

![Approver view: spec gates](04-approver-gates.png)

### Developer: configuration, not reports

A developer proposes a rule or vocabulary change. It is measured on all 150 requests before review, and nobody approves their own.

![Developer view: decision configuration](05-developer-config.png)

### Executive: a plain-language report

One page in plain words, figures from live records, a source under every section. Print, save as PDF, email or listen.

![Executive report](06-executive-report.png)

### Operator: the wall

Large type for a wall screen or gloved hands, refreshing every minute: failed refreshes and who to call, query errors, supply
risk and open signals.

![Operator wall](07-operator-wall.png)

### Admin: workflows and email

Email through n8n, a test email per role, and the outbox of every message sent or not sent.

![Admin: workflows and email](08-admin-workflows.png)

### Evaluation

Every metric with its method and its caveat; modelled numbers say so.

![Evaluation page](09-evaluation.png)

## Red Hat OpenShift AI

### The decision service as a served model

The OpenShift AI dashboard, project `ztothez-dev`: "Reuse Gate decision service" on the "Reuse Gate decision runtime
(KServe v1, CPU)", with internal and external endpoints, status Ready.

![OpenShift AI dashboard: deployments](13-openshift-ai-deployments-kserve.png)

### Command-line evidence

`oc` and `curl` output: the KServe InferenceService READY True on its ServingRuntime, the running pods, the OpenShift Pipelines
run with all five tasks Succeeded (unit tests, governance, evaluation and security gates, rollout), the routes, the model's ready
check, and the API health reporting `decision_backend: kserve`.

![oc and curl output](10-openshift-ai-cli.png)

### OpenShift console

| Screenshot | What it shows |
| --- | --- |
| ![Project overview](11-openshift-project-overview.png) | Project overview: inventory, utilization and the rollout's events |
| ![Projects](12-openshift-projects.png) | The `ztothez-dev` project, active |
| ![Deployments](14-openshift-deployments.png) | Deployments for the API, the KServe predictor (labelled for the OpenShift AI dashboard) and the UI |
| ![Pods](15-openshift-pods-builds.png) | Image builds from clean exports, the running predictor and UI, pipeline task pods |
| ![Secrets](16-openshift-secrets-names-only.png) | Secret names only: keys lived in the cluster, never in the image or the repository |
| ![ConfigMaps](17-openshift-configmaps-kserve-modelconfig.png) | ConfigMaps, including the KServe model config |
| ![Routes](18-openshift-routes.png) | Routes for the API, the KServe predictor and the UI, all Accepted |
| ![Services](19-openshift-services.png) | Services for the API, the KServe predictor and the UI |

The manifests are in [deploy/openshift/](../deploy/openshift/), and the platform write-up is in [docs/openshift.md](../docs/openshift.md).
