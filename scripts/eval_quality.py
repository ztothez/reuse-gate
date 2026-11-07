#!/usr/bin/env python3
"""Quality evaluation: generation, retrieval, intent and decisions, and the data pack. Writes data/evaluation.json.

Usage: python3 -I scripts/eval_quality.py data/estate.db [--out data/evaluation.json] [--gold data/gold_labels.csv]
Keys come from the environment only, as in eval_runner.py; this script never reads .env. Without the provider's key the
model-based metrics are reported as not run. Model answers are cached under .llm_cache, so a rerun costs little.

Providers, from the environment (defaults: both on CSC Aitta, generator openai/gpt-oss-120b, judges tried in JUDGES order):
  EVAL_GENERATOR_PROVIDER, EVAL_GENERATOR_BASE_URL, EVAL_GENERATOR_MODEL
  EVAL_JUDGE_PROVIDER, EVAL_JUDGE_BASE_URL, EVAL_JUDGE_MODEL
Provider is aitta (key AITTA_API_KEY), together (TOGETHER_API_KEY) or featherless (FEATHERLESS_API_KEY or Featherless_AP_KEY). For example:
  EVAL_GENERATOR_PROVIDER=together EVAL_JUDGE_PROVIDER=together EVAL_JUDGE_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
"""
import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))
import eval_messy  # noqa: E402
import score_gold  # noqa: E402
from reuse_gate import faithfulness  # noqa: E402
from reuse_gate.answers import AnswerStore  # noqa: E402
from reuse_gate.estate import Estate  # noqa: E402
from reuse_gate.llm import AITTA_URL, FEATHERLESS_URL, LLM, TOGETHER_URL, LLMError, NoLLM  # noqa: E402
from reuse_gate.pipeline import explain_brief, run_request  # noqa: E402
from reuse_gate.recommend import parse_request, recommend, target_coverage  # noqa: E402
from reuse_gate.remediate import simulate, snapshot_id  # noqa: E402
from reuse_gate.spec_gate import _summary, batch, canonical_only, estate_impact  # noqa: E402

GENERATOR = "openai/gpt-oss-120b"
JUDGES = ("meta-llama/Llama-3.3-70B-Instruct", "google/gemma-4-31b-it")  # different families from the generator and GLM
PROVIDERS = {"aitta": ("CSC Aitta", AITTA_URL, "AITTA_API_KEY"), "together": ("Together AI", TOGETHER_URL, "TOGETHER_API_KEY"),
             "featherless": ("Featherless", FEATHERLESS_URL, ("FEATHERLESS_API_KEY", "Featherless_AP_KEY"))}
DESIGNED_PROVIDER = "aitta"  # the evaluation was designed for CSC Aitta
JUDGE_PROMPT = ROOT / "data/judge_prompt.txt"
MIN_JUDGED = 30
AS_OF = "2026-11-07"
ACTION_WORDS = {"reuse": ["reuse", "use the existing", "use it"], "repair_and_reuse": ["repair", "fix"], "extend": ["extend"],
                "new_build": ["new", "build"], "migrate": ["migrat", "move"], "retire": ["retire"], "retire_and_reuse": ["retire"],
                "human_review": ["review", "person", "human", "manual"]}
REFERENCES = {"owner_id": ("Owners", "owner_id"), "workspace_id": ("Workspaces", "workspace_id"), "model_id": ("Semantic_Models", "model_id"),
              "kpi_id": ("KPI_Catalog", "kpi_id"), "asset_id": ("Analytics_Assets", "asset_id"), "product_id": ("Products", "product_id"),
              "market_id": ("Markets", "market_id"), "source_asset_id": ("Analytics_Assets", "asset_id"),
              "candidate_target_model_id": ("Semantic_Models", "model_id")}


def metric(id_, name, value, unit, n, method, basis, caveat):
    return {"id": id_, "name": name, "value": value, "unit": unit, "n": n, "method": method, "basis": basis, "caveat": caveat}


def ratio(a, b, digits=3):
    return round(a / b, digits) if b else None


# ---------------------------------------------------------------- generation

