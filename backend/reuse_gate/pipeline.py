"""One path for every request: Intent -> Evidence -> Decision -> Spec -> Gates.

The API, the mock export and the tests all call run_request, so what the front end shows is what actually ran.
"""
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from reuse_gate.llm import LLM
from reuse_gate.recommend import CONSOLIDATE_NOTE, COVERAGE_PREFIX, MAX_TEXT, NAME_NOTE, RETIRE_AFTER_BUILD_NOTE, Parsed, apply_answers, parse_request, parse_with_reason, read_answers, recommend, scoped_assessments, target_coverage
from reuse_gate.spec import build_spec
from reuse_gate.spec_gate import check
from reuse_gate.speech import MAX_CHARS as MAX_SPEECH

MAX_CANDIDATES = 5
REQUEST_DEADLINE = float(os.environ.get("LLM_REQUEST_DEADLINE", "45"))  # model time for one request, whatever the calls add up to
RULES_NOTICES = {
    "off": "AI models are off on this server, so the rule baseline answered.",
    "guard": "This request was not sent to a model, so the rule baseline answered.",
    "busy": "AI models are at capacity right now, so the rule baseline answered. Try again in a minute for an AI reading.",
    "budget": "The AI call budget for this server is spent, so the rule baseline answered.",
    "unusable": "The AI model could not read this request, so the rule baseline answered.",
    "unavailable": "AI models did not respond, so the rule baseline answered.",
    "timeout": "AI models took too long, so the rule baseline answered.",
}
MAX_SHOWN = 5  # the API returns every listed asset; displays show this many and a "+N more" count


def rec_json(est, intent, rec):
    def asset(aid):
        a = est.assets.get(aid)
        if not a:
            return None
        return {
            "id": aid, "name": a["asset_name"], "type": a["asset_type"], "platform": a["platform"],
            "endorsement": a["endorsement"], "status": a["lifecycle_status"],
            "views_3m": est.views(aid), "users_3m": est.users(aid),
            "owner": (est.owners.get(a["owner_id"]) or {}).get("owner_name"),
        }
    def listed(aid):
        return {**asset(aid), "reason": rec.item_notes.get(aid, ""), "citations": rec.item_citations.get(aid, [])}

    target = asset(rec.target) if rec.target else None
    if target:
        target["coverage"] = target_coverage(est, intent, rec.target)
    return {
        "request_id": intent.request_id, "text": intent.text,
        "intent": {"products": intent.products, "market": intent.market, "kpis": intent.kpis,
                   "kind": intent.kind, "clarifications": intent.clarifications,
                   "questions": [{"text": q, "field": getattr(q, "field", "model")} for q in intent.clarifications]},
        "recommendation": {
            "action": rec.action, "target": target,
            "build_on": rec.build_on, "retire": [listed(a) for a in rec.retire],
            "retire_note": RETIRE_AFTER_BUILD_NOTE if rec.retire and rec.action == "new_build" else None,
            "consolidate_later": [listed(a) for a in rec.consolidate],
            "consolidate_note": CONSOLIDATE_NOTE if rec.consolidate else None,
            "repair": rec.repair, "rationale": rec.rationale,
            "evidence": [{"table": t, "id": i, "note": n} for t, i, n in rec.evidence],
        },
    }


def _within(seconds, fn):
    """Run fn with a hard time limit. An abandoned call finishes in the background and still holds its model slot."""
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(fn).result(timeout=max(seconds, 0))
    finally:
        pool.shutdown(wait=False)


def explain_brief(decision):
    """The decision as the explanation model sees it, kept small."""
    return {**decision, "evidence": decision["evidence"][:15], "retire": decision["retire"][:MAX_SHOWN],
            "consolidate_later": decision["consolidate_later"][:MAX_SHOWN]}


def speech_script(action, lines):
    """What the Listen button says: the decision and why, without table ids and list punctuation."""
    said = [re.sub(r"[\[\]']", "", line).replace("(s)", "s").rstrip(".") for line in lines if line != NAME_NOTE and not line.startswith(COVERAGE_PREFIX)]
    script = ". ".join([f"Recommendation: {action.replace('_', ' ')}"] + said) + "."
    if len(script) > MAX_SPEECH:
        script = script[: script.rfind(". ", 0, MAX_SPEECH) + 1]
    return script


def _stage(stage, status, summary, input_, output):
    return {"stage": stage, "status": status, "summary": summary, "input": input_, "output": output}


