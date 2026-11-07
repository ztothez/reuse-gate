"""What-if remediation, the approval record, and the ownership bottleneck on the Radar.

Nothing here writes to the estate. A remediation changes an in-memory copy, reruns the spec gates and says what would
change. Only owner assignments are allowed, and only to an active owner who exists in the Owners table.
"""
import copy
import hashlib
from datetime import date

from reuse_gate import clarify
from reuse_gate.pipeline import rec_json
from reuse_gate.recommend import GLOBAL, Intent, parse_request, recommend
from reuse_gate.spec import build_spec
from reuse_gate.spec_gate import check

MAX_REMEDIATIONS = 10
OWNER_GATES = {"owner_and_review_date", "evidence_cited"}  # evidence_cited fails when the owner has no citation
SHOWN = 10  # citations listed per bottleneck owner; the counts cover every one


class RemediationError(ValueError):
    pass


def snapshot_id(est):
    """sha256 of the estate database file, so a record says exactly which data it was decided on."""
    if not hasattr(est, "_snapshot_id"):
        path = est.con.execute("PRAGMA database_list").fetchone()[2]
        with open(path, "rb") as f:
            est._snapshot_id = "sha256:" + hashlib.sha256(f.read()).hexdigest()
    return est._snapshot_id


def active_owners(est):
    """Owners who can be assigned: active only, Semantic Model Owners first, then by id."""
    rows = [o for o in est.owners.values() if o["status"] == "active"]
    rows.sort(key=lambda o: (o["role"] != "Semantic Model Owner", o["owner_id"]))
    return [{"owner_id": o["owner_id"], "owner_name": o["owner_name"], "role": o["role"], "scope": o["scope"]} for o in rows]


def validate(est, remediations):
    """The allow list: assign_owner on an existing asset or semantic model, to an existing active owner. Anything else is refused."""
    if not isinstance(remediations, list) or not remediations:
        raise RemediationError("remediations must be a non-empty list")
    if len(remediations) > MAX_REMEDIATIONS:
        raise RemediationError(f"at most {MAX_REMEDIATIONS} remediations")
    out, problems = [], []
    for n, r in enumerate(remediations):
        if not isinstance(r, dict) or r.get("type") != "assign_owner" or set(r) - {"type", "target", "owner_id"}:
            problems.append(f"#{n}: only {{type: assign_owner, target, owner_id}} is allowed")
            continue
        target, owner_id = r.get("target"), r.get("owner_id")
        table = "Analytics_Assets" if target in est.assets else "Semantic_Models" if target in est.models else None
        owner = est.owners.get(owner_id)
        if not table:
            problems.append(f"#{n}: {target} is not an asset or semantic model in the estate")
        elif not owner:
            problems.append(f"#{n}: {owner_id} is not in the Owners table")
        elif owner["status"] != "active":
            problems.append(f"#{n}: {owner_id} is {owner['status']}, not active")
        else:
            row = est.assets.get(target) or est.models[target]
            was = est.owners.get(row["owner_id"]) or {}
            out.append({"type": "assign_owner", "target": target, "target_table": table, "owner_id": owner_id,
                        "owner_name": owner["owner_name"], "from_owner_id": row["owner_id"], "from_status": was.get("status", "not in the Owners table"),
                        "citations": [f"{table}:{target}", f"Owners:{owner_id}"] + ([f"Owners:{row['owner_id']}"] if was else [])})
    if problems:
        raise RemediationError("; ".join(problems))
    return out


def apply(est, changes):
    """A copy of the estate with the owners changed. Only the changed tables are copied; estate.db is never touched."""
    sim = copy.copy(est)
    sim.assets, sim.models = dict(est.assets), dict(est.models)
    for c in changes:
        table = sim.assets if c["target_table"] == "Analytics_Assets" else sim.models
        table[c["target"]] = {**table[c["target"]], "owner_id": c["owner_id"]}
    return sim