def explanation_cases(est, generator):
    """(result, lines, source) for every AI explanation available: the saved chips, plus fresh ones when a key is set."""
    cases, store = [], AnswerStore()

    class Saved:
        configured, answers, last_model = True, store, None

        def __getattr__(self, name):
            raise RuntimeError("saved answers only")

    for text in dict.fromkeys(r["request_text"] for r in est.requests):
        req = {"request_id": "EVAL", "request_text": text, "product_context": est.all_scope, "market_context": None}
        result = run_request(est, req, Saved(), as_of=AS_OF)
        lines = store.explanation(text, result["recommendation"]["action"], (result["recommendation"]["target"] or {}).get("id"))
        if result["ai"]["intent_source"] == "llm" and lines:
            cases.append((result, lines, "saved chip"))
    if generator is None:
        return cases
    texts = list(dict.fromkeys(r["request_text"] for r in est.requests)) + [r["text"] for r in eval_messy.load(ROOT / "data/messy_requests.jsonl")]
    for n, text in enumerate(texts):
        req = {"request_id": f"EVAL-{n}", "request_text": text, "product_context": est.all_scope, "market_context": None}
        result = run_request(est, req, NoLLM(), as_of=AS_OF)  # the rules decide, so every explanation explains a known decision
        try:
            lines = generator.explain(text, result["intent"], explain_brief(result["recommendation"]))
        except Exception as exc:  # one failure must not hide the rest
            print(f"explain failed for {text[:40]!r}: {failure(generator, exc)}", file=sys.stderr)
            continue
        cases.append((result, lines, "generated"))
    return cases


def relevance(result, lines):
    """Share of the required items an explanation names: the action, the target (id or name) and each requested KPI."""
    text = " ".join(lines).translate(faithfulness.DASHES).lower()
    rec = result["recommendation"]
    needed = [any(w in text for w in ACTION_WORDS.get(rec["action"], [rec["action"]]))]
    if rec["target"]:
        needed.append(rec["target"]["id"].lower() in text or rec["target"]["name"].lower() in text)
    needed += [k.lower() in text for k in result["intent"]["kpis"]]
    return sum(needed) / len(needed)


def judge(client, est, result, lines, prompt):
    """(faithful, unsupported claims). The judge sees the same request, intent and decision brief the generator was given
    (explain_brief: coverage, retire and consolidate lists, the first 15 citations), plus the cited rows themselves, so it
    does not mark a claim unsupported only because the generator had evidence the judge was not shown."""
    rec = result["recommendation"]
    rows = [faithfulness._row(est, e["table"], e["id"]) for e in rec["evidence"]][:40]
    value = client.json_chat([{"role": "system", "content": prompt},
                              {"role": "user", "content": json.dumps({"explanation": lines, "request": result.get("text"),
                                                                      "intent": result["intent"], "decision": explain_brief(rec),
                                                                      "cited_rows": rows}, default=str)}], temperature=0, max_tokens=800)
    if not isinstance(value.get("faithful"), bool):
        raise ValueError("judge answer has no faithful flag")
    claims = value.get("unsupported_claims")
    return value["faithful"], [str(c) for c in claims] if isinstance(claims, list) else []


def role(kind):
    """(provider id, display name, base URL, key env, model or None) for the generator or the judge, from EVAL_<KIND>_*."""
    provider = os.environ.get(f"EVAL_{kind}_PROVIDER", DESIGNED_PROVIDER).strip().lower()
    if provider not in PROVIDERS:
        raise SystemExit(f"EVAL_{kind}_PROVIDER must be one of {', '.join(PROVIDERS)}")
    name, url, key_env = PROVIDERS[provider]
    if isinstance(key_env, tuple):  # the first name that is set, else the first name
        key_env = next((k for k in key_env if os.environ.get(k)), key_env[0])
    return provider, name, os.environ.get(f"EVAL_{kind}_BASE_URL") or url, key_env, os.environ.get(f"EVAL_{kind}_MODEL") or None


def provider_note(provider, name, what):
    if provider == DESIGNED_PROVIDER:
        return ""
    return f" The {what} ran on {name}, which differs from the earlier design (CSC Aitta), so it is not directly comparable with earlier runs."


