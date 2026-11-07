"""Explore the data pack for dashboards: a fixed catalog of datasets, dimensions and measures, and one aggregate query.

Every identifier in a query must come from CATALOG, so no caller text ever reaches SQL. Values are the data pack's own rows
(synthetic, as Bayer provides them); nothing is generated. A tile is {dataset, dimension, measure, split?, filters?, limit?}.
KPI_MEASURES maps a KPI's canonical metric to the dataset measure that holds it, so a spec can be previewed with real rows.
"""
import threading

LOCK = threading.Lock()
MAX_ROWS = 500

_PM = "Product_Market_Monthly t JOIN Products p ON p.product_id = t.product_id JOIN Markets m ON m.market_id = t.market_id"
_USAGE = "Asset_Usage t JOIN Analytics_Assets a ON a.asset_id = t.asset_id"

# dataset: label, FROM clause, dimensions {id: (label, sql)}, measures {id: (label, sql aggregate, unit)}
CATALOG = {
    "sales": {
        "label": "Product and market monthly",
        "source": "Product_Market_Monthly",
        "from": _PM,
        "dimensions": {"month": ("Month", "t.month"), "product": ("Product", "p.product_name"),
                       "market": ("Market", "m.market_name"), "region": ("Region", "m.region"),
                       "therapeutic_area": ("Therapeutic area", "p.therapeutic_area"), "value_type": ("Value type", "t.value_type")},
        "measures": {"net_sales": ("Net sales (M EUR)", "ROUND(SUM(t.net_sales_m_eur_syn), 2)", "M EUR"),
                     "forecast": ("Forecast (M EUR)", "ROUND(SUM(t.forecast_m_eur_syn), 2)", "M EUR"),
                     "units": ("Units shipped", "SUM(t.units_shipped_syn)", "units"),
                     "forecast_variance": ("Forecast variance (%)", "ROUND(AVG(t.forecast_variance_pct), 1)", "%"),
                     "access_coverage": ("Market access coverage (%)", "ROUND(AVG(t.market_access_coverage_pct_syn), 1)", "%"),
                     "otif": ("On-time in-full (%)", "ROUND(AVG(t.otif_pct_syn), 1)", "%"),
                     "inventory_weeks": ("Inventory (weeks)", "ROUND(AVG(t.inventory_weeks_syn), 1)", "weeks")},
    },
    "usage": {
        "label": "Report usage",
        "source": "Asset_Usage",
        "from": _USAGE,
        "dimensions": {"month": ("Month", "t.month"), "platform": ("Platform", "a.platform"), "asset_type": ("Asset type", "a.asset_type"),
                       "lifecycle": ("Lifecycle", "a.lifecycle_status"), "endorsement": ("Endorsement", "a.endorsement"),
                       "product": ("Product scope", "a.product_scope"), "asset": ("Asset", "a.asset_name")},
        "measures": {"views": ("Views", "SUM(t.views)", "views"), "users": ("Unique users", "SUM(t.unique_users)", "users"),
                     "exports": ("Exports", "SUM(t.exports)", "exports"), "query_errors": ("Query errors", "SUM(t.query_errors)", "errors"),
                     "load_ms": ("Average load (ms)", "ROUND(AVG(t.avg_load_ms))", "ms")},
    },
    "assets": {
        "label": "Report estate",
        "source": "Analytics_Assets",
        "from": "Analytics_Assets t",
        "dimensions": {"platform": ("Platform", "t.platform"), "asset_type": ("Asset type", "t.asset_type"),
                       "lifecycle": ("Lifecycle", "t.lifecycle_status"), "endorsement": ("Endorsement", "t.endorsement"),
                       "classification": ("Classification", "t.classification"), "product": ("Product scope", "t.product_scope"),
                       "delivery": ("Delivery model", "t.delivery_model")},
        "measures": {"count": ("Assets", "COUNT(*)", "assets"), "audience": ("Estimated audience", "SUM(t.estimated_audience)", "people")},
    },
    "signals": {
        "label": "Governance signals",
        "source": "Governance_Signals",
        "from": "Governance_Signals t",
        "dimensions": {"signal": ("Signal", "t.signal_code"), "severity": ("Severity", "t.severity"), "status": ("Status", "t.status"),
                       "detected_by": ("Detected by", "t.detected_by")},
        "measures": {"count": ("Signals", "COUNT(*)", "signals")},
    },
    "supply": {
        "label": "Supply operations",
        "source": "Supply_Operations",
        "from": "Supply_Operations t JOIN Products p ON p.product_id = t.product_id JOIN Markets m ON m.market_id = t.market_id",
        "dimensions": {"product": ("Product", "p.product_name"), "market": ("Market", "m.market_name"), "region": ("Region", "m.region"),
                       "risk": ("Risk status", "t.risk_status"), "mode": ("Primary mode", "t.primary_mode")},
        "measures": {"otif": ("On-time in-full (%)", "ROUND(AVG(t.otif_pct_syn), 1)", "%"),
                     "inventory_weeks": ("Inventory (weeks)", "ROUND(AVG(t.inventory_weeks_syn), 1)", "weeks"),
                     "forecast_accuracy": ("Forecast accuracy (%)", "ROUND(AVG(t.forecast_accuracy_pct_syn), 1)", "%"),
                     "count": ("Product-market pairs", "COUNT(*)", "pairs")},
    },
    "market_access": {
        "label": "Market access",
        "source": "Market_Access",
        "from": "Market_Access t JOIN Products p ON p.product_id = t.product_id JOIN Markets m ON m.market_id = t.market_id",
        "dimensions": {"product": ("Product", "p.product_name"), "market": ("Market", "m.market_name"), "region": ("Region", "m.region"),
                       "reimbursement": ("Reimbursement", "t.reimbursement_status"), "trend": ("Trend", "t.trend_status")},
        "measures": {"coverage": ("Coverage (%)", "ROUND(AVG(t.coverage_pct_syn), 1)", "%"), "count": ("Product-market pairs", "COUNT(*)", "pairs")},
    },
    "models": {
        "label": "Semantic models",
        "source": "Semantic_Models",
        "from": "Semantic_Models t",
        "dimensions": {"refresh": ("Refresh status", "t.refresh_status"), "endorsement": ("Endorsement", "t.endorsement"),
                       "model_type": ("Model type", "t.model_type"), "ai_readiness": ("AI readiness", "t.ai_readiness"),
                       "product": ("Product scope", "t.product_scope")},
        "measures": {"count": ("Models", "COUNT(*)", "models"), "measures": ("Measures", "SUM(t.measure_count)", "measures")},
    },
}

