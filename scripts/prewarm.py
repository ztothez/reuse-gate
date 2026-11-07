#!/usr/bin/env python3
"""Build data/prewarmed_answers.json for the example requests shown as chips in the UI.

Usage: python3 -I scripts/prewarm.py data/estate.db               calls the live models, reads .env
       python3 -I scripts/prewarm.py data/estate.db --from-cache  uses saved model responses only, no call, no .env
With --from-cache a chip has no saved explanation unless one is already in the local cache, so its explanation comes from the rules.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from reuse_gate.answers import PREWARMED, AnswerStore, key, normalize
from reuse_gate.estate import Estate
from reuse_gate.llm import AITTA_URL, LLM, PRIMARY_MODEL, LLMError, live_client, load_env
from reuse_gate.pipeline import explain_brief, run_request
from reuse_gate.recommend import intent_lists


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("db")
    parser.add_argument("--from-cache", action="store_true")
    args = parser.parse_args(argv)
    if args.from_cache:
        client = LLM(AITTA_URL, "", PRIMARY_MODEL)
        client.max_calls = 0
    else:
        load_env()
        client = live_client()
        if not client.configured:
            sys.exit("no model is configured: set the API keys or use --from-cache")
    est = Estate(args.db)
    chips = json.loads(Path("data/mock_api.json").read_text(encoding="utf-8"))["requests"]
    entries = {}
    for chip in chips:
        text = chip["text"]
        value = client.parse_intent(text, *intent_lists(est))
        model = client.last_model
        store = AnswerStore(prewarmed="/nonexistent", cache_dir="/nonexistent")
        store.entries[key(text)] = {"intent": value, "model": model}
        client.answers = store
        result = run_request(est, {"request_id": "PREWARM", "request_text": text, "product_context": est.all_scope, "market_context": None}, client)
        client.answers = None
        decision = result["recommendation"]
        try:
            explanation = client.explain(text, result["intent"], explain_brief(decision)) if result["ai"]["intent_source"] == "llm" else None
        except LLMError:
            explanation = None
        entries[key(text)] = {"text": normalize(text), "intent": value, "model": model, "action": decision["action"],
                              "target": (decision["target"] or {}).get("id"), "explanation": explanation}
        print(f"{decision['action']:18} source={result['ai']['intent_source']:5} explanation={'yes' if explanation else 'no ':3} {text[:60]}")
    PREWARMED.write_text(json.dumps(entries, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(entries)} requests written to {PREWARMED.relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