def generation(est, generator, judge_client, judge_model):
    cases = explanation_cases(est, generator)
    gen_provider, gen_name, _, gen_key, _ = role("GENERATOR")
    judge_provider, judge_name, _, judge_key, _ = role("JUDGE")
    gen_model = getattr(generator, "model", None) or GENERATOR
    used = f" Generated explanations by {gen_model} on {gen_name}." if generator else ""
    gen_note = provider_note(gen_provider, gen_name, "generator") if generator else ""
    distinct = {" ".join(lines) for _, lines, _ in cases}
    checks = [faithfulness.check(est, r, l) for r, l, _ in cases]
    passed = sum(c["passed"] for c in checks)
    sources = Counter(s for _, _, s in cases)
    basis = ", ".join(f"{n} {s}" for s, n in sources.items()) or "none"
    out = [
        metric("faithfulness_deterministic", "Faithfulness (deterministic claim check)", ratio(passed, len(checks)), "share", len(checks),
               "every asset id, KPI name, number and status in the explanation must appear in the decision or the rows it cites" + used,
               f"AI explanations: {basis}",
               "Shows that no invented ids, numbers, KPIs or statuses got through. Does not show that the reasoning is right, that a true fact is "
               "attached to the right asset, or that the explanation is complete. "
               + ("" if generator else f"No {gen_key} in the environment, so only the saved chip explanations were checked.") + gen_note),
        metric("guard_replacement_rate", "Guard replacement rate", ratio(len(checks) - passed, len(checks)), "share", len(checks),
               "share of AI explanations the pipeline guard would replace with the rules explanation" + used, f"AI explanations: {basis}",
               "A low rate shows the generator rarely states unsupported facts on these requests. It depends on the prompt and model of this run, "
               "and says nothing about requests unlike these." + gen_note),
        metric("answer_relevance", "Answer relevance", round(sum(relevance(r, l) for r, l, _ in cases) / len(cases), 3) if cases else None, "share",
               len(cases), "mean share of required items named: the action, the target and each requested KPI" + used, f"AI explanations: {basis}",
               "Keyword presence, not understanding: an explanation can name everything and still be unclear, and a correct synonym counts as missing." + gen_note),
    ]
    judged = None
    if judge_client and len(distinct) >= MIN_JUDGED:
        prompt, verdicts, seen = JUDGE_PROMPT.read_text(encoding="utf-8"), [], set()
        for result, lines, _ in cases:
            key = " ".join(lines)
            if key in seen:
                continue
            seen.add(key)
            try:
                faithful, claims = judge(judge_client, est, result, lines, prompt)
            except Exception as exc:
                print(f"judge failed: {failure(judge_client, exc)}", file=sys.stderr)
                continue
            verdicts.append(faithful)
            if not faithful:  # every failing verdict with the judge's reason, for a person to read
                rec = result["recommendation"]
                print(f"UNFAITHFUL per judge: {rec['action']} {(rec['target'] or {}).get('id', '-')}\n"
                      f"  explanation: {' '.join(lines)}\n"
                      + "".join(f"  unsupported: {c}\n" for c in claims or ["(the judge gave no reason)"]), file=sys.stderr)
        judged = metric("faithfulness_judge", "Faithfulness (LLM judge)", ratio(sum(verdicts), len(verdicts)), "share", len(verdicts),
                        f"{judge_model} on {judge_name} judges each distinct explanation against the same request, intent and decision brief the generator saw, and the cited rows; prompt in data/judge_prompt.txt."
                        + (f" Explanations by {gen_model} on {gen_name}." if generator else ""),
                        f"{len(distinct)} distinct explanations by {gen_model}",
                        "A model's opinion, not ground truth: the judge can miss or invent problems, and it was not calibrated against human labels."
                        + provider_note(judge_provider, judge_name, "judge") + gen_note)
    if judged is None:
        why = f"no {judge_key} in the environment" if not judge_client else f"only {len(distinct)} distinct explanations, fewer than {MIN_JUDGED}"
        planned = role("JUDGE")[4] or JUDGES[0]
        judged = metric("faithfulness_judge", "Faithfulness (LLM judge)", None, "share", 0, f"{planned} as judge; prompt in data/judge_prompt.txt",
                        "not run", f"Not run: {why}. Run scripts/eval_quality.py with the key in the environment.")
    out.insert(1, judged)
    return {"group": "generation", "metrics": out}


