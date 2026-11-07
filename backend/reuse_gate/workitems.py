"""Requests as persistent work items: status, result, rounds, remediation, decision and an activity trail.

Stored as JSON lines next to the decision log, one full snapshot per change, so the last line for an id wins.
At most MAX_ITEMS are kept; the oldest go first. On an empty store the saved example chips are seeded as clearly
marked samples, from saved answers only, so seeding never calls a model.
"""
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from reuse_gate.answers import AnswerStore
from reuse_gate.llm import LLMError

MAX_ITEMS = 500
MAX_LIST = 200
STATUSES = ("clarifying", "awaiting_approval", "human_review", "approved", "rejected")
SAMPLE_REQUESTER = "Sample user"
SAMPLE_NOTE = "sample request seeded for the demo, not a real business request"


def now():
    return datetime.now(timezone.utc).isoformat()  # microseconds, so newest first holds for items made in the same second


def status_of(result):
    """Where a fresh result leaves the work item. Approval and rejection are set only by POST /approve."""
    if (result.get("loop") or {}).get("status") == "asking" or result["intent"].get("questions"):
        return "clarifying"
    return "human_review" if result["recommendation"]["action"] == "human_review" else "awaiting_approval"


def _stage(result, name):
    return next((s for s in result.get("pipeline") or [] if s["stage"] == name), {})


def summary(item):
    """One row of GET /requests."""
    result, decision = item["result"], item.get("decision") or {}
    rec = result["recommendation"]
    target = rec.get("target") or {}
    spec = _stage(result, "Spec").get("output") or {}
    gates = _stage(result, "Gates").get("output") or {}
    return {"request_id": item["request_id"], "text": item["text"], "status": item["status"], "action": rec["action"],
            "target": target.get("id"), "target_name": target.get("name"),
            "owner": decision.get("owner") or spec.get("owner") or target.get("owner"),
            "created": item["created"], "updated": item["updated"], "open_questions": len(result["intent"].get("questions") or []),
            "gates_passed": gates.get("passed"), "origin": item["origin"]}


def detail(item):
    """GET /requests/{id}."""
    keys = ("request_id", "text", "status", "created", "updated", "origin", "requester", "result", "rounds", "remediation", "decision", "activity")
    return {k: item.get(k) for k in keys}


def intent_of(item):
    i = item["result"]["intent"]
    return {"products": i["products"], "market": i["market"], "kpis": i["kpis"], "kind": i["kind"], "text": item["text"]}


class SavedAnswersOnly:
    """A client that answers from saved answers and never calls a model, for seeding samples."""
    configured = True
    last_model = None

    def __init__(self, answers=None):
        self.answers = answers or AnswerStore()

    def parse_intent(self, *args):
        raise LLMError("seeding uses saved answers only")

    def explain(self, *args):
        raise LLMError("seeding uses saved answers only")


