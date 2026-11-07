"""Decision configuration as change requests: a developer proposes, the impact is measured, an approver decides.

Nothing is changed in the running service. A proposal is run against all 150 business requests in a separate process with the
proposed values, and the result (new builds avoided before and after, and every request whose decision would change) is stored
with it. An approved change is a reviewed patch for the next release, which goes through the pipeline like any code change.
Nobody approves their own proposal.

Usage of the dry run on its own: PYTHONPATH=backend python3 -m reuse_gate.config_changes data/estate.db '{"low_views": 50}'
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from collections import Counter
from datetime import datetime, timezone

from reuse_gate import clarify, recommend, spec
from reuse_gate.estate import DEFAULT_CATALOG

# key: (label, module, constant, minimum, maximum, type)
TUNABLES = {
    "low_views": ("Views in 3 months below which a report counts as unused", recommend, "LOW_VIEWS", 10, 1000, int),
    "fuzzy": ("How close a misspelt KPI phrase must be to count (0 to 1)", recommend, "FUZZY", 0.6, 0.98, float),
    "fuzzy_name": ("How close a misspelt product name must be to count (0 to 1)", recommend, "FUZZY_NAME", 0.6, 0.98, float),
    "clear_at": ("Confidence at which a request field counts as clear (0 to 1)", clarify, "CLEAR", 0.5, 0.95, float),
    "review_after_days": ("Default review cycle for a newly registered report (days)", spec, "REVIEW_AFTER_DAYS", 30, 730, int),
}
STATUSES = ("proposed", "approved", "rejected")
DRY_RUN_TIMEOUT = 60


class ChangeError(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def current(est):
    """GET /config: the values in force and the vocabulary a proposal can extend."""
    return {"tunables": [{"key": k, "label": v[0], "value": getattr(v[1], v[2]), "min": v[3], "max": v[4], "type": v[5].__name__}
                         for k, v in TUNABLES.items()],
            "kpis": sorted(est.canonical), "kpi_synonyms": [p for p, _ in est.catalog.get("kpi_phrases", [])],
            "markets": sorted({m["market_id"] for m in est.markets.values()}),
            "market_aliases": est.catalog.get("market_aliases", {})}


def clean(body, est):
    """The proposal as {settings, kpi_synonyms, market_aliases}, or ChangeError."""
    settings = body.get("settings") or {}
    if not isinstance(settings, dict):
        raise ChangeError("settings must be an object")
    out = {}
    for key, value in settings.items():
        if key not in TUNABLES:
            raise ChangeError(f"unknown setting: {key}")
        label, _, _, lo, hi, kind = TUNABLES[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
            raise ChangeError(f"{key} must be a number from {lo} to {hi}")
        out[key] = kind(value)
    synonyms = body.get("kpi_synonyms") or []
    if not isinstance(synonyms, list) or len(synonyms) > 10:
        raise ChangeError("kpi_synonyms must be a list of at most 10")
    for s in synonyms:
        if not (isinstance(s, dict) and isinstance(s.get("phrase"), str) and 3 <= len(s["phrase"].strip()) <= 40
                and s.get("kpi") in est.canonical):
            raise ChangeError("each KPI synonym needs a phrase of 3 to 40 characters and a canonical KPI")
    aliases = body.get("market_aliases") or {}
    if not isinstance(aliases, dict) or len(aliases) > 10:
        raise ChangeError("market_aliases must be an object with at most 10 entries")
    for alias, market in aliases.items():
        if not (isinstance(alias, str) and 2 <= len(alias.strip()) <= 30 and market in {m["market_id"] for m in est.markets.values()}):
            raise ChangeError("each market alias needs a name of 2 to 30 characters and a known market id")
    if not (out or synonyms or aliases):
        raise ChangeError("propose at least one change")
    reason = body.get("reason")
    if not isinstance(reason, str) or len(reason.strip()) < 10:
        raise ChangeError("say why, in at least 10 characters")
    return {"settings": out, "kpi_synonyms": [{"phrase": s["phrase"].strip().lower(), "kpi": s["kpi"]} for s in synonyms],
            "market_aliases": {a.strip(): m for a, m in aliases.items()}, "reason": reason.strip()[:500]}


def _batch(est):
    from reuse_gate.recommend import parse_request, recommend as decide
    out = {}
    for req in est.requests:
        intent = parse_request(est, req)
        rec = decide(est, intent)
        out[req["request_id"]] = {"action": rec.action, "target": rec.target, "clarify": bool(intent.clarifications)}
    return out


def _summary(results):
    actions = Counter(r["action"] for r in results.values())
    return {"total": len(results), "avoided": len(results) - actions["new_build"], "actions": dict(actions),
            "clarifications": sum(r["clarify"] for r in results.values())}


def evaluate(db, proposal):
    """Baseline and proposed batch over all business requests. Runs in its own process: it changes module constants."""
    from reuse_gate.estate import Estate
    base = _batch(Estate(db))
    for key, value in proposal.get("settings", {}).items():
        _, module, name, *_ = TUNABLES[key]
        setattr(module, name, value)
    with open(DEFAULT_CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)
    for s in proposal.get("kpi_synonyms", []):
        catalog["kpi_phrases"].append([s["phrase"], [s["kpi"]]])
        catalog["kpi_patterns"].append([re.escape(s["phrase"]), [s["kpi"]]])
    catalog["market_aliases"].update(proposal.get("market_aliases", {}))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(catalog, tmp)
    try:
        after = _batch(Estate(db, tmp.name))
    finally:
        os.unlink(tmp.name)
    changed = [{"request_id": rid, "before": base[rid]["action"], "after": after[rid]["action"],
                "before_target": base[rid]["target"], "after_target": after[rid]["target"]}
               for rid in base if (base[rid]["action"], base[rid]["target"]) != (after[rid]["action"], after[rid]["target"])]
    return {"before": _summary(base), "after": _summary(after), "changed": changed[:50], "changed_count": len(changed)}


def dry_run(db, proposal):
    """evaluate() in a child process, so the running service's constants never change."""
    env = {**os.environ, "PYTHONPATH": os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "LLM_MODE": "rules"}
    done = subprocess.run([sys.executable, "-m", "reuse_gate.config_changes", db, json.dumps(proposal)], capture_output=True,
                          text=True, timeout=DRY_RUN_TIMEOUT, env=env)
    if done.returncode != 0:
        raise ChangeError("the impact check failed; nothing was stored")
    return json.loads(done.stdout)


