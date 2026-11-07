#!/usr/bin/env python3
"""Human-labelled gold set: write the labelling template, and score a filled-in copy against the system.

Usage:
  python3 -I scripts/score_gold.py data/estate.db --template data/gold_labels_template.csv
  python3 -I scripts/score_gold.py data/estate.db data/gold_labels.csv
How to label: docs/gold_labels.md. Scores are reported as "human-labelled", apart from every automatic metric.
"""
import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from reuse_gate.estate import Estate  # noqa: E402
from reuse_gate.recommend import parse_request, recommend  # noqa: E402

ACTIONS = ("reuse", "repair_and_reuse", "extend", "new_build", "retire_and_reuse", "migrate", "retire", "human_review")
COLUMNS = ("request_id", "request_text", "product_context", "market_context", "expected_action", "expected_target", "expected_kpis",
           "cited_rows", "relevant_cited_rows", "labeller", "notes")
PER_ACTION = 4
TOTAL = 20


def system(est, req):
    intent = parse_request(est, req)
    rec = recommend(est, intent)
    return intent, rec


def template(est, path):
    """20 data pack requests, up to 4 for each action the rules produce, each a different text and market."""
    by_action, seen = {}, set()
    for req in est.requests:
        _, rec = system(est, req)
        key = (req["request_text"], req["market_context"])
        if key in seen or len(by_action.get(rec.action, [])) >= PER_ACTION:
            continue
        seen.add(key)
        by_action.setdefault(rec.action, []).append((req, rec))
    for req in est.requests:  # an action with fewer distinct requests leaves room: fill to TOTAL from the rest
        if sum(map(len, by_action.values())) >= TOTAL:
            break
        key = (req["request_text"], req["market_context"])
        if key not in seen:
            seen.add(key)
            _, rec = system(est, req)
            by_action.setdefault(rec.action, []).append((req, rec))
    rows = [pair for action in sorted(by_action) for pair in by_action[action]]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for req, rec in rows:
            cited = "; ".join(f"{t}:{i}" for t, i, _ in rec.evidence)
            w.writerow([req["request_id"], req["request_text"], req["product_context"], req["market_context"], "", "", "", cited, "", "", ""])
    return len(rows)


def _split(value):
    return [v.strip() for v in (value or "").split(";") if v.strip()]


def score(est, path):
    """Counts and scores for the filled-in rows. Blank cells are not labelled and are skipped."""
    requests = {r["request_id"]: r for r in est.requests}
    s = {"rows": 0, "invalid": [], "action": [0, 0], "target": [0, 0], "kpi_tp": 0, "kpi_fp": 0, "kpi_fn": 0, "kpi_rows": 0,
         "cited": 0, "relevant": 0, "relevance_rows": 0, "labellers": set()}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            req = requests.get((row.get("request_id") or "").strip())
            if not req:
                s["invalid"].append(f"{row.get('request_id')}: not a data pack request")
                continue
            labelled = any((row.get(c) or "").strip() for c in ("expected_action", "expected_target", "expected_kpis", "relevant_cited_rows"))
            if not labelled:
                continue
            s["rows"] += 1
            if (row.get("labeller") or "").strip():
                s["labellers"].add(row["labeller"].strip())
            intent, rec = system(est, req)
            action = (row.get("expected_action") or "").strip()
            if action:
                if action not in ACTIONS:
                    s["invalid"].append(f"{req['request_id']}: unknown action {action}")
                else:
                    s["action"][0] += action == rec.action
                    s["action"][1] += 1
            target = (row.get("expected_target") or "").strip()
            if target:
                s["target"][0] += (target.lower() == "none" and rec.target is None) or target.upper() == (rec.target or "")
                s["target"][1] += 1
            kpis = _split(row.get("expected_kpis"))
            unknown = [k for k in kpis if k not in est.canonical]
            if unknown:
                s["invalid"].append(f"{req['request_id']}: not canonical KPIs {unknown}")
            elif kpis:
                want, got = set(kpis), set(intent.kpis)
                s["kpi_tp"] += len(want & got)
                s["kpi_fp"] += len(got - want)
                s["kpi_fn"] += len(want - got)
                s["kpi_rows"] += 1
            relevant = (row.get("relevant_cited_rows") or "").strip()
            if relevant:
                cited = {f"{t}:{i}" for t, i, _ in rec.evidence}
                marked = set() if relevant.lower() == "none" else set(_split(relevant))
                if marked - cited:
                    s["invalid"].append(f"{req['request_id']}: marked rows that were not cited {sorted(marked - cited)[:3]}")
                s["cited"] += len(cited)
                s["relevant"] += len(marked & cited)
                s["relevance_rows"] += 1
    return s


def group(est, path):
    """The human-labelled metrics group. Not labelled yet gives the metrics with no value."""
    def m(id_, name, hit, n, method, caveat):
        return {"id": id_, "name": name, "value": round(hit / n, 3) if n else None, "unit": "share", "n": n, "method": method,
                "basis": basis, "caveat": caveat}
    s = score(est, path) if path and Path(path).exists() else None
    if not s or not s["rows"]:
        basis = "not labelled yet: copy data/gold_labels_template.csv to data/gold_labels.csv and fill it in (docs/gold_labels.md)"
        s = {"action": [0, 0], "target": [0, 0], "kpi_tp": 0, "kpi_fp": 0, "kpi_fn": 0, "cited": 0, "relevant": 0, "rows": 0}
    else:
        basis = f"{s['rows']} labelled rows in {Path(path).name} by {len(s['labellers']) or 'unnamed'} labeller(s)" + \
                (f"; {len(s['invalid'])} cells skipped as invalid" if s["invalid"] else "")
    small = "Labelled by people on 20 requests at most, so one row moves a score by 5 points or more. "
    return {"group": "human-labelled", "metrics": [
        m("gold_action_accuracy", "Action accuracy (human-labelled)", s["action"][0], s["action"][1],
          "system action equals the labeller's expected action", small + "A labeller who saw the cited rows first may lean towards the system."),
        m("gold_target_accuracy", "Target accuracy (human-labelled)", s["target"][0], s["target"][1],
          "system target equals the expected target, or both are none", small + "Several assets can be acceptable targets; this counts one."),
        m("gold_kpi_precision", "KPI precision (human-labelled)", s["kpi_tp"], s["kpi_tp"] + s["kpi_fp"], "KPIs read that the labeller expected",
          small + "Only canonical KPI names are accepted."),
        m("gold_kpi_recall", "KPI recall (human-labelled)", s["kpi_tp"], s["kpi_tp"] + s["kpi_fn"], "expected KPIs that were read", small),
        m("gold_context_precision", "Cited row relevance (human-labelled)", s["relevant"], s["cited"],
          "cited rows the labeller marked relevant", small + "Relevance is a judgement; two labellers may differ."),
    ]}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("labels", nargs="?")
    ap.add_argument("--template")
    args = ap.parse_args(argv)
    est = Estate(args.db)
    if args.template:
        print(f"{template(est, args.template)} requests written to {args.template}")
        return 0
    if not args.labels:
        ap.error("give a filled-in labels file, or --template OUT")
    out = group(est, args.labels)
    s = score(est, args.labels)
    print(json.dumps(out, indent=2))
    for problem in s["invalid"]:
        print(f"skipped: {problem}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
