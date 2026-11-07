"""Deterministic quality gates for a generated DashboardSpec, plus the batch quality report.

These gates are pipeline logic: they prove every artifact follows the same governance rules, every time.
They do not measure whether a spec matches what the requester privately had in mind.

Usage: PYTHONPATH=backend python3 -m reuse_gate.spec_gate data/estate.db [docs/quality_report.md]
"""
import copy
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from reuse_gate.estate import Estate
from reuse_gate.recommend import Intent, assess, parse_request, recommend, scoped_assessments
from reuse_gate.spec import build_spec, owner_row

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
    from reuse_gate.pipeline import rec_json

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


def canonical_only(est):
    """A copy of the estate where a primary row on a non-canonical definition no longer counts. For comparison only."""
    strict = copy.copy(est)
    strict.kpi_roles = {key: "secondary" if est.kpis[key[1]]["definition_status"] != "canonical" else role
                        for key, role in est.kpi_roles.items()}
    return strict


def _summary(est, rows):
    actions = Counter(r["action"] for r in rows)
    specs = [r for r in rows if r["spec"]]
    results = [recommend(est, parse_request(est, req)) for req in est.requests]
    return {
        "New builds avoided": f"{len(rows) - actions['new_build']}/{len(rows)}",
        "new_build": actions["new_build"], "extend": actions["extend"], "repair_and_reuse": actions["repair_and_reuse"],
        "reuse": actions["reuse"], "migrate": actions["migrate"], "human_review": actions["human_review"],
        "Citations": sum(len(r.evidence) for r in results),
        "Assets to retire": len({a for r in results for a in r.retire}),
        "Assets to consolidate later": len({a for r in results for a in r.consolidate}),
        "Specs passing every gate": f"{sum(r['passed'] for r in specs)}/{len(specs)}",
    }


def estate_impact(est):
    """The estate today, against the same 150 requests with and without the check. Counts recommendations, not completed work."""
    intents = [parse_request(est, req) for req in est.requests]
    results = [(i, recommend(est, i)) for i in intents]
    requests, builds = len(results), [(i, r) for i, r in results if r.action == "new_build"]
    retired = {a for _, r in results for a in r.retire}
    repaired = {r.target: r.repair for _, r in results if r.action in ("repair_and_reuse", "extend")}
    ownerless = {a for a in est.assets if not est.owner_active(est.assets[a])}
    high_reach = {a for a, x in est.assets.items() if x["endorsement"] not in ("certified", "promoted") and est.views(a) >= 1000}
    gets_owner = {a for a, gaps in repaired.items() if any(g.startswith("owner ") for g in gaps)}
    gets_trust = {a for a, gaps in repaired.items() if "not certified or promoted" in gaps}
    today = len(est.assets)
    return {
        "today": today, "requests": requests, "without": today + requests, "with": today + len(builds) - len(retired),
        "builds": len(builds), "avoided": requests - len(builds), "retired": len(retired), "consolidate": len({a for _, r in results for a in r.consolidate}),
        "distinct_builds": len({(tuple(i.products), i.market, tuple(sorted(i.kpis))) for i, _ in builds}), "repaired": len(repaired),
        "ownerless": len(ownerless), "ownerless_after": len(ownerless - gets_owner - retired),
        "high_reach": len(high_reach), "high_reach_after": len(high_reach - gets_trust - retired),
    }