def propose(store, est, db, body, who):
    proposal = clean(body, est)
    row = {"id": "CHG-" + uuid.uuid4().hex[:8].upper(), "status": "proposed", **proposal,
           "impact": dry_run(db, proposal), "proposed_by": who.name, "proposed_role": who.role, "created": now(),
           "decided_by": None, "decided": None, "comment": None}
    return store.put(row)


def decide(store, change_id, body, who):
    row = store.get(change_id)
    if not row:
        raise LookupError("no such change")
    if row["status"] != "proposed":
        raise ChangeError(f"{change_id} is already {row['status']}")
    if who.enforced and row["proposed_by"] == who.name:
        raise PermissionError("nobody approves their own change")
    decision = body.get("decision")
    if decision not in ("approve", "reject"):
        raise ChangeError("decision must be approve or reject")
    comment = body.get("comment") if isinstance(body.get("comment"), str) else ""
    return store.put({**row, "status": "approved" if decision == "approve" else "rejected", "decided_by": who.name,
                      "decided": now(), "comment": comment.strip()[:500]})


def patch(row):
    """The reviewed change as a release patch: constants and catalog entries to apply in the repository."""
    return {"change": row["id"], "approved_by": row["decided_by"], "approved": row["decided"],
            "constants": {f"{TUNABLES[k][1].__name__}.{TUNABLES[k][2]}": v for k, v in row["settings"].items()},
            "catalog": {"kpi_phrases": [[s["phrase"], [s["kpi"]]] for s in row["kpi_synonyms"]], "market_aliases": row["market_aliases"]},
            "expected": {"avoided": row["impact"]["after"]["avoided"], "total": row["impact"]["after"]["total"]}}


if __name__ == "__main__":
    print(json.dumps(evaluate(sys.argv[1], json.loads(sys.argv[2]))))
