"""Plain-language views built from live state and the data pack: the executive report and the operator wall.

Every figure comes from the data pack, the work item store, the decision log or data/evaluation.json, and each section
names its source. Modelled figures say so. No model writes these numbers.
"""
from collections import Counter
from datetime import datetime, timezone

from reuse_gate.explore import LOCK
from reuse_gate.export_mock import radar


def _rows(con, sql, params=()):
    with LOCK:
        cur = con.execute(sql, params)
        names = [c[0] for c in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()]


def _metric(evaluation, mid):
    for group in (evaluation or {}).get("groups", []):
        for m in group["metrics"]:
            if m["id"] == mid:
                return m
    return None


def executive(est, items, log, evaluation, changes):
    r = radar(est)
    t = r["totals"]
    avoided, specs_today, specs_fix = (_metric(evaluation, k) for k in ("new_builds_avoided", "specs_passing_today",
                                                                       "specs_passing_after_owner_fix"))
    status = Counter(i["status"] for i in items)
    decided = Counter(e.get("decision") for e in log)
    top = (r.get("ownership_bottlenecks") or [None])[0]
    latest = _rows(est.con, "SELECT MAX(month) AS m FROM Product_Market_Monthly WHERE value_type = 'actual_like_synthetic'")[0]["m"]
    sales = _rows(est.con, """SELECT p.product_name AS product, ROUND(SUM(t.net_sales_m_eur_syn), 1) AS net_sales,
                              ROUND(SUM(t.forecast_m_eur_syn), 1) AS forecast FROM Product_Market_Monthly t
                              JOIN Products p ON p.product_id = t.product_id
                              WHERE t.value_type = 'actual_like_synthetic' GROUP BY 1 ORDER BY 2 DESC""")
    total_sales = round(sum(s["net_sales"] for s in sales), 1)
    total_fc = round(sum(s["forecast"] for s in sales), 1)
    sections = []
    if avoided:
        share = round(100 * avoided["value"] / avoided["n"])
        sections.append({"title": "Build less", "source": "data/evaluation.json, impact group",
                         "text": f"Of {avoided['n']} report requests, {avoided['value']} ({share}%) can be met by reusing, repairing, "
                                 f"extending or migrating a report we already have, instead of building a new one. This is modelled: "
                                 f"it assumes each recommendation is approved."})
    sections.append({"title": "State of the report estate", "source": "Analytics_Assets, KPI_Catalog, Governance_Signals",
                     "text": f"We hold {t['assets']} reports. {t['dead_or_unused']} are unused or marked for retirement, "
                             f"{t['ownerless']} have no active owner, and {t['high_reach_uncertified']} reach many people without "
                             f"certification. {t['kpi_status'].get('definition_conflict', 0)} KPIs have conflicting definitions."})
    if top and specs_today and specs_fix:
        sections.append({"title": "The one fix that matters most", "source": "Owners, Semantic_Models, data/evaluation.json",
                         "text": f"{top['owner_name']} ({top['status']}) owns {', '.join(top['semantic_models'])}, which blocks "
                                 f"{top['specs_blocked']} new report specs. Assigning one active owner would raise passing specs from "
                                 f"{specs_today['value']} to {specs_fix['value']} of {specs_fix['n']} (modelled)."})
    if sales:
        gap = round(total_sales - total_fc, 1)
        lead = sales[0]
        sections.append({"title": "Business snapshot", "source": "Product_Market_Monthly, actual-like months (synthetic)",
                         "text": f"Net sales in the actual months up to {latest[:7]} total {total_sales} M EUR against a forecast of "
                                 f"{total_fc} M EUR ({'+' if gap >= 0 else ''}{gap} M EUR). {lead['product']} leads with "
                                 f"{lead['net_sales']} M EUR."})
    open_items = status["awaiting_approval"] + status["human_review"] + status["clarifying"]
    pending = sum(1 for c in changes if c["status"] == "proposed")
    sections.append({"title": "Work in progress", "source": "work items, decision log, config change requests",
                     "text": f"{len(items)} requests are in Reuse Gate: {open_items} open ({status['awaiting_approval']} waiting for an "
                             f"approver, {status['human_review']} with a person, {status['clarifying']} answering questions), "
                             f"{status['approved']} approved and {status['rejected']} rejected. {decided['approve']} approvals are on "
                             f"record. {pending} configuration change{'s' if pending != 1 else ''} wait for review."})
    actions = []
    if top:
        actions.append(f"Assign an active owner to {', '.join(top['semantic_models'])}.")
    if t["dead_or_unused"]:
        actions.append(f"Review the {t['dead_or_unused']} unused reports for retirement; each one is cost without use.")
    if t["kpi_status"].get("definition_conflict"):
        actions.append(f"Agree one definition for the {t['kpi_status']['definition_conflict']} conflicting KPIs.")
    if status["awaiting_approval"]:
        actions.append(f"Clear the {status['awaiting_approval']} requests waiting for approval.")
    return {"title": "Reuse Gate executive report", "generated_at": datetime.now(timezone.utc).isoformat(),
            "headline": sections[0]["text"] if sections else "", "sections": sections, "actions": actions,
            "figures": {"avoided": avoided and avoided["value"], "requests": avoided and avoided["n"], "assets": t["assets"],
                        "unused": t["dead_or_unused"], "ownerless": t["ownerless"], "net_sales": total_sales, "forecast": total_fc},
            "sales_by_product": sales, "data_note": "Built from Bayer's synthetic data pack and this service's own records."}