# ---------------------------------------------------------------- retrieval

def _relevant(est, intent, rec, table, key):
    target, model = rec.target, est.asset_model(rec.target) if rec.target else None
    models = {m for m in (model, rec.build_on) if m}
    kpis = set(intent.kpis)
    if table in ("Analytics_Assets", "Asset_Usage", "Migration_Backlog"):
        return key == target
    if table == "Governance_Signals":
        return target is not None and any(s["signal_id"] == key for s in est.signals.get(target, []))
    if table == "Asset_KPI_Map":
        asset, _, kid = key.partition(":")
        return asset == target or est.kpis.get(kid, {}).get("canonical_metric") in kpis
    if table == "Lineage_Edges":
        src, _, dst = key.partition("->")
        return bool({src, dst} & ({target} | models))
    if table == "Semantic_Models":
        return key in models
    if table == "KPI_Catalog":
        return est.kpis.get(key, {}).get("canonical_metric") in kpis
    if table == "Governance_Rules":
        return True  # cited rules are the rules the decision invoked
    if table == "Owners":
        owners = {(est.assets.get(target) or {}).get("owner_id")} | {est.models[m]["owner_id"] for m in models}
        return key in owners
    return False


def _required(est, intent, rec):
    keys = set()
    if rec.target:
        keys.add(("Analytics_Assets", rec.target))
    if rec.action in ("reuse", "repair_and_reuse", "extend", "retire_and_reuse"):
        keys.add(("Asset_Usage", rec.target))
        keys |= {("Asset_KPI_Map", c["map_id"]) for c in target_coverage(est, intent, rec.target)["covered"]}
    if rec.action == "migrate":
        keys.add(("Migration_Backlog", rec.target))
    if rec.action == "new_build":
        if rec.build_on:
            keys.add(("Semantic_Models", rec.build_on))
        keys |= {("KPI_Catalog", est.canonical[k]) for k in intent.kpis if k in est.canonical}
    return keys


def retrieval(est):
    cited = relevant = required = found = 0
    by_table = Counter()
    for req in est.requests:
        intent = parse_request(est, req)
        rec = recommend(est, intent)
        rows = {(t, i) for t, i, _ in rec.evidence}
        for t, i, _ in rec.evidence:
            cited += 1
            ok = _relevant(est, intent, rec, t, i)
            relevant += ok
            if not ok:
                by_table[t] += 1
        need = _required(est, intent, rec) | ({("rule", "any")} if rec.evidence or rec.action != "human_review" else set())
        required += len(need)
        found += sum(k in rows for k in need if k[0] != "rule") + (("rule", "any") in need and any(t == "Governance_Rules" for t, _ in rows))
    other = ", ".join(f"{t} {n}" for t, n in by_table.most_common())
    return {"group": "retrieval", "metrics": [
        metric("context_precision", "Context precision", ratio(relevant, cited), "share", cited,
               "cited rows that belong to the target asset, its semantic model or the model built on, the requested KPIs, or an invoked rule",
               f"150 batch requests, rules parser. Not counted as relevant: {other or 'none'}",
               "By this definition, rows about assets listed to retire or consolidate later, and about legacy workbooks in a migration, count as not "
               "relevant even though the decision needs them. It shows focus, not whether each row was necessary."),
        metric("context_recall", "Context recall", ratio(found, required), "share", required,
               "required rows present: the target and its usage, its primary KPI map rows, the backlog row for a migration, the model and canonical KPIs "
               "for a new build, and at least one rule",
               "150 batch requests, rules parser",
               "The required set is our own definition of a minimal justification, written by the same person as the rules, so 100% shows the rules "
               "cite what they were designed to cite, not that nothing else was needed."),
    ]}


# ---------------------------------------------------------------- intent and decisions