def _intent(est, value):
    """A client intent kept to allow-listed values, or None."""
    if not isinstance(value, dict):
        return None
    markets = set(est.markets) | {m["region"] for m in est.markets.values()} | {GLOBAL}
    products = [p for p in value.get("products") or [] if p in est.products or p == est.all_scope]
    kpis = [k for k in value.get("kpis") or [] if k in est.canonical]
    if not products or not kpis or value.get("market") not in markets:
        return None
    kind = value.get("kind") if value.get("kind") in ("new_report", "migration") else "new_report"
    return Intent("", str(value.get("text", ""))[:2000], products, value["market"], kpis, kind)


def resolve(est, body):
    """The request a remediation or record is about: a batch request_id, or an intent. Returns (intent, as_of, source)."""
    rid = body.get("request_id")
    req = next((r for r in est.requests if r["request_id"] == rid), None) if isinstance(rid, str) else None
    if req:
        return parse_request(est, req), req["request_date"], "batch request, rules"
    intent = _intent(est, body.get("intent"))
    if intent:
        return intent, None, "intent sent by the client, allow-listed"
    raise RemediationError("send a request_id from the data pack, or an intent with products, market and kpis")


def _gates(est, intent, owner, review_by, as_of):
    """The spec and its gates for the decision this estate gives. None when the decision builds nothing."""
    rec = recommend(est, intent)
    out = rec_json(est, intent, rec)
    try:
        spec = build_spec(out["intent"], out["recommendation"], est, owner=owner, review_date=review_by, as_of=as_of)
    except ValueError as exc:
        return rec, None, {"passed": None, "gates": [], "reason": str(exc)}
    return rec, spec, check(est, spec, as_of=as_of)


def _diff(before, after):
    was = {g["gate"]: g for g in before["gates"]}
    return [{"gate": g["gate"], "before": was[g["gate"]]["passed"], "after": g["passed"],
             "detail_before": was[g["gate"]]["detail"], "detail_after": g["detail"]}
            for g in after["gates"] if g["gate"] in was and (was[g["gate"]]["passed"], was[g["gate"]]["detail"]) != (g["passed"], g["detail"])]


def simulate(est, body):
    """POST /remediate. Never mutates the estate. Raises RemediationError for anything outside the allow list."""
    changes = validate(est, body.get("remediations"))
    intent, as_of, source = resolve(est, body)
    as_of = as_of or _iso(body.get("as_of")) or date.today().isoformat()
    owner, review_by = _text(body.get("owner")), _text(body.get("review_by"))
    rec, spec, before = _gates(est, intent, owner, review_by, as_of)
    sim_rec, sim_spec, after = _gates(apply(est, changes), intent, owner, review_by, as_of)
    if (sim_rec.action, sim_rec.target) != (rec.action, rec.target):  # an owner change only reaches the gates; this must never happen
        raise RuntimeError("a simulated owner change altered the decision")
    failing = lambda g: {x["gate"] for x in g["gates"] if not x["passed"]}
    return {
        "applied": "simulated", "estate_snapshot": snapshot_id(est), "request_id": body.get("request_id"), "intent_source": source,
        "as_of": as_of, "decision": {"action": rec.action, "target": rec.target, "build_on": rec.build_on},
        "remediations": changes,
        "before": {"owner": (spec or {}).get("owner"), "gates": before},
        "after": {"owner": (sim_spec or {}).get("owner"), "gates": after},
        "diff": _diff(before, after) if spec else [],
        "fixed": sorted(failing(before) - failing(after)),
        "still_failing": sorted(failing(after)),
        "passed_before": before["passed"], "passed_after": after["passed"],
    }


def _text(value, limit=200):
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _iso(value):
    try:
        return date.fromisoformat(value).isoformat() if isinstance(value, str) else None
    except ValueError:
        return None


