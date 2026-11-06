# Reuse-first analytics factory (Bayer challenge)

Bayer's slide pipeline always ends in a new .PBIP. This adds the missing step: before building, check
what already exists, and recommend reuse, repair, extend, migrate, retire or (last) new build, with evidence.

```
Request -> /grill-me -> Intent -> KPI resolution (canonical first) -> find existing assets
        -> usage, ownership, lineage, governance checks -> recommendation + cited evidence
        -> human approval -> (only if extend/new build) /explore -> /to-spec -> Spec -> render_preview -> Report
        -> register the result with owner and review date
```

## Data

The data pack (`Bayer_SinceAI2026/*.xlsx`) and its SQLite copy (`estate.db`) are synthetic, created by SinceAI.
Bayer's judge confirmed they may be committed to this public repo. They are not real Bayer business data.

## Run

```bash
pip install openpyxl
python3 load_estate.py <Builder_Data_Pack.xlsx> estate.db   # rebuilds the SQLite copy of the data pack
python3 profile_estate.py estate.db                        # what is messy in the estate
python3 run_batch.py estate.db                             # recommendations for all 150 requests
python3 test_recommend.py                                  # property tests
```

## LLM layer

The API uses an OpenAI-compatible model only for intent parsing and plain-language explanations.
The decision remains deterministic and evidence-cited in `recommend.py`. If the model is
unconfigured, exceeds `LLM_MAX_CALLS`, returns invalid JSON, or fails, the rule-based parser
and rationale are used instead.

Configure `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` in the environment before starting
the API. Responses are cached in `.llm_cache/` by default, and `LLM_MAX_CALLS` defaults to 100.
Never commit `.env`, model keys, or the cache.

Evaluate the two configured providers on the 10 distinct business requests with:

```bash
FEATHERLESS_BASE_URL=https://api.featherless.ai/v1 \
FEATHERLESS_API_KEY="$LLM_API_KEY" \
FEATHERLESS_MODEL=zai-org/GLM-5.2 \
AITTA_BASE_URL=https://aitta-api.csc.fi/openai/v1 \
AITTA_API_KEY="$AITTA_API_KEY" \
AITTA_MODEL="$AITTA_MODEL" \
python3 eval_intent.py estate.db
```

The report records field-level intent agreement and downstream recommendation action
agreement with the deterministic parser. Unconfigured providers are explicitly marked
`skipped`; no credentials are included in the report.

## Optional n8n integration

Set `N8N_API_KEY` on the API and configure n8n with the same secret in the
`X-N8N-API-Key` header. The approval workflow can POST the normal approval payload to
`/n8n/approval`; it returns the same registration id as the UI flow. A scheduled n8n
workflow can GET `/n8n/radar-digest` and send its `summary`, `totals`, and review lists
to email or Teams. Both endpoints require the key and never expose it in responses.

## What it does today

- `estate.py`: loads assets, KPIs, models, usage (last 3 months), lineage, signals, backlog.
- `recommend.py`: deterministic decision logic. No LLM, so it is repeatable and auditable. Rules used:
  RULE-001 reuse before build, RULE-002 canonical KPI first, RULE-003 owner required, RULE-005 high reach
  needs trust, RULE-006 do not migrate waste, RULE-007 AI-ready semantics, RULE-008 cite evidence.
- Every recommendation lists evidence as (table, id, note). Tests check that all citations exist.
- Baseline result on the 150 requests (rule-based intent parser): 79 of 150 avoid a new build.
  There are no ground-truth labels in the data pack, so the checks are rule compliance and citation validity.

## Data assumptions

- All data is Bayer's synthetic builder pack. Names in the pack do not reliably match KPI coverage,
  so decisions rely on the KPI map, usage, lineage and governance tables, not on asset names.
- "Alive" means active, Power BI and at least 100 views in the last 3 months.
- Cross-product requests ("by product", "oncology brands") match "All Pharma" assets.

## Next

1. LLM layer: /grill-me (intent and clarifying questions), explanation text.
2. DashboardSpec generation after approval for `new_build` and `extend` decisions, with a governed preview.
3. Approval gate UI and a health "radar" view (duplicates, conflicts, dead assets) shown without prompting.
4. Decision log and registration of new assets with owner and review date.
5. README section for enterprise BI integration: swap the xlsx for Power BI/Fabric metadata APIs.