KPI_MEASURES = {
    "Net Sales": ("sales", "net_sales"), "Net Sales Growth": ("sales", "net_sales"), "Units Shipped": ("sales", "units"),
    "Forecast Variance": ("sales", "forecast_variance"), "Budget Variance": ("sales", "forecast_variance"),
    "Demand Forecast Accuracy": ("supply", "forecast_accuracy"), "Demand Forecast Bias": ("sales", "forecast_variance"),
    "Inventory Coverage": ("sales", "inventory_weeks"), "On-Time In-Full": ("sales", "otif"),
    "Market Access Coverage": ("sales", "access_coverage"), "Reimbursement Status Coverage": ("market_access", "coverage"),
    "Report Adoption": ("usage", "views"), "Certified Asset Share": ("assets", "count"),
}


class QueryError(ValueError):
    pass


def catalog():
    """GET /explore/catalog: what can be put on a tile. No SQL is returned."""
    return [{"id": ds, "label": d["label"], "source": d["source"],
             "dimensions": [{"id": k, "label": v[0]} for k, v in d["dimensions"].items()],
             "measures": [{"id": k, "label": v[0], "unit": v[2]} for k, v in d["measures"].items()]}
            for ds, d in CATALOG.items()]


def _filters(d, filters):
    where, params = [], []
    if filters is None:
        return where, params
    if not isinstance(filters, dict) or len(filters) > 5:
        raise QueryError("filters must be an object with at most 5 dimensions")
    for dim, values in filters.items():
        if dim not in d["dimensions"]:
            raise QueryError(f"unknown filter dimension: {dim}")
        values = values if isinstance(values, list) else [values]
        if not values or len(values) > 50 or not all(isinstance(v, (str, int, float)) for v in values):
            raise QueryError("filter values must be 1 to 50 plain values")
        where.append(f"{d['dimensions'][dim][1]} IN ({', '.join('?' * len(values))})")
        params.extend(values)
    return where, params


