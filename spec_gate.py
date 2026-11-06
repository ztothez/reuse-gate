"""Deterministic quality gates for a generated DashboardSpec, plus the batch quality report.

These gates are pipeline logic: they prove every artifact follows the same governance rules, every time.
They do not measure whether a spec matches what the requester privately had in mind.

Usage: python3 -I spec_gate.py <db> [docs/quality_report.md]
"""
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")
from estate import Estate
from recommend import Intent, assess, parse_request, recommend, scoped_assessments
from spec import build_spec, owner_row

CITED_FIELDS = ("products", "market", "kpis", "semantic_model", "owner", "source_action")


def _canonical_kpis(est, spec):
    kpis = spec.get("kpis") or []
    if not kpis:
        return "the spec has no KPIs"
    bad = [k for k in kpis if k not in est.canonical]
    bad += [m.get("kpi_id") for m in spec.get("measures", [])
            if m.get("kpi_id") in est.kpis and est.kpis[m["kpi_id"]]["definition_status"] != "canonical"]
    return f"not canonical: {bad}" if bad else None


def _certified_healthy_model(est, spec):
    m = est.models.get(spec.get("semantic_model"))
    if not m:
        return f"semantic model {spec.get('semantic_model')} does not exist"
    problems = []
    if m["endorsement"] != "certified":
        problems.append(f"endorsement is {m['endorsement']}")
    if m["refresh_status"] != "healthy":
        problems.append(f"refresh status is {m['refresh_status']}")
    return f"{m['model_id']}: {', '.join(problems)}" if problems else None


def _owner_and_review_date(est, spec, as_of):
    problems = []
    if not spec.get("owner"):
        problems.append("no active owner could be proposed")
    elif not owner_row(est, spec["owner"]):
        problems.append(f"owner {spec['owner']} is not active in the Owners table")
    try:
        if date.fromisoformat(spec.get("review_date") or "") <= as_of:
            problems.append(f"review date {spec['review_date']} is not in the future")
    except ValueError:
        problems.append("review date is missing or invalid")
    return "; ".join(problems) or None


def _measures_in_catalog(est, spec):
    measures = spec.get("measures") or []
    if not measures:
        return "the spec has no measures"
    bad = [m.get("name") or m.get("kpi_id") for m in measures
           if m.get("kpi_id") not in est.kpis or est.kpis[m["kpi_id"]]["canonical_metric"] != m.get("name")]
    return f"outside the KPI catalog: {bad}" if bad else None


def _no_alive_duplicate(est, spec):
    intent = Intent("", "", spec.get("products") or [], spec.get("market") or "", spec.get("kpis") or [])
    dupes = [x["asset"]["asset_id"] for x in scoped_assessments(est, intent)
             if x["alive"] and not x["missing"] and x["asset"]["asset_id"] != spec.get("target")]
    dupes += [i for i, a in est.assets.items()
              if a["asset_name"] == spec.get("title") and i not in dupes and assess(est, intent, a)["alive"]]
    return f"duplicates alive asset(s): {dupes[:5]}" if dupes else None


def _valid_target(est, spec):
    if spec.get("source_action") != "extend":
        return None
    a = est.assets.get(spec.get("target"))
    if not a:
        return f"extend target {spec.get('target')} does not exist"
    fatal = assess(est, Intent("", "", [], "", []), a)["fatal"]
    return f"extend target {a['asset_id']} is not alive: {'; '.join(fatal)}" if fatal else None


def _evidence_cited(est, spec):
    cited = spec.get("evidence") or {}
    missing = [f for f in CITED_FIELDS if not cited.get(f)]
    invalid = [f"{c.get('table')}:{c.get('id')}" for f in CITED_FIELDS for c in cited.get(f) or []
               if not est.exists(c.get("table"), c.get("id"))]
    problems = ([f"no citation for {missing}"] if missing else []) + ([f"citation not in the data: {invalid}"] if invalid else [])
    return "; ".join(problems) or None


def check(est, spec, as_of=None):
    """Run every gate. Returns {passed, gates: [{gate, passed, detail}]}."""
    as_of = date.fromisoformat(as_of) if as_of else date.today()
    results = {
        "canonical_kpis": _canonical_kpis(est, spec),
        "certified_healthy_model": _certified_healthy_model(est, spec),
        "owner_and_review_date": _owner_and_review_date(est, spec, as_of),
        "measures_in_catalog": _measures_in_catalog(est, spec),
        "no_alive_duplicate": _no_alive_duplicate(est, spec),
        "valid_extend_target": _valid_target(est, spec),
        "evidence_cited": _evidence_cited(est, spec),
    }
    gates = [{"gate": g, "passed": d is None, "detail": d or "ok"} for g, d in results.items()]
    return {"passed": all(g["passed"] for g in gates), "gates": gates}


