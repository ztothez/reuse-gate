#!/usr/bin/env python3
"""Build data/prewarmed_answers.json for the example requests shown as chips in the UI.

Usage: python3 -I scripts/prewarm.py data/estate.db               calls the live models, reads .env
       python3 -I scripts/prewarm.py data/estate.db --from-cache  uses saved model responses only, no call, no .env
       python3 -I scripts/prewarm.py data/estate.db --fill-rules  only updates the current file, no call, no .env
With --from-cache a chip has no saved explanation unless one is already in the local cache, so its explanation comes from the rules.
A chip the model cannot read gets its rules-parsed intent, marked source: rules, so no chip is ever worse than the baseline.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from reuse_gate.answers import PREWARMED, AnswerStore, key, normalize
from reuse_gate.estate import Estate
from reuse_gate.llm import AITTA_URL, LLM, PRIMARY_MODEL, LLMError, live_client, load_env
from reuse_gate.pipeline import explain_brief, rec_json, run_request
from reuse_gate.recommend import clean_llm_intent, intent_lists, parse_request, recommend, rules_intent_record


def chip_request(est, text):
    return {"request_id": "PREWARM", "request_text": text, "product_context": est.all_scope, "market_context": None}


def usable(est, text, value):
    products, _, kpis, _, _ = clean_llm_intent(est, chip_request(est, text), value)
    return bool(products and kpis)


def rules_entry(est, text):
    intent = parse_request(est, chip_request(est, text))
    decision = rec_json(est, intent, recommend(est, intent))["recommendation"]
    return {"text": normalize(text), "source": "rules", "intent": rules_intent_record(intent), "model": None, "action": decision["action"],
            "target": (decision["target"] or {}).get("id"), "explanation": None}


def write(entries):
    PREWARMED.write_text(json.dumps(entries, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(entries)} requests written to {PREWARMED.relative_to(Path.cwd())}")


def fill_rules(est, chips):
    entries = json.loads(PREWARMED.read_text(encoding="utf-8"))
    for chip in chips:
        text = chip["text"]
        entry = entries[key(text)]
        if entry.get("source") == "rules" or not usable(est, text, entry["intent"]):
            entries[key(text)] = rules_entry(est, text)
        else:
            entry["source"] = "llm"
        print(f"{entries[key(text)]['source']:5} {entries[key(text)]['action']:18} {text[:60]}")
    write(entries)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("db")
    parser.add_argument("--from-cache", action="store_true")
    parser.add_argument("--fill-rules", action="store_true")
    args = parser.parse_args(argv)
    if args.fill_rules:
        est = Estate(args.db)
        return fill_rules(est, json.loads(Path("data/mock_api.json").read_text(encoding="utf-8"))["requests"])
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
        if not usable(est, text, value):
            entries[key(text)] = rules_entry(est, text)
            print(f"{entries[key(text)]['action']:18} source=rules explanation=no  {text[:60]}")
            continue
        store = AnswerStore(prewarmed="/nonexistent", cache_dir="/nonexistent")
        store.entries[key(text)] = {"intent": value, "model": model}
        client.answers = store
        result = run_request(est, chip_request(est, text), client)
        client.answers = None
        decision = result["recommendation"]
        try:
            explanation = client.explain(text, result["intent"], explain_brief(decision))
        except LLMError:
            explanation = None
        entries[key(text)] = {"text": normalize(text), "source": "llm", "intent": value, "model": model, "action": decision["action"],
                              "target": (decision["target"] or {}).get("id"), "explanation": explanation}
        print(f"{decision['action']:18} source={result['ai']['intent_source']:5} explanation={'yes' if explanation else 'no ':3} {text[:60]}")
    write(entries)


if __name__ == "__main__":
    main()
