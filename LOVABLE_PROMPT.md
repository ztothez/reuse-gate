# Lovable prompt: Reuse Gate front end

Paste everything below the line into Lovable. Then attach `mock_api.json` (the only file it needs).

---

Build a React + TypeScript + Tailwind single-page app called **Reuse Gate**. It is the front end of an AI analytics governance tool for a pharma BI team. Before anyone builds a new dashboard, the tool checks whether an existing report can be reused, repaired, extended, migrated or retired, and asks a human to approve the decision. Do not use Supabase or any database. Do not build login. Keep the look sober and enterprise: white and light gray surfaces, one dark blue accent, clear type, generous spacing. Do not copy any company's branding or logo.

## Data source

- Read `import.meta.env.VITE_API_URL`. If it is set, call the API. If it is unset or any call fails, silently fall back to the attached `mock_api.json` and show a small "Demo data" badge in the header. The mock mode must support the full flow.
- API contract:
  - `POST {API}/recommend` body `{ "text": string }` returns one item shaped like `mock_api.json -> requests[i]`
  - `GET {API}/radar` returns `mock_api.json -> radar`
  - `POST {API}/approve` body `{ "request_id", "decision": "approve"|"reject", "approver", "owner", "review_by" }` returns `{ "ok": true, "registered_id": string }`
- In mock mode, `/recommend` matches the typed text to the closest `requests[i].text` (case-insensitive substring match on the first 30 characters, otherwise return `requests[0]`). `/approve` just returns `ok` with a generated id.

## Layout

Top bar with the app name, a "Demo data" badge when relevant, and three tabs: **New request**, **Radar**, **Decision log**.

### Tab 1: New request
- A large textarea ("Describe the dashboard or report you need") and a Submit button.
- Under it, example chips: one per `requests[i].text` from the mock file. Clicking a chip fills the textarea.
- After submit, show a loading state, then the result view below the form:
  1. **Understood request** card: products, market, KPIs as chips, request kind. If `intent.clarifications` is non-empty, show them as questions the user must answer before continuing.
  2. **Decision banner**, full width, large. Map `recommendation.action` to a label, an icon and a color. Never rely on color alone, always show the label text:
     - `reuse` "Reuse existing report" (green)
     - `repair_and_reuse` "Repair and reuse" (teal)
     - `extend` "Extend an existing report" (blue)
     - `migrate` "Migrate to Power BI" (indigo)
     - `retire_and_reuse` "Reuse and retire duplicates" (teal)
     - `new_build` "New build on a governed model" (amber)
     - `human_review` "Needs human review" (gray)
     - `retire` "Retire" (red)
     Under the banner, show a one line summary of the `rationale` list.
  3. **Target report** card (if `recommendation.target`): name, id, platform, endorsement badge, status, views and users in the last 3 months, owner.
  4. **Build on** line (if `build_on`): "Semantic model SM-065".
  5. **Retire** list and **Repair** list as small tables when non-empty.
  6. **Why** section: the `rationale` strings as a bullet list.
  7. **Evidence** section: each item `{table, id, note}` as a row with a monospace chip `table / id` and the note. Add a short caption: "Every recommendation cites the data it is based on."
  8. **Approval panel** at the bottom: fields for Approver name, Report owner and Review by (date picker, default 12 months out), plus **Approve** and **Reject** buttons. On Approve, call `/approve`, then show a confirmation card "Registered as {registered_id}, owner, review date" and add the decision to the Decision log. Approve is disabled until approver and owner are filled.

### Tab 2: Radar
This view must make problems visible without anyone asking. Load it on tab open.
- Row of stat tiles from `radar.totals`: assets, KPI definitions, ownerless assets, high reach uncertified assets, dead or unused assets.
- A small bar chart of `radar.totals.kpi_status` (canonical, duplicate_candidate, definition_conflict, local_variant). Use labels directly on the bars and a text legend.
- **Conflicting KPI definitions** table from `radar.kpi_conflicts`: metric, number of variants, expandable row showing each variant id, name and status.
- Three tables: **Ownerless assets**, **High reach but not certified** and **Dead or unused assets**. Columns: id, name, views (3 months), endorsement, status.
- Each table row has a "Start review" button that adds it to a local "review queue" (state only).

### Tab 3: Decision log
- Table of decisions made in this session (store in localStorage inside try/catch, fall back to memory): time, request text, action, target, decision, approver, owner, review date.
- At the top, two counters computed from the log: "Decisions made" and "New builds avoided" (decisions where action is not `new_build` and decision is approve).
- Export button that downloads the log as JSON.

## Quality bar
- Fully keyboard accessible, visible focus states, labels on every input, sufficient contrast.
- Responsive down to tablet width.
- Empty, loading and error states for every view.
- Keep components small and typed. Put the API calls and the mock fallback in one `api.ts` file so the backend can be swapped in by setting `VITE_API_URL`.