class Store:
    def __init__(self, path=None, max_items=MAX_ITEMS):
        self.path, self.max_items, self.items, self._lock = (Path(path) if path else None), max_items, {}, threading.Lock()
        self._lines = 0
        if self.path and self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                try:
                    item = json.loads(line)
                    self.items[item["request_id"]] = item
                    self._lines += 1
                except (ValueError, KeyError, TypeError):
                    continue  # a torn last line from a crash loses one change, not the store
            self._trim()

    def get(self, request_id):
        with self._lock:
            return self.items.get(request_id)

    def list(self, status=None, q=None):
        with self._lock:
            rows = list(self.items.values())
        if status:
            rows = [i for i in rows if i["status"] == status]
        if q:
            q = q.casefold()
            rows = [i for i in rows if q in i["text"].casefold() or q in i["request_id"].casefold()]
        rows.sort(key=lambda i: (i["created"], i["request_id"]), reverse=True)
        return [summary(i) for i in rows[:MAX_LIST]]

    def _save(self, item):
        """Caller holds the lock."""
        self.items[item["request_id"]] = item
        evicted = self._trim()
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if evicted or self._lines > 2 * len(self.items) + 50:  # rewrite so dropped items and old snapshots do not come back
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(i, default=str) + "\n" for i in self.items.values()), encoding="utf-8")
            os.replace(tmp, self.path)
            self._lines = len(self.items)
        else:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(item, default=str) + "\n")
            self._lines += 1

    def _trim(self):
        extra = len(self.items) - self.max_items
        if extra <= 0:
            return False
        for old in sorted(self.items.values(), key=lambda i: (i["created"], i["request_id"]))[:extra]:
            del self.items[old["request_id"]]
        return True

    def create(self, result, requester=None, origin="user", request_id=None, time=None, note=None):
        t = time or now()
        item = {"request_id": request_id or result["request_id"], "text": result["text"], "status": status_of(result), "created": t, "updated": t,
                "origin": origin, "requester": requester or "Requester", "result": result, "answers": result.get("answers") or [],
                "rounds": (result.get("loop") or {}).get("rounds", []), "remediation": None, "decision": None,
                "activity": [{"time": t, "actor": requester or "Requester", "event": "seeded" if origin == "sample" else "created",
                              "detail": note or f"{result['recommendation']['action']}, {len(result['intent'].get('questions') or [])} open question(s)"}]}
        with self._lock:
            self._save(item)
        return item

    def update(self, request_id, result, actor=None):
        with self._lock:
            item = dict(self.items[request_id])
            t = now()
            answered = len(result.get("answers") or []) - len(item.get("answers") or [])
            item.update(text=result["text"], status=status_of(result), updated=t, result=result, answers=result.get("answers") or [],
                        rounds=(result.get("loop") or {}).get("rounds", []))
            item["activity"] = item["activity"] + [{"time": t, "actor": actor or item["requester"], "event": "rechecked",
                                                     "detail": f"{max(answered, 0)} new answer(s) kept; {result['recommendation']['action']}, "
                                                               f"{len(result['intent'].get('questions') or [])} open question(s)"}]
            self._save(item)
        return item

    def remediated(self, request_id, response, actor=None):
        with self._lock:
            item = dict(self.items[request_id])
            t = now()
            changes = ", ".join(f"{c['target']} to {c['owner_id']}" for c in response["remediations"])
            item.update(updated=t, remediation=response)
            item["activity"] = item["activity"] + [{"time": t, "actor": actor or "unnamed", "event": "remediation_simulated",
                                                     "detail": f"simulated, not applied: owner {changes}; gates passed before "
                                                               f"{response['passed_before']}, after {response['passed_after']}"}]
            self._save(item)
        return item

    def decide(self, request_id, entry):
        with self._lock:
            item = dict(self.items[request_id])
            record = entry.get("record") or {}
            decision = {"registered_id": entry["registered_id"], "decision": entry["decision"], "approver": entry.get("approver"),
                        "owner": entry.get("owner"), "review_by": entry.get("review_by"), "time": entry["time"],
                        "gates_passed": ((record.get("gates") or {}).get("at_approval") or {}).get("passed"),
                        "estate_snapshot": record.get("estate_snapshot")}
            item.update(updated=entry["time"], decision=decision, status="approved" if entry["decision"] == "approve" else "rejected")
            item["activity"] = item["activity"] + [{"time": entry["time"], "actor": entry.get("approver") or "unnamed",
                                                     "event": "approved" if entry["decision"] == "approve" else "rejected",
                                                     "detail": f"{entry['registered_id']}, owner {entry.get('owner')}, review by {entry.get('review_by')}"}]
            self._save(item)
        return item

    def seed(self, est, run, texts, time=None):
        """Seed the example chips as samples, only when the store is empty. run(req) returns a /recommend result."""
        with self._lock:
            if self.items:
                return 0
        for n, text in enumerate(texts, 1):
            rid = f"SAMPLE-{n:02d}"
            req = {"request_id": rid, "request_text": text, "product_context": est.all_scope, "market_context": None}
            self.create(run(req), SAMPLE_REQUESTER, "sample", rid, time, SAMPLE_NOTE)
        return len(texts)


def new_id():
    return "WI-" + uuid.uuid4().hex[:8].upper()


def chip_texts(est):
    """The example chips, in the order the front end shows them: each distinct request text once."""
    return list(dict.fromkeys(r["request_text"] for r in est.requests))