def stages(est, req, intent, rec, result, source, as_of):
    parsed = result["intent"]
    decision = result["recommendation"]
    out = [_stage(
        "Intent",
        "needs_input" if parsed["clarifications"] else "ok",
        f"{len(parsed['kpis'])} KPI(s), {len(parsed['clarifications'])} question(s), parsed by {'the LLM' if source == 'llm' else 'rules'}",
        {"text": intent.text, "product_context": req["product_context"], "market_context": req["market_context"], "answers": result["answers"]},
        {**parsed, "parser": source, "model": result["ai"]["model"], "named_assets": intent.named_assets, "missing_assets": intent.missing_assets,
         "conflicting_kpis": intent.variants, "stopped_because": intent.blocked},
    )]

    query = {"products": parsed["products"], "market": parsed["market"], "kpis": parsed["kpis"]}
    if intent.blocked or not intent.kpis or intent.missing_assets:
        out.append(_stage("Evidence", "skipped", "nothing to match until the request is clear", query,
                          {"assets_in_scope": 0, "candidates": [], "citations": decision["evidence"]}))
        checked = 0
    else:
        scoped = scoped_assessments(est, intent)
        checked = len(scoped)
        top = sorted(scoped, key=lambda x: (x["alive"], len(x["covered"]), x["score"]), reverse=True)[:MAX_CANDIDATES]
        out.append(_stage(
            "Evidence", "ok",
            f"{checked} asset(s) in scope, {sum(x['alive'] for x in scoped)} alive, {len(decision['evidence'])} citation(s)",
            query,
            {"assets_in_scope": checked,
             "candidates": [{"id": x["asset"]["asset_id"], "name": x["asset"]["asset_name"], "alive": x["alive"],
                             "covers": x["covered"], "missing": x["missing"], "blockers": x["fatal"] + x["fixable"],
                             "score": x["score"]} for x in top],
             "citations": decision["evidence"]},
        ))

    out.append(_stage(
        "Decision", "ok", decision["action"].replace("_", " "),
        {"assets_checked": checked, "kpis": parsed["kpis"], "decided_by": "deterministic rules, no LLM"},
        {"action": decision["action"], "target": (decision["target"] or {}).get("id"), "build_on": decision["build_on"],
         "retire": [a["id"] for a in decision["retire"][:MAX_SHOWN]], "retire_more": max(len(decision["retire"]) - MAX_SHOWN, 0),
         "consolidate_later": [a["id"] for a in decision["consolidate_later"][:MAX_SHOWN]],
         "consolidate_more": max(len(decision["consolidate_later"]) - MAX_SHOWN, 0), "repair": decision["repair"], "rationale": decision["rationale"]},
    ))

    spec_input = {"action": decision["action"], "build_on": decision["build_on"], "target": (decision["target"] or {}).get("id")}
    try:
        spec = build_spec(parsed, decision, est, as_of=as_of)
    except ValueError as exc:
        reason = str(exc)
        out.append(_stage("Spec", "skipped", "no new artifact for this decision", spec_input, {"reason": reason}))
        out.append(_stage("Gates", "skipped", "no spec to check", {"spec": None}, {"passed": None, "gates": []}))
        return out
    out.append(_stage("Spec", "ok", "draft, final only after human approval", spec_input, spec))
    gates = check(est, spec, as_of=as_of)
    failed = sum(not g["passed"] for g in gates["gates"])
    out.append(_stage(
        "Gates", "pass" if gates["passed"] else "fail",
        "all gates passed" if gates["passed"] else f"{failed} of {len(gates['gates'])} gates failed, release is blocked",
        {"spec": spec["title"], "as_of": as_of}, gates,
    ))
    return out


def run_request(est, req, client=None, as_of=None, answers=None):
    """Run one request through every stage. Never raises for bad input: unclear requests end in human_review.

    answers are the requester's replies to earlier clarifications. They are applied, and the whole request is decided again.
    """
    client = client or LLM()
    read = read_answers(est, req["request_text"], answers or [], client.configured)
    effective = {**req, "request_text": read.text}
    deadline = time.monotonic() + REQUEST_DEADLINE
    try:
        parsed = _within(REQUEST_DEADLINE, lambda: parse_with_reason(est, effective, client)) if client.configured else parse_with_reason(est, effective, client)
    except TimeoutError:
        parsed = Parsed(parse_request(est, effective), "rules", "timeout")
    intent, source = parsed.intent, parsed.source
    apply_answers(est, intent, read)
    rec = recommend(est, intent)
    result = rec_json(est, intent, rec)
    result["text"] = read.base_text[:MAX_TEXT]
    result["answers"] = read.applied
    result["ai"] = {"source": source, "intent_source": source, "explanation": list(rec.rationale), "explanation_source": "rules",
                    "model": parsed.model, "cached": parsed.cached, "reason": parsed.reason,
                    "notice": RULES_NOTICES.get(parsed.reason)}
    if source == "llm":
        decision = result["recommendation"]
        store = getattr(client, "answers", None)
        target = (decision["target"] or {}).get("id")
        lines = None
        if parsed.cached:  # a saved answer never leads to a model call
            lines = store.explanation(intent.text, decision["action"], target) if not answers else None
        else:
            try:
                lines = _within(deadline - time.monotonic(), lambda: client.explain(intent.text, result["intent"], explain_brief(decision)))
                if store and not answers:
                    store.put_explanation(intent.text, decision["action"], target, lines)
            except Exception:  # the rule rationale stands in, so a failed explanation is never an error
                lines = None
        if lines:
            result["ai"]["explanation"], result["ai"]["explanation_source"] = lines, "llm"
    result["ai"]["speech"] = speech_script(rec.action, result["ai"]["explanation"])
    result["pipeline"] = stages(est, req, intent, rec, result, source, as_of or date.today().isoformat())
    return result
