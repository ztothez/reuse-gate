# Labelling the gold set

`data/gold_labels_template.csv` has 20 data pack requests, chosen so that every action the rules produce appears. Labelling
takes about 30 minutes. The scores are reported apart from every automatic metric, as "human-labelled".

1. Copy the template to `data/gold_labels.csv`. Never edit the template itself.
2. For each row, read only `request_text`, `product_context` and `market_context` first, and decide what a good analytics
   governance lead would do. Do not look at `cited_rows` yet, so the system's answer does not steer you.
   - `expected_action`: one of `reuse`, `repair_and_reuse`, `extend`, `new_build`, `retire_and_reuse`, `migrate`, `retire`, `human_review`.
   - `expected_target`: the asset id to reuse, repair, extend or migrate (for example `AST-0142`), or `none`. Use the
     data pack (`data/*.xlsx`, sheets `Analytics_Assets`, `Asset_KPI_Map`, `Asset_Usage`) to decide.
   - `expected_kpis`: the canonical KPI names the request asks for, separated by `;` (for example `Net Sales; Budget Variance`).
     Use the names in the `KPI_Catalog` sheet's `canonical_metric` column.
3. Then look at `cited_rows` and copy into `relevant_cited_rows` the ones that genuinely support the decision, separated by `;`,
   or write `none`.
4. Put your name in `labeller`. Leave a cell empty if you are unsure; empty cells are skipped, not counted as wrong.
5. Score it: `python3 -I scripts/score_gold.py data/estate.db data/gold_labels.csv`. To include it in `data/evaluation.json`,
   rerun `python3 -I scripts/eval_quality.py data/estate.db`.

Two labellers on the same rows, compared, would show how much the labels themselves can be trusted. One labeller cannot.
