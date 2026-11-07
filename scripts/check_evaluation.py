#!/usr/bin/env python3
"""Evaluation gate: fail when faithfulness, citation validity, retrieval or the guard drop below the documented minimums.

Usage: python3 -I scripts/check_evaluation.py data/estate.db [--file data/evaluation.json]
Without --file it runs the offline evaluation on the code and data at hand (no model keys needed), so the gate measures the
image it runs in. With --file it checks a saved evaluation. Exit 0 when every minimum holds, 1 otherwise.
"""
import argparse
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

# metric id -> (comparison, limit). Documented in docs/openshift.md, "Pipeline gates".
# faithfulness_judge is deliberately not a gate. It is still computed and served in /evaluation with its caveat, but it is
# one model's opinion of another model's text: it was not calibrated against human labels, it can miss or invent problems,
# and a run depends on a third-party provider being up. A pipeline must not pass or fail on that. The hard gates for
# explanations are deterministic: faithfulness_deterministic (every id, KPI, number and status is in the decision or its
# cited rows) and guard_replacement_rate, both reproducible from the same files on every run.
MINIMUMS = {
    "faithfulness_deterministic": (">=", 1.0),  # no AI explanation states an id, number, KPI or status the decision does not support
    "guard_replacement_rate": ("<=", 0.10),
    "citation_validity": (">=", 1.0),  # every cited row exists in the data pack
    "context_precision": (">=", 0.90),
    "context_recall": (">=", 0.95),
}
REQUIRED = set(MINIMUMS)


def check(evaluation):
    """[(id, value, rule, passed)] for every gated metric."""
    metrics = {m["id"]: m for g in evaluation["groups"] for m in g["metrics"]}
    rows = []
    for mid, (op, limit) in MINIMUMS.items():
        value = metrics.get(mid, {}).get("value")
        if value is None:
            rows.append((mid, None, f"{op} {limit}", mid not in REQUIRED))
            continue
        rows.append((mid, value, f"{op} {limit}", value >= limit if op == ">=" else value <= limit))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--file")
    args = ap.parse_args(argv)
    if args.file:
        import json
        evaluation = json.loads(Path(args.file).read_text(encoding="utf-8"))
    else:
        import eval_quality
        from reuse_gate.estate import Estate
        with redirect_stdout(StringIO()):
            evaluation = eval_quality.evaluate(Estate(args.db), gold=None)
    rows = check(evaluation)
    for mid, value, rule, passed in rows:
        print(f"{'PASS' if passed else 'FAIL'} {mid}: {'not run' if value is None else value} (minimum {rule})")
    failed = [r for r in rows if not r[3]]
    print(f"evaluation gate: {len(rows) - len(failed)}/{len(rows)} pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