def intent_decisions(est):
    rows = eval_messy.load(ROOT / "data/messy_requests.jsonl")
    results = eval_messy.evaluate(est, rows)
    first = sum(all(r["first"].values()) for r in results)
    final = sum(all(r["final"].values()) for r in results)
    tp = fp = fn = tp1 = fp1 = fn1 = 0
    for row in rows:
        want = set(row["expected"]["kpis"])
        first_result, final_result = eval_messy.run_loop(est, row, eval_messy.simulate)
        got1, got = set(first_result["intent"]["kpis"]), set(final_result["intent"]["kpis"])
        tp1, fp1, fn1 = tp1 + len(got1 & want), fp1 + len(got1 - want), fn1 + len(want - got1)
        tp, fp, fn = tp + len(got & want), fp + len(got - want), fn + len(want - got)
    report = json.loads((ROOT / "docs/eval_report.json").read_text(encoding="utf-8"))
    backends = report["backends"]
    agree = []
    for name in ("aitta/gpt-oss-120b", "featherless/GLM-5.2"):
        b = backends.get(name)
        if b:
            agree.append(metric(f"agreement_rules_{name.split('/')[-1].lower()}", f"Decision agreement: rules and {name.split('/')[-1]}",
                                ratio(b["action_agreement"], b["attempted"]), "share", b["attempted"],
                                "same action from the model's intent as from the rule parser's, per distinct request",
                                f"docs/eval_report.json; field agreement {b['field_agreement']}",
                                "Agreement is not accuracy: there is no ground truth and the model can be right where the rules are not. "
                                "Measured on the 10 clean texts with an earlier prompt version and pipeline."))
    pair = {}
    for name in ("aitta/gpt-oss-120b", "featherless/GLM-5.2"):
        for r in (backends.get(name) or {}).get("results", []):
            if r.get("usable"):
                pair.setdefault(r["id"], {})[name] = r["action"]
    both = [v for v in pair.values() if len(v) == 2]
    agree.append(metric("agreement_gptoss_glm", "Decision agreement: gpt-oss and GLM", ratio(sum(len(set(v.values())) == 1 for v in both), len(both)), "share",
                        len(both), "same action from both models' intents, on requests where both gave a usable intent", "docs/eval_report.json",
                        "Small sample, and only requests both models could read. Two models agreeing can both be wrong."))
    bad = total = 0
    for req in est.requests:
        rec = recommend(est, parse_request(est, req))
        total += len(rec.evidence)
        bad += sum(not est.exists(t, i) for t, i, _ in rec.evidence)
    return {"group": "intent and decisions", "metrics": [
        metric("intent_accuracy_first", "Intent accuracy, first reading", ratio(first, len(rows)), "share", len(rows),
               "products, market, KPIs and kind all equal the expected clean intent, before any question", "data/messy_requests.jsonl, rules only",
               "The expected intents and the vocabulary were written by the same person, with these prompts in view. Not a measure of unseen language."),
        metric("intent_accuracy_after_loop", "Intent accuracy, after the clarification loop", ratio(final, len(rows)), "share", len(rows),
               "same check after the loop, with answers simulated from the expected intent", "data/messy_requests.jsonl, rules only",
               "Answers are simulated and always helpful, so this is a best case for real requesters."),
        metric("kpi_precision_first", "KPI matching precision, first reading", ratio(tp1, tp1 + fp1), "share", tp1 + fp1,
               "requested KPIs read correctly over all KPIs read, micro-averaged", "data/messy_requests.jsonl, rules only",
               "Misspelled and non-English readings are held as proposals and are not counted here until confirmed."),
        metric("kpi_recall_first", "KPI matching recall, first reading", ratio(tp1, tp1 + fn1), "share", tp1 + fn1,
               "expected KPIs that were read, micro-averaged", "data/messy_requests.jsonl, rules only", "Same caveat as precision."),
        metric("kpi_precision_after_loop", "KPI matching precision, after the loop", ratio(tp, tp + fp), "share", tp + fp, "as above, after the loop",
               "data/messy_requests.jsonl, rules only", "Simulated answers name the KPIs directly, which makes this easier than real use."),
        metric("kpi_recall_after_loop", "KPI matching recall, after the loop", ratio(tp, tp + fn), "share", tp + fn, "as above, after the loop",
               "data/messy_requests.jsonl, rules only", "Same caveat."),
        *agree,
        metric("citation_validity", "Citation validity", ratio(total - bad, total), "share", total, "every cited (table, id) exists in the data pack",
               f"150 batch requests: {total} citations checked, {bad} invalid",
               "A valid citation is a real row. It does not show the row supports the claim it is cited for; context precision looks at that."),
    ]}


