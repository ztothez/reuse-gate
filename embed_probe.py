"""Check embedding KPI matching on hand-written synonyms. A sanity probe, not ground truth.

Usage: python3 -I embed_probe.py estate.db   -> writes docs/embedding_probe.md
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, ".")
from estate import Estate
from kpi_match import rank
from llm import LLM, load_env

MODELS = ["intfloat/multilingual-e5-large", "lightonai/modernbert-embed-large"]
# phrase, expected canonical KPI, or None when nothing in the catalog should match
PROBES = [
    ("revenue", "Net Sales"), ("turnover", "Net Sales"), ("sales increase", "Net Sales Growth"),
    ("OTIF", "On-Time In-Full"), ("on time delivery", "On-Time In-Full"), ("stock cover", "Inventory Coverage"),
    ("weeks of stock", "Inventory Coverage"), ("forecast error", "Forecast Variance"), ("spend against budget", "Budget Variance"),
    ("payer coverage", "Market Access Coverage"), ("report usage", "Report Adoption"), ("share of certified reports", "Certified Asset Share"),
    ("employee happiness", None), ("weather in Turku", None), ("office parking spaces", None), ("social media followers", None),
]
THRESHOLDS = [0.5, 0.6, 0.7, 0.8]


def main(db):
    load_env()
    est = Estate(db)
    kpis = sorted(est.canonical)
    client = LLM("https://aitta-api.csc.fi/openai/v1", os.environ["AITTA_API_KEY"], "embed", timeout=300)
    lines = ["# Embedding probe", "", f"{len(PROBES)} hand-written phrases ({sum(e is None for _, e in PROBES)} should match nothing). A sanity check, not ground truth.",
             "Match means the top KPI scores at or above the threshold. A correct outcome is the expected KPI, or no match when none is expected.", "",
             "| Model | Top-1 right (of 12 with a KPI) | " + " | ".join(f"Correct at {t}" for t in THRESHOLDS) + " |",
             "| --- | --- | " + " | ".join("---" for _ in THRESHOLDS) + " |"]
    detail = []
    for model in MODELS:
        tops = [(p, e, *rank(client, p, kpis, model)[0]) for p, e in PROBES]
        top1 = sum(k == e for _, e, _, k in tops if e)
        scores = [sum((k == e and s >= t) if e else s < t for _, e, s, k in tops) for t in THRESHOLDS]
        lines.append(f"| {model} | {top1} | " + " | ".join(f"{s}/{len(PROBES)}" for s in scores) + " |")
        detail += ["", f"## {model}", "", "| Phrase | Expected | Top KPI | Score |", "| --- | --- | --- | --- |"]
        detail += [f"| {p} | {e or 'none'} | {k} | {s} |" for p, e, s, k in tops]
    Path("docs").mkdir(exist_ok=True)
    Path("docs/embedding_probe.md").write_text("\n".join(lines + detail) + "\n", encoding="utf-8")
    print("\n".join(lines + detail))


if __name__ == "__main__":
    main(sys.argv[1])