def impact_svg(impact):
    """One series, so one colour, on one zero baseline. The table next to it in the report carries the same numbers."""
    bars = [("Today", impact["today"]), ("After 150 requests, with Reuse Gate", impact["with"]), ("After 150 requests, no check", impact["without"])]
    width, left, right, top, gap, thick = 720, 16, 64, 20, 58, 24
    scale = (width - left - right) / max(v for _, v in bars)
    marks = []
    for n, (name, value) in enumerate(bars):
        y, w = top + n * gap, value * scale
        marks.append(f'<text class="label" x="{left}" y="{y + 12}">{name}</text>')
        marks.append(f'<path class="bar" d="M{left} {y + 20}h{w - 4:.1f}a4 4 0 0 1 4 4v{thick - 8}a4 4 0 0 1 -4 4h-{w - 4:.1f}z"><title>{name}: {value} assets</title></path>')
        marks.append(f'<text class="value" x="{left + w + 8:.1f}" y="{y + 37}">{value}</text>')
    height = top + len(bars) * gap + 8
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" role="img" '
            f'aria-label="Assets in the estate: {", ".join(f"{n} {v}" for n, v in bars)}">\n<title>Assets in the estate</title>\n'
            '<style>\n.surface{fill:#fcfcfb}.bar{fill:#2a78d6}.label{fill:#52514e;font:13px sans-serif}.value{fill:#0b0b0b;font:600 14px sans-serif}\n'
            '@media (prefers-color-scheme:dark){.surface{fill:#1a1a19}.bar{fill:#3987e5}.label{fill:#c3c2b7}.value{fill:#f0efec}}\n</style>\n'
            f'<rect class="surface" width="{width}" height="{height}" rx="6"/>\n' + "\n".join(marks) + "\n</svg>\n")


def impact_lines(impact):
    return ["## Estate impact: before and after", "",
            f"![Assets in the estate: {impact['today']} today, {impact['with']} after 150 requests with Reuse Gate, {impact['without']} with no check](estate_impact.svg)", "",
            "| Measure | Today | After 150 requests, no check | After 150 requests, with Reuse Gate |", "| --- | --- | --- | --- |",
            f"| Assets in the estate | {impact['today']} | {impact['without']} | {impact['with']} |",
            f"| New assets | | {impact['requests']} | {impact['builds']} |",
            f"| Assets retired | | 0 | {impact['retired']} |",
            f"| Existing assets repaired or extended | | 0 | {impact['repaired']} |",
            f"| Assets with no active owner | {impact['ownerless']} | not modelled | {impact['ownerless_after']} |",
            f"| High-reach assets that are not certified or promoted | {impact['high_reach']} | not modelled | {impact['high_reach_after']} |", "",
            f"The gate avoids {impact['avoided']} of {impact['requests']} new builds, and the estate ends {impact['without'] - impact['with']} assets smaller than with no check.", "",
            "How to read this:", "",
            "- This is a projection from the recommendations, not a measured result. It assumes every recommendation is approved and carried out.",
            "- \"No check\" assumes every request becomes one new asset. The data pack does not record what would really have happened.",
            f"- Some requests repeat. The {impact['builds']} new builds cover {impact['distinct_builds']} distinct combinations of product, market and KPIs, so a real team could build fewer. The figure does not count that saving.",
            f"- Requests sent to human review add no asset here, and a person may still decide to build. The {impact['consolidate']} assets to consolidate later are not removed.",
            "- Owner and certification rows only count gaps that a recommended repair names on its target. New assets must have an owner to pass the gates, so they add no ownerless assets.", ""]


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
        "Generated by `PYTHONPATH=backend python3 -m reuse_gate.spec_gate data/estate.db`. Do not edit by hand. Synthetic data, created by SinceAI.",
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
    lines[lines.index("## Failures by gate"):lines.index("## Failures by gate")] = impact_lines(estate_impact(est))
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
    strict = canonical_only(est)
    current, stricter = _summary(est, rows), _summary(strict, batch(strict))
    lines += ["", "## For information: canonical definitions only", "",
              "The rule in use lets a primary row on a conflicting or local definition qualify, because repairing the definition is",
              "cheaper than a new build, and the result lists that repair. This table measures a stricter version where only a primary",
              "row on the canonical definition counts. It is information only: **the rule has not changed.**", "",
              "| Measure | Rule in use | Canonical only |", "| --- | --- | --- |"]
    lines += [f"| {k} | {current[k]} | {stricter[k]} |" for k in current]
    return "\n".join(lines) + "\n"


def main(db, out="docs/quality_report.md"):
    est = Estate(db)
    rows = batch(est)
    text = report(est, rows)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(text, encoding="utf-8")
    (Path(out).parent / "estate_impact.svg").write_text(impact_svg(estate_impact(est)), encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main(*sys.argv[1:3])