# ---------------------------------------------------------------- data

def data_quality(est):
    con = sqlite3.connect(Path(est.con.execute("PRAGMA database_list").fetchone()[2]))
    tables = [t for (t,) in con.execute("select name from sqlite_master where type='table'")]
    checked = broken = 0
    broken_by = Counter()
    for table in tables:
        cols = [r[1] for r in con.execute(f"pragma table_info({table})")]
        own = cols[0]
        for col in cols:
            if col == own or col not in REFERENCES:
                continue
            ref_table, ref_col = REFERENCES[col]
            if ref_table == table:
                continue
            n, missing = con.execute(f"select count(*), sum(r.{ref_col} is null) from {table} t left join {ref_table} r on t.{col} = r.{ref_col} "
                                     f"where t.{col} is not null and t.{col} != ''").fetchone()
            checked, broken = checked + n, broken + (missing or 0)
            if missing:
                broken_by[f"{table}.{col}"] += missing
    for col in ("source_id", "target_id"):
        n, missing = con.execute(f"select count(*), sum({col} not in (select asset_id from Analytics_Assets) and {col} not in (select model_id from Semantic_Models)) "
                                 f"from Lineage_Edges").fetchone()
        checked, broken = checked + n, broken + (missing or 0)
        if missing:
            broken_by[f"Lineage_Edges.{col}"] += missing
    cells = nulls = 0
    null_cols = Counter()
    for table in tables:
        cols = [r[1] for r in con.execute(f"pragma table_info({table})")]
        rows = con.execute(f"select count(*) from {table}").fetchone()[0]
        for col in cols:
            n = con.execute(f"select count(*) from {table} where {col} is null or trim({col}) = ''").fetchone()[0]
            cells, nulls = cells + rows, nulls + n
            if n:
                null_cols[f"{table}.{col}"] = round(n / rows, 3)
    ownerless = sum(not est.owner_active(a) for a in est.assets.values())
    no_owner_id = sum(not a["owner_id"] for a in est.assets.values())
    unknown_owner = sum(bool(a["owner_id"]) and a["owner_id"] not in est.owners for a in est.assets.values())
    names = Counter(a["asset_name"] for a in est.assets.values())
    dup_names = sum(n for n in names.values() if n > 1)
    conflicts = sum(1 for k in est.kpis.values() if k["definition_status"] != "canonical")
    top_nulls = ", ".join(f"{c} {v:.0%}" for c, v in null_cols.most_common(5))
    return {"group": "data", "metrics": [
        metric("referential_integrity", "Referential integrity", ratio(checked - broken, checked), "share", checked,
               "id columns that point to another table (owners, workspaces, models, KPIs, assets, products, markets, lineage ends) resolve to a row",
               "data pack in data/estate.db; broken: " + (", ".join(f"{k} {v}" for k, v in broken_by.items()) or "none"),
               "Checks that references resolve, not that they are right: an asset can point to an existing but wrong owner."),
        metric("null_rate", "Null or empty cells", ratio(nulls, cells, 4), "share", cells, "share of all cells that are null or empty",
               f"all {len(tables)} tables; highest columns: {top_nulls or 'none'}",
               "Some columns are empty by design (for example optional notes), so a null is not always a defect."),
        metric("ownerless_assets", "Assets with no active owner", ownerless, "assets", len(est.assets),
               "no owner id, an owner id not in the Owners table, or an inactive owner",
               f"{no_owner_id} with no owner id at all, {unknown_owner} with an unknown owner id, the rest with an inactive owner",
               "Synthetic data, deliberately messy. Counts gaps, not how much they matter."),
        metric("duplicate_asset_names", "Assets sharing a name", dup_names, "assets", len(est.assets), "assets whose name equals another asset's name",
               f"{sum(n > 1 for n in names.values())} names used more than once",
               "Names are not used for matching because they do not reflect coverage. Same name does not mean same content."),
        metric("non_canonical_kpis", "Non-canonical KPI definitions", conflicts, "definitions", len(est.kpis),
               "KPI catalog rows whose definition status is not canonical (duplicates, conflicts, local variants)", "KPI_Catalog",
               "A variant can be legitimate locally; this counts what needs a steward's decision."),
    ]}


