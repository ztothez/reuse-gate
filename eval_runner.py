#!/usr/bin/env python3
"""Tiny eval harness.

Each case is one JSON line:
  {"id": "c1", "question": "...", "must_contain": ["..."], "must_not_contain": ["..."]}

Point --target at your own pipeline as module:function. The function takes a question
string and returns an answer string. Without --target it asks the configured LLM directly.
"""
import argparse
import importlib
import json
import sys
import time
from pathlib import Path


def load_cases(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def llm_answer(question):
    from llm import LLM

    return LLM().chat(
        [
            {
                "role": "system",
                "content": "Answer concisely and only from approved definitions. Say 'unknown' if unsure.",
            },
            {"role": "user", "content": question},
        ],
        temperature=0,
    )


def resolve(target):
    if not target:
        return llm_answer
    module, _, func = target.partition(":")
    return getattr(importlib.import_module(module), func)


def check(case, answer):
    low = answer.lower()
    missing = [s for s in case.get("must_contain", []) if s.lower() not in low]
    forbidden = [s for s in case.get("must_not_contain", []) if s.lower() in low]
    return missing, forbidden


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cases")
    ap.add_argument("--target")
    ap.add_argument("--out", default="eval_report.json")
    args = ap.parse_args(argv)

    fn = resolve(args.target)
    results = []
    for case in load_cases(args.cases):
        start = time.time()
        try:
            answer, error = fn(case["question"]), None
        except Exception as exc:  # keep going so one failure does not hide the rest
            answer, error = "", str(exc)
        missing, forbidden = check(case, answer)
        results.append(
            {
                "id": case["id"],
                "ok": error is None and not missing and not forbidden,
                "missing": missing,
                "forbidden": forbidden,
                "error": error,
                "seconds": round(time.time() - start, 2),
                "answer": answer,
            }
        )

    passed = sum(r["ok"] for r in results)
    report = {"passed": passed, "total": len(results), "results": results}
    Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"{passed}/{len(results)} passed -> {args.out}")
    for r in results:
        if not r["ok"]:
            print(f"FAIL {r['id']}: missing={r['missing']} forbidden={r['forbidden']} error={r['error']}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
