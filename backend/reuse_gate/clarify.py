"""The clarification loop: per-field confidence, up to 3 rounds, then a person.

Rules read the request and decide what to ask. A model may reword a question, never choose one. The API keeps no state,
so the client sends the recorded rounds back. Dropping them only starts a new loop, which no more bypasses the limit than
submitting a new request does: an answer never approves anything.
"""
from collections import Counter

from reuse_gate.recommend import GLOBAL, INJECTION, MAX_ANSWER

MAX_ROUNDS = 3
CLEAR = 0.8  # a field below this has an open question
FIELDS = ("product", "market", "kpi", "kind")
SCORES = {"answered": 1.0, "confirmed": 1.0, "named": 1.0, "metadata": 0.9, "cross_product": 0.9, "model": 0.85, "parsed": 0.85,
          "fuzzy": 0.6, "assumed": 0.4, "contradiction": 0.3, "ambiguous": 0.2, "missing": 0.0, "unknown": 0.0}
# Questions that are not about one field still leave the fields they touch unclear.
TOUCHES = {"confirm": ["kpi"], "scope": ["product", "kpi"], "restate": ["product", "kpi"], "model": []}


def snapshot(intent):
    return {"products": list(intent.products), "market": intent.market, "kpis": list(intent.kpis), "kind": intent.kind,
            "proposed_kpis": list(intent.proposed_kpis), "blocked": intent.blocked}


def diff(before, after):
    """What changed between two snapshots, field by field."""
    return [{"field": k, "from": before.get(k), "to": after.get(k)} for k in after if before.get(k) != after.get(k)]


def confidence(intent, read=None):
    """Per-field confidence from how the value was read. Deterministic, and never below CLEAR without an open question."""
    out = {}
    values = {"product": intent.products, "market": intent.market, "kpi": intent.kpis, "kind": intent.kind}
    for name in FIELDS:
        basis = intent.basis.get(name, "parsed")
        if read and (name in read.confirmed):
            basis = "confirmed"
        if read and {"product": read.products, "market": read.market, "kpi": read.kpis}.get(name):
            basis = "answered"
        out[name] = {"value": values[name], "score": SCORES[basis], "basis": basis}
    for q in intent.clarifications:
        field, basis = getattr(q, "field", "model"), getattr(q, "basis", "assumed")
        for name in TOUCHES.get(field, [field]):
            if SCORES[basis] < out[name]["score"]:
                out[name].update(score=SCORES[basis], basis=basis)
    return out


def questions_of(intent):
    return [{"text": str(q), "field": getattr(q, "field", "model")} for q in intent.clarifications]


def _answer_key(a):
    return a.get("field", "model"), a.get("question", ""), a.get("answer")


def _fresh(answers, rounds):
    """Answers not yet recorded. The client resends only kept answers, so a repeat of an unusable one is new, as is a second "yes"."""
    kept = Counter(_answer_key(a) for r in rounds for a in r.get("answers", []) if a.get("kept"))
    fresh = []
    for a in answers:
        if (a.get("answer") or "").strip():
            if kept[_answer_key(a)] > 0:
                kept[_answer_key(a)] -= 1
            else:
                fresh.append(a)
    return fresh


def clean_rounds(rounds):
    """Only what the client may send back: rounds, as dicts, no more than the limit."""
    return [dict(r) for r in rounds if isinstance(r, dict)][:MAX_ROUNDS] if isinstance(rounds, list) else []


def advance(intent, read, answers, rounds, before=None):
    """Record this check as a round and say where the loop stands. Past the limit, the intent is blocked for a person."""
    rounds = clean_rounds(rounds)
    fresh = _fresh(answers, rounds)
    scores = confidence(intent, read)
    scope = [q for q in intent.clarifications if getattr(q, "field", "") == "scope"]
    if scope:  # which request comes first decides whether the other questions still matter
        intent.clarifications = scope
    after = snapshot(intent)
    if fresh and (len(rounds) < MAX_ROUNDS or not rounds[-1].get("answers")):
        if not rounds or rounds[-1].get("answers"):
            start = before if before is not None else after
            rounds.append({"round": len(rounds) + 1, "text": intent.text, "questions": [{"text": a.get("question", ""), "field": a.get("field", "model")} for a in fresh],
                           "answers": [], "intent": start, "confidence": None, "intent_after": None, "changed": []})
        current = rounds[-1]
        current["answers"] = [{"field": a.get("field", "model"), "question": a.get("question", ""), "answer": a["answer"].strip()[:MAX_ANSWER],
                               "used": a.get("field", "model") not in read.unread} for a in fresh]
        for a in current["answers"]:
            a["kept"] = any(_answer_key(x) == _answer_key(a) for x in read.applied)
        current["intent_after"] = after
        current["changed"] = diff(current.get("intent") or {}, after)
    elif not fresh and rounds and not rounds[-1].get("answers"):
        rounds.pop()  # asked again with nothing new: it is rebuilt below
    used = sum(bool(r.get("answers")) for r in rounds)
    open_fields = sorted({getattr(q, "field", "model") for q in intent.clarifications})
    stopped = None
    if not intent.clarifications:
        status = "clear"
    elif used < MAX_ROUNDS:
        status = "asking"
        rounds.append({"round": used + 1, "text": intent.text, "questions": questions_of(intent), "answers": [], "intent": after,
                       "confidence": scores, "intent_after": None, "changed": []})
    else:
        status = "human_review"
        stopped = f"still unclear after {MAX_ROUNDS} rounds of questions ({', '.join(open_fields)}), so a person must decide"
    loop = {"status": status, "rounds_used": used, "max_rounds": MAX_ROUNDS, "clear_at": CLEAR, "confidence": scores,
            "open_fields": open_fields, "asked_by": "rules", "phrased_by": None, "stopped_because": stopped, "rounds": rounds}
    if stopped:
        intent.blocked = stopped
        intent.clarifications = []
    return loop


def phrase(est, client, text, questions):
    """Model wording for rule questions. Returns (wordings by question text, model). Any doubt keeps the rule text."""
    reword = getattr(client, "phrase_questions", None)
    asked = [q["text"] for q in questions if q["field"] != "model"]
    if not reword or not asked:
        return {}, None
    phrased = reword(text, asked)
    terms = list(est.products) + [est.all_scope, GLOBAL] + list(est.canonical)
    terms += [m["market_name"] for m in est.markets.values()] + [m["region"] for m in est.markets.values()]
    kept = {}
    for rule, new in zip(asked, phrased):
        needed = [t for t in terms if t.lower() in rule.lower()]
        new = new.strip()
        if new and len(new) <= 300 and not INJECTION.search(new) and all(t.lower() in new.lower() for t in needed):
            kept[rule] = new
    return kept, getattr(client, "last_model", None)