def impact(est):
    """Headline numbers for the pitch, each computed here from the same code the API runs, with what it assumes."""
    rows = batch(est)
    specs = [r for r in rows if r["spec"]]
    passing = sum(r["passed"] for r in specs)
    blocked = [r for r in specs if r["model"] == "SM-065" and not r["passed"]]
    fix = {"type": "assign_owner", "target": "SM-065", "owner_id": "OWN-039"}
    cleared = sum(simulate(est, {"request_id": r["id"], "remediations": [fix]})["passed_after"] for r in blocked)
    texts = {r["request_text"] for r in est.requests}
    blocked_texts = {next(q["request_text"] for q in est.requests if q["request_id"] == r["id"]) for r in blocked}
    strict = _summary(canonical_only(est), batch(canonical_only(est)))["New builds avoided"]
    avoided = len(rows) - sum(r["action"] == "new_build" for r in rows)
    cited = invalid = 0
    for req in est.requests:
        rec = recommend(est, parse_request(est, req))
        cited += len(rec.evidence)
        invalid += sum(not est.exists(t, i) for t, i, _ in rec.evidence)
    e = estate_impact(est)
    return {"group": "impact", "metrics": [
        metric("new_builds_avoided", "New builds avoided (modelled)", avoided, "requests", len(rows),
               "requests whose recommendation is not new_build", "Assumes every recommendation is approved and carried out as recommended.",
               "A modelled outcome over the synthetic request log, not a measured saving. Human review counts as avoided here, and a person may still build."),
        metric("new_builds_avoided_canonical_only", "New builds avoided, canonical definitions only", int(strict.split("/")[0]), "requests", len(rows),
               "same count, but a primary KPI row on a conflicting or local definition no longer qualifies a target",
               "Sensitivity check on one rule choice; the rule in use has not changed.",
               "Shows how much the headline depends on accepting non-canonical definitions as repairable. Other rule choices were not varied."),
        metric("requests_and_texts", "Requests in the data pack", len(est.requests), "requests", len(texts),
               f"{len(est.requests)} business requests from {len(texts)} distinct texts", "The data pack's Business_Requests sheet as given.",
               "Repeated texts with different products and markets, so 150 decisions are not 150 independent cases."),
        metric("citations_valid", "Citations checked", cited, "citations", cited, "every cited (table, id) exists in the data pack",
               f"{cited} citations over 150 requests, {invalid} invalid. Assumes the data pack is the source of truth.",
               "A valid citation is a real row, not proof that the row supports the claim."),
        metric("specs_passing_today", "Specs passing every gate today", passing, "specs", len(specs),
               "new_build and extend specs that pass all 7 gates, with the owner the system proposes", "Today's data pack, owners as recorded.",
               "Gates check governance rules, not whether the spec is what the requester wanted."),
        metric("specs_passing_after_owner_fix", "Specs passing after the SM-065 owner fix (simulated)", passing + cleared, "specs", len(specs),
               f"{len(blocked)} SM-065 specs from {len(blocked_texts)} distinct request texts rerun with an active owner (OWN-039) on SM-065 in memory",
               "Assumes one active owner is assigned to SM-065; simulated, never written to the data pack. Any of the 47 active owners gives the same result.",
               "Modelled specs, not reports anyone has built, and the 80 come from only 7 distinct texts."),
        metric("estate_assets_today", "Assets in the estate today", e["today"], "assets", e["today"], "Analytics_Assets rows",
               "The data pack as given.", "Counts assets, not their quality or use."),
        metric("estate_assets_with_gate", "Assets after 150 requests, with Reuse Gate (projection)", e["with"], "assets", e["requests"],
               f"today + {e['builds']} new builds - {e['retired']} retired", "Assumes every recommendation is carried out, and human review adds nothing.",
               f"A projection. The {e['builds']} builds cover {e['distinct_builds']} distinct combinations, so a real team could build fewer."),
        metric("estate_assets_no_check", "Assets after 150 requests, with no check (projection)", e["without"], "assets", e["requests"],
               f"today + {e['requests']} new builds", "Assumes every request becomes one new asset; the data pack does not record what would have happened.",
               "An upper-bound projection, not an observed outcome."),
    ]}


