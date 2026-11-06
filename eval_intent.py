#!/usr/bin/env python3
"""Compare LLM intent parsing with the rule-based parser on the distinct business requests.

Usage: python3 -I eval_intent.py estate.db [--backends NAME ...]
Writes eval_report.json and docs/eval_results.md. Responses are cached, so a rerun costs nothing.
Keys come from the environment or .env and are never written to the report.

Agreement with the rule parser is not accuracy: the data pack has no ground truth, and a disagreement can
mean the model is right. The numbers show how far the model and the auditable baseline differ.
"""
import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, ".")
from estate import Estate
from llm import LLM, LLMBudgetError, LLMError, LLMGatedError, load_env
from recommend import Intent, clean_llm_intent, parse_request, recommend

FEATHERLESS = "https://api.featherless.ai/v1"
AITTA = "https://aitta-api.csc.fi/openai/v1"
BACKENDS = {
    "featherless/GLM-5.2": (FEATHERLESS, ("FEATHERLESS_API_KEY", "Featherless_AP_KEY"), "zai-org/GLM-5.2"),
    "aitta/Llama-3.3-70B": (AITTA, ("AITTA_API_KEY",), "meta-llama/Llama-3.3-70B-Instruct"),
    "aitta/gpt-oss-120b": (AITTA, ("AITTA_API_KEY",), "openai/gpt-oss-120b"),
    "aitta/gemma-4-31b": (AITTA, ("AITTA_API_KEY",), "google/gemma-4-31b-it"),
}
FIELDS = ("products", "kpis", "kind", "asks_clarification")
TIMEOUT = 300  # Aitta models may need to load on the first call
MAX_CALLS = 40  # 10 requests with retries, per backend


def distinct_requests(est):
    seen = {}
    for request in est.requests:
        seen.setdefault(request["request_text"], request)
    return list(seen.values())


def normalize(intent):
    return {"products": sorted(intent.products), "kpis": sorted(intent.kpis), "kind": intent.kind,
            "asks_clarification": bool(intent.clarifications)}


def compare(est, request, client, previous=None):
    baseline = parse_request(est, request)
    expected = normalize(baseline)
    row = {"id": request["request_id"], "text": request["request_text"], "baseline": expected,
           "baseline_action": recommend(est, baseline).action, "llm": None, "error": None, "error_type": None,
           "agreement": {}, "action": None, "usable": False, "dropped": [], "seconds": None, "cached": False, "tokens": None}
    started = time.monotonic()
    try:
        value = client.parse_intent(
            request["request_text"], est.products + [est.all_scope],
            list(est.markets) + [m["region"] for m in est.markets.values()],
            sorted({k["canonical_metric"] for k in est.kpis.values()}),
        )
        row["cached"] = client.last_cached
        if client.last_cached:  # keep what was measured when the response was first fetched
            row["seconds"], row["tokens"] = previous or (None, None)
        else:
            row["seconds"], row["tokens"] = round(time.monotonic() - started, 2), (client.last_usage or {}).get("total_tokens")
        products, market, kpis, kind, clarifications = clean_llm_intent(est, request, value)
    except LLMBudgetError:
        raise
    except LLMGatedError as exc:
        row.update(error=str(exc), error_type="gated")
        return row
    except (LLMError, TypeError, AttributeError) as exc:
        row.update(error=str(exc), error_type="invalid_output" if "JSON" in str(exc) or "clarifications" in str(exc) else "request_failed")
        return row
    row["dropped"] = [x for x in list(value.get("products", [])) + list(value.get("kpis", []))
                      if x not in products and x not in kpis]
    intent = Intent(request["request_id"], request["request_text"], products, market, kpis, kind, clarifications)
    actual = normalize(intent)
    row["llm"] = {**actual, "clarifications": clarifications}
    row["agreement"] = {f: actual[f] == expected[f] for f in FIELDS}
    row["usable"] = bool(products and kpis)  # otherwise production falls back to the rules
    if row["usable"]:
        row["action"] = recommend(est, intent).action
    return row


def client_for(name):
    base, key_vars, model = BACKENDS[name]
    key = next((os.environ[v] for v in key_vars if os.environ.get(v)), "")
    client = LLM(base, key, model, timeout=TIMEOUT, retries=2, retry_wait=20)
    client.max_calls = MAX_CALLS
    return client if key else None


def evaluate_backend(est, name, previous):
    client = client_for(name)
    if client is None:
        return {"model": BACKENDS[name][2], "status": "skipped", "reason": "no API key in the environment", "results": []}
    results, status = [], "completed"
    for request in distinct_requests(est):
        try:
            row = compare(est, request, client, previous.get((name, request["request_id"])))
        except LLMBudgetError as exc:
            status = f"stopped: {exc}"
            break
        results.append(row)
        print(f"{name} {row['id']} seconds={row['seconds']} cached={row['cached']} error={row['error_type']}", flush=True)
        if row["error_type"] == "gated":
            status = "stopped: model is gated for this key"
            break
    return summarize(name, status, results, client)