def batch(est):
    from pipeline import rec_json

    rows = []
    for req in est.requests:
        intent = parse_request(est, req)
        rec = recommend(est, intent)
        out = rec_json(est, intent, rec)
        row = {"id": req["request_id"], "action": rec.action, "spec": False, "passed": False, "failed": [], "skip": None,
               "model": rec.build_on}
        try:
            spec = build_spec(out["intent"], out["recommendation"], est, as_of=req["request_date"])
            result = check(est, spec, as_of=req["request_date"])
            row.update(spec=True, passed=result["passed"], failed=[g for g in result["gates"] if not g["passed"]])
        except ValueError as exc:
            row["skip"] = str(exc)
        rows.append(row)
    return rows


def report(est, rows):
    total, specs = len(rows), [r for r in rows if r["spec"]]
    passed = [r for r in specs if r["passed"]]
    by_gate, details = Counter(), defaultdict(Counter)
    for r in specs:
        for g in r["failed"]:
            by_gate[g["gate"]] += 1
            details[g["gate"]][g["detail"]] += 1
    skips = Counter(f"{r['action']}: {r['skip']}" for r in rows if not r["spec"])
    rate = f"{len(passed) / len(specs):.0%}" if specs else "n/a"
    owner_only = sum({g["gate"] for g in r["failed"]} == {"owner_and_review_date", "evidence_cited"} for r in specs)
    lines = [
        "# Spec quality report",
        "",
        "Generated by `python3 -I spec_gate.py estate.db`. Do not edit by hand. Synthetic data, created by SinceAI.",
        "",
        "The gates are pipeline logic: they show that every generated spec goes through the same deterministic rules",
        "and that a failure is named and explained. They do not measure whether a spec matches what a requester privately",
        "wanted. The rule-based parser ran here, with no LLM, so a rerun gives the same numbers.",
        "",
        f"- Business requests run: {total}",
        f"- Specs generated (new_build and extend with a semantic model): {len(specs)}",
        f"- Specs passing every gate: {len(passed)}/{len(specs)} ({rate})",
        f"- Specs blocked by at least one gate: {len(specs) - len(passed)}",
        f"- Specs blocked only because no owner could be proposed (the approver names one): {owner_only}",
        "- Crashes: 0 (any exception other than the expected no-spec outcome would stop this run)",
        "",
        "A blocked spec is the system working as designed: the estate is deliberately messy, and the gate names what must",
        "be fixed before release.",
        "",
        "## Failures by gate",
        "",
        "| Gate | Specs failing |",
        "| --- | --- |",
    ]
    gate_names = ("canonical_kpis", "certified_healthy_model", "owner_and_review_date", "measures_in_catalog",
                  "no_alive_duplicate", "valid_extend_target", "evidence_cited")
    lines += [f"| {g} | {by_gate[g]} |" for g in gate_names]
    lines += ["", "## Most common failure reasons", ""]
    for g in gate_names:
        for detail, n in details[g].most_common(5):
            lines.append(f"- `{g}` ({n}): {detail}")
    if not by_gate:
        lines.append("- none")
    blocking = Counter(r["model"] for r in specs if not r["passed"])
    lines += ["", "## Fix these semantic models first", "", "Specs blocked per model. One repair unblocks all of them.", ""]
    for model, n in blocking.most_common(5):
        m = est.models[model]
        owner = est.owners.get(m["owner_id"]) or {}
        lines.append(f"- {model} ({m['product_scope']}): {n} specs blocked. Endorsement {m['endorsement']}, refresh "
                     f"{m['refresh_status']}, owner {m['owner_id']} is {owner.get('status', 'missing')}.")
    lines += ["", "## Requests with no spec", "", "These decisions do not create a new artifact, or lack a model to build on.", ""]
    lines += [f"- {n}: {reason}" for reason, n in skips.most_common()]
    return "\n".join(lines) + "\n"


def main(db, out="docs/quality_report.md"):
    est = Estate(db)
    rows = batch(est)
    text = report(est, rows)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main(*sys.argv[1:3])