def failure(client, exc):
    """provider, model, HTTP status and a short reason. Never the key, never more than 120 characters of a reply."""
    status = getattr(exc, "status", None)
    reason = getattr(exc, "detail", "") or getattr(exc, "code", "") or type(exc).__name__
    return (f"{getattr(client, 'provider_name', '?')} {getattr(client, 'model', '?')}: "
            f"HTTP {status if status else '-'} {getattr(exc, 'code', type(exc).__name__)}: {reason}")[:300]


def one_provider(kind):
    """The client for one role: exactly the configured provider and model, no fallback, no circuit breaker, its own cache.
    None when the role's key is not in the environment."""
    provider, name, url, key_env, model = role(kind)
    key = os.environ.get(key_env, "")
    if not key:
        print(f"{kind.lower()}: not configured, no {key_env} in the environment", file=sys.stderr)
        return None
    client = LLM(url, key, model or (GENERATOR if kind == "GENERATOR" else JUDGES[0]), timeout=300, retries=1,
                 cache_dir=Path(os.environ.get("LLM_CACHE_DIR", ".llm_cache")) / f"eval-{provider}", tier=provider)
    client.fallback, client.breaker, client.provider_name = None, False, provider  # one provider per role, every call tried
    return client


def preflight(kind, client):
    """One tiny call before the real run. Stops the script with the provider, model, status and reason if it fails."""
    client.use_cache = False  # a cached answer would prove nothing about the provider today
    try:
        reply = client.chat([{"role": "user", "content": "Reply with the word ready."}], temperature=0, max_tokens=300)
    except LLMError as exc:
        raise SystemExit(f"{kind} preflight failed: {failure(client, exc)}. Nothing was evaluated or written.")
    finally:
        client.use_cache = True
    if not reply.strip():
        raise SystemExit(f"{kind} preflight failed: {client.provider_name} {client.model}: empty reply. Nothing was evaluated or written.")
    print(f"{kind} OK {client.provider_name} {client.model}", flush=True)


def clients():
    """Generator and judge from EVAL_GENERATOR_* and EVAL_JUDGE_*, each checked with one call first. Keys only from the
    environment, never printed."""
    generator, judge_client = one_provider("GENERATOR"), one_provider("JUDGE")
    for kind, client in (("generator", generator), ("judge", judge_client)):
        if client:
            preflight(kind, client)
    return generator, judge_client, judge_client.model if judge_client else None


DETERMINISTIC_GROUPS = ("impact", "retrieval", "intent and decisions", "data")
MODEL_WORDS = re.compile(r"aitta|together|featherless|gpt-oss|glm|llama|gemma|qwen|\bllm\b|\bjudge", re.I)


def deterministic(evaluation):
    """{group: {metric id: metric}} for the metrics a run without keys must reproduce exactly. Leaves out the generation group
    (model explanations, the judge, guard stats on generated text), the human-labelled group, and any metric whose method names
    a model or provider."""
    return {g["group"]: {m["id"]: m for m in g["metrics"] if not MODEL_WORDS.search(m["method"])}
            for g in evaluation["groups"] if g["group"] in DETERMINISTIC_GROUPS}


def evaluate(est, gold=None, generator=None, judge_client=None, judge_model=None):
    groups = [impact(est), generation(est, generator, judge_client, judge_model), retrieval(est), intent_decisions(est), data_quality(est)]
    groups.append(score_gold.group(est, gold))
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "estate_snapshot": snapshot_id(est), "groups": groups}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--out", default=str(ROOT / "data/evaluation.json"))
    ap.add_argument("--gold", default=str(ROOT / "data/gold_labels.csv"))
    args = ap.parse_args(argv)
    est = Estate(args.db)
    generator, judge_client, judge_model = clients()
    out = evaluate(est, args.gold, generator, judge_client, judge_model)
    Path(args.out).write_text(json.dumps(out, indent=2, default=str) + "\n", encoding="utf-8")
    for g in out["groups"]:
        print(g["group"])
        for m in g["metrics"]:
            print(f"  {m['name']}: {m['value']} {m['unit']} (n={m['n']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