def decision_record(est, body):
    """What /approve keeps next to the body: rebuilt server-side from the data pack, never trusted from the client.

    The decision and gates are recomputed from the confirmed intent. The client's own action and target are compared,
    not copied. record.gates holds "at_approval" (the approver's owner) and, when a remediation was sent,
    "before_remediation" (the owner the system proposed, or none). Rounds are the client's record of the loop, trimmed to the loop limit.
    """
    record = {"estate_snapshot": snapshot_id(est), "request_text": _text(body.get("text"), 2000), "approver": _text(body.get("approver")),
              "owner": _text(body.get("owner")), "review_by": _text(body.get("review_by")), "decision": body.get("decision"),
              "rounds": clarify.clean_rounds(body.get("rounds")), "intent": None, "recommendation": None, "gates": None, "remediation": None}
    try:
        intent, as_of, source = resolve(est, body)
    except RemediationError as exc:
        record["note"] = f"no intent to check: {exc}"
        return record
    as_of = as_of or date.today().isoformat()

    def result(owner):
        """Gates for the spec with this owner, or the owner the system proposes when it is None."""
        rec, spec, gates = _gates(est, intent, owner, record["review_by"], as_of)
        failing = [g["gate"] for g in gates["gates"] if not g["passed"]]
        return rec, {"owner": (spec or {}).get("owner"), "as_of": as_of, "passed": gates["passed"], "passing": len(gates["gates"]) - len(failing),
                     "total": len(gates["gates"]), "failing": failing, **({"reason": gates["reason"]} if "reason" in gates else {}), "gates": gates["gates"]}

    rec, at_approval = result(record["owner"])
    record["intent"] = {"products": intent.products, "market": intent.market, "kpis": intent.kpis, "kind": intent.kind, "source": source}
    record["recommendation"] = {"action": rec.action, "target": rec.target, "build_on": rec.build_on, "citations": len(rec.evidence),
                                "client_action": body.get("action"), "client_target": body.get("target"),
                                "matches_client": body.get("action") in (None, rec.action) and body.get("target") in (None, rec.target)}
    record["gates"] = {"at_approval": at_approval}
    if body.get("remediations"):  # keep the blocker the remediation was meant to clear, next to the result it led to
        record["gates"] = {"before_remediation": result(None)[1], "at_approval": at_approval}
        try:
            record["remediation"] = simulate(est, {**body, "as_of": as_of})
        except RemediationError as exc:
            record["remediation"] = {"rejected": str(exc)}
    return record


def ownership_bottlenecks(est):
    """Inactive owners ranked by the specs and assets they block, from the batch requests and the Owners table. Cached per estate."""
    if hasattr(est, "_bottlenecks"):
        return est._bottlenecks
    inactive = {i: o for i, o in est.owners.items() if o["status"] != "active"}
    found = {i: {"specs": [], "models": set(), "assets": []} for i in inactive}
    for a in est.assets.values():
        if a["owner_id"] in found:
            found[a["owner_id"]]["assets"].append(a["asset_id"])
    for m in est.models.values():
        if m["owner_id"] in found:
            found[m["owner_id"]]["models"].add(m["model_id"])
    for req in est.requests:
        intent = parse_request(est, req)
        rec, spec, gates = _gates(est, intent, None, None, req["request_date"])
        if not spec or not any(g["gate"] == "owner_and_review_date" and not g["passed"] for g in gates["gates"]):
            continue
        # The spec proposes the extended asset's owner, then the model's owner. Both were unusable, so both block it.
        for source in (est.assets.get(spec["target"]), est.models.get(spec["semantic_model"])):
            if source and source["owner_id"] in found:
                found[source["owner_id"]]["specs"].append(req["request_id"])
    rows = []
    for owner_id, f in found.items():
        if not (f["specs"] or f["assets"] or f["models"]):
            continue
        o = inactive[owner_id]
        cites = [f"Owners:{owner_id}"] + [f"Semantic_Models:{m}" for m in sorted(f["models"])] + [f"Analytics_Assets:{a}" for a in f["assets"]]
        rows.append({"owner_id": owner_id, "owner_name": o["owner_name"], "role": o["role"], "scope": o["scope"], "status": o["status"],
                     "specs_blocked": len(set(f["specs"])), "requests_blocked": sorted(set(f["specs"]))[:SHOWN],
                     "semantic_models": sorted(f["models"]), "assets_owned": len(f["assets"]),
                     "fix": "assign an active owner to " + ", ".join(sorted(f["models"]) or f["assets"][:3]) + "; check it with POST /remediate",
                     "citations": cites[:SHOWN], "citations_total": len(cites)})
    rows.sort(key=lambda r: (-r["specs_blocked"], -r["assets_owned"], r["owner_id"]))
    est._bottlenecks = rows
    return rows