def summarize(name, status, results, client):
    ok = [r for r in results if r["llm"]]
    usable = [r for r in ok if r["usable"]]
    live = [r["seconds"] for r in results if r["seconds"] is not None]
    failures = {}
    for r in results:
        if r["error_type"]:
            failures[r["error_type"]] = failures.get(r["error_type"], 0) + 1
    return {
        "model": BACKENDS[name][2], "status": status, "attempted": len(results), "valid": len(ok), "failures": failures,
        "field_agreement": {f: sum(r["agreement"][f] for r in ok) for f in FIELDS},
        "products_kpis_kind_agree": sum(all(r["agreement"][f] for f in FIELDS[:3]) for r in ok),
        "all_fields_agree": sum(all(r["agreement"].values()) for r in ok),
        "usable_intents": len(usable),
        "fell_back_to_rules": len(results) - len(usable),
        "action_agreement": sum(r["action"] == r["baseline_action"] for r in usable),
        "values_outside_allow_list": sum(len(r["dropped"]) for r in ok),
        "latency_seconds": {"mean": round(statistics.mean(live), 2), "median": round(statistics.median(live), 2),
                            "max": max(live)} if live else None,
        "total_tokens": sum(r["tokens"] or 0 for r in results),
        "http_calls_this_run": client.calls,
        "results": results,
    }


def markdown(report):
    n = report["requests"]
    lines = [
        "# Live provider evaluation", "",
        "Generated by `python3 -I eval_intent.py estate.db` from `eval_report.json`. Do not edit by hand.", "",
        f"{n} distinct request texts from the synthetic data pack, parsed by each model and compared with the rule-based parser.",
        "Clarifications are free text, so they are compared as whether a clarification was asked.", "",
        "**Agreement is not accuracy.** The data pack has no ground truth, and a disagreement can mean the model is right.",
        "The LLM never decides: it fills allow-listed fields, then the deterministic rules choose the action.", "",
        "| Backend | Status | Valid | Products | KPIs | Kind | All 3 | Asks | All 4 | Usable | Action agrees | Off-list values | Median s | Max s | Failures |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name, b in report["backends"].items():
        if b["status"] == "skipped":
            lines.append(f"| {name} | skipped: {b['reason']} |" + " - |" * 13)
            continue
        f, lat = b["field_agreement"], b["latency_seconds"] or {}
        lines.append(
            f"| {name} | {b['status']} | {b['valid']}/{n} | {f['products']} | {f['kpis']} | {f['kind']} | {b['products_kpis_kind_agree']} | {f['asks_clarification']} | "
            f"{b['all_fields_agree']} | {b['usable_intents']} | {b['action_agreement']}/{b['usable_intents']} | {b['values_outside_allow_list']} | "
            f"{lat.get('median', '-')} | {lat.get('max', '-')} | {b['failures'] or 'none'} |"
        )
    lines += [
        "", "Column notes: Products, KPIs, Kind and Asks count requests agreeing with the rule parser. All 3 is products, KPIs and kind",
        "together. Asks is low because the models ask a question on nearly every request, while the rule parser asks only when",
        "it finds nothing, so All 4 says little on its own. Usable means the model returned",
        "at least one valid product and KPI; otherwise production falls back to the rules. Action agrees is among usable intents.",
        "Off-list values were removed by the allow list, or replaced because the request names a different product.",
        "Products are counted after that guard, which is what production uses.",
        "Latency is per call, measured when the response was first fetched, and includes retries and any model loading.", "",
        "## Where the backends differ from the rules", "",
    ]
    for name, b in report["backends"].items():
        rows = [r for r in b["results"] if r["error"] or not all(r["agreement"].values())]
        lines += [f"### {name}", ""]
        if not rows:
            lines += ["No disagreements." if b["results"] else "Not run.", ""]
        for r in rows:
            if r["error"]:
                lines.append(f"- {r['id']} {r['text'][:70]}: failed, {r['error']}")
                continue
            diffs = [f"{f}: rules {r['baseline'][f]}, model {r['llm'][f]}" for f in FIELDS if not r["agreement"][f]]
            lines.append(f"- {r['id']} {r['text'][:70]}: " + "; ".join(diffs))
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("db")
    parser.add_argument("--backends", nargs="+", choices=sorted(BACKENDS), default=list(BACKENDS))
    args = parser.parse_args(argv)
    load_env()
    est = Estate(args.db)
    previous = {}
    old = Path("eval_report.json")
    if old.exists():
        for name, b in json.loads(old.read_text())["backends"].items():
            previous |= {(name, r["id"]): (r["seconds"], r["tokens"]) for r in b["results"] if r["seconds"] is not None}
    with ThreadPoolExecutor(len(args.backends)) as pool:
        futures = {n: pool.submit(evaluate_backend, Estate(args.db), n, previous) for n in args.backends}
    report = {"requests": len(distinct_requests(est)), "backends": {n: f.result() for n, f in futures.items()}}
    old.write_text(json.dumps(report, indent=2), encoding="utf-8")
    Path("docs").mkdir(exist_ok=True)
    Path("docs/eval_results.md").write_text(markdown(report) + "\n", encoding="utf-8")
    print(markdown(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