def query(con, tile):
    """Aggregate rows for one tile: [{dimension value, split value?, measure value}], with the source table cited."""
    if not isinstance(tile, dict):
        raise QueryError("tile must be an object")
    d = CATALOG.get(tile.get("dataset"))
    if not d:
        raise QueryError("unknown dataset")
    dim, measure, split = tile.get("dimension"), tile.get("measure"), tile.get("split")
    if dim is not None and dim not in d["dimensions"]:
        raise QueryError(f"unknown dimension: {dim}")
    if measure not in d["measures"]:
        raise QueryError(f"unknown measure: {measure}")
    if split is not None and (split not in d["dimensions"] or split == dim or dim is None):
        raise QueryError("split must be a second, different dimension")
    limit = tile.get("limit", 200)
    if not isinstance(limit, int) or not 1 <= limit <= MAX_ROWS:
        raise QueryError(f"limit must be 1 to {MAX_ROWS}")
    where, params = _filters(d, tile.get("filters"))
    groups = [d["dimensions"][g][1] for g in (dim, split) if g]
    select = [f"{g} AS g{i}" for i, g in enumerate(groups)] + [f"{d['measures'][measure][1]} AS value"]
    sql = f"SELECT {', '.join(select)} FROM {d['from']}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    if groups:
        sql += " GROUP BY " + ", ".join(f"g{i}" for i in range(len(groups)))
        sql += " ORDER BY g0" if dim == "month" else " ORDER BY value DESC"
    sql += " LIMIT ?"
    with LOCK:
        rows = con.execute(sql, [*params, limit]).fetchall()
    keys = [k for k in (dim, split) if k]
    out = [{**{k: r[i] for i, k in enumerate(keys)}, "value": r[len(keys)]} for r in rows]
    label, _, unit = d["measures"][measure]
    return {"dataset": tile["dataset"], "source": d["source"], "dimension": dim, "split": split, "measure": measure,
            "measure_label": label, "unit": unit, "rows": out, "truncated": len(out) == limit}


def tiles_for_spec(spec):
    """Starter tiles for a DashboardSpec: one per requested KPI the data pack holds, by month, then by market."""
    tiles, seen = [], set()
    for m in (spec or {}).get("measures") or []:
        name = m.get("canonical_metric") or m.get("name") if isinstance(m, dict) else m
        hit = next((v for k, v in KPI_MEASURES.items() if isinstance(name, str) and k.lower() in name.lower()), None)
        if not hit or hit in seen:
            continue
        seen.add(hit)
        dataset, measure = hit
        dims = CATALOG[dataset]["dimensions"]
        tiles.append({"dataset": dataset, "measure": measure, "dimension": "month" if "month" in dims else next(iter(dims)),
                      "chart": "line" if "month" in dims else "bar", "title": CATALOG[dataset]["measures"][measure][0], "width": 2})
        if "market" in dims:
            tiles.append({"dataset": dataset, "measure": measure, "dimension": "market", "chart": "bar",
                          "title": f"{CATALOG[dataset]['measures'][measure][0]} by market", "width": 1})
    return tiles