def as_text(report):
    lines = [report["title"], report["generated_at"][:16].replace("T", " ") + " UTC", ""]
    for s in report["sections"]:
        lines += [s["title"], s["text"], f"Source: {s['source']}", ""]
    if report["actions"]:
        lines += ["Recommended actions"] + [f"- {a}" for a in report["actions"]] + [""]
    return "\n".join(lines + [report["data_note"]])


def operations(est, items):
    """The operator wall: what is broken now and who owns it. Counts and names only, no request text."""
    owner = lambda oid: (est.owners.get(oid) or {}).get("owner_name") or "No owner"
    failed = [{"id": m["model_id"], "name": m["model_name"], "owner": owner(m["owner_id"]),
               "owner_active": (est.owners.get(m["owner_id"]) or {}).get("status") == "active"}
              for m in est.models.values() if m["refresh_status"] == "failed"]
    month = _rows(est.con, "SELECT MAX(month) AS m FROM Asset_Usage")[0]["m"]
    errors = _rows(est.con, """SELECT a.asset_id AS id, a.asset_name AS name, a.owner_id AS owner_id, t.query_errors AS errors,
                               t.avg_load_ms AS load_ms FROM Asset_Usage t JOIN Analytics_Assets a ON a.asset_id = t.asset_id
                               WHERE t.month = ? AND t.query_errors > 0 ORDER BY t.query_errors DESC LIMIT 8""", (month,))
    for e in errors:
        e["owner"] = owner(e.pop("owner_id"))
    supply = _rows(est.con, """SELECT p.product_name AS product, m.market_name AS market, t.risk_status AS risk,
                               t.otif_pct_syn AS otif, t.inventory_weeks_syn AS inventory_weeks FROM Supply_Operations t
                               JOIN Products p ON p.product_id = t.product_id JOIN Markets m ON m.market_id = t.market_id
                               ORDER BY t.otif_pct_syn ASC LIMIT 8""")
    risk = Counter(r["risk"] for r in _rows(est.con, "SELECT risk_status AS risk FROM Supply_Operations"))
    signals = Counter(r["code"] for r in _rows(est.con, "SELECT signal_code AS code FROM Governance_Signals "
                                                        "WHERE status = 'open' AND severity = 'high'"))
    status = Counter(i["status"] for i in items)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "usage_month": month,
            "failed_refresh": failed, "query_errors": errors, "supply_lowest_otif": supply, "supply_risk": dict(risk),
            "open_high_signals": dict(signals),
            "queue": {k: status[k] for k in ("awaiting_approval", "human_review", "clarifying")},
            "sources": ["Semantic_Models", "Asset_Usage", "Supply_Operations", "Governance_Signals", "work items"]}
