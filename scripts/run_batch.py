"""Run the recommender over all business requests and report what it would have avoided.

Usage: python3 scripts/run_batch.py data/estate.db
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from reuse_gate.estate import Estate
from reuse_gate.recommend import parse_request, recommend


def main(db):
    est = Estate(db)
    results = []
    for req in est.requests:
        intent = parse_request(est, req)
        results.append((req, intent, recommend(est, intent)))

    actions = Counter(r.action for _, _, r in results)
    total = len(results)
    avoided = total - actions["new_build"]
    print(f"{total} requests")
    for action, n in actions.most_common():
        print(f"  {action}: {n}")
    print(f"new builds avoided: {avoided}/{total} ({avoided / total:.0%})")
    retire = {aid for _, _, r in results for aid in r.retire}
    print(f"distinct assets flagged for retirement: {len(retire)}")
    print(f"distinct assets to consolidate later: {len({aid for _, _, r in results for aid in r.consolidate})}")
    print(f"requests needing clarification: {sum(1 for _, i, _ in results if i.clarifications)}")

    bad = [(t, k) for _, _, r in results for t, k, _ in r.evidence if not est.exists(t, k)]
    print(f"evidence citations: {sum(len(r.evidence) for _, _, r in results)}, invalid: {len(bad)}")

    print("\nBy request template:")
    by_text = {}
    for req, _, r in results:
        by_text.setdefault(req["request_text"], Counter())[r.action] += 1
    for text, counter in by_text.items():
        print(f"  {text[:85]}\n      {dict(counter)}")

    shown = set()
    print("\nExample explanations:")
    for req, intent, r in results:
        if r.action in shown:
            continue
        shown.add(r.action)
        print(f"\n[{req['request_id']}] {req['request_text']}")
        print(f"  action={r.action} target={r.target} build_on={r.build_on} retire={r.retire[:4]}")
        for line in r.rationale + [f"repair: {x}" for x in r.repair] + [f"clarify: {x}" for x in r.clarifications]:
            print(f"  - {line}")
        for t, k, note in r.evidence[:5]:
            print(f"    cite {t}:{k} ({note})")


if __name__ == "__main__":
    main(sys.argv[1])
