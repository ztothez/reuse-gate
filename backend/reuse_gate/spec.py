"""Deterministic DashboardSpec generation for build decisions. Validated by spec_gate.py."""
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

REVIEW_AFTER_DAYS = 365  # default review cycle, a policy choice and not a data pack value


@dataclass
class DashboardSpec:
    title: str
    purpose: str
    products: list[str]
    market: str
    kpis: list[str]
    semantic_model: str | None
    source_action: str
    governance: list[str] = field(default_factory=list)
    target: str | None = None  # asset being extended
    measures: list[dict] = field(default_factory=list)
    owner: str | None = None
    review_date: str | None = None
    evidence: dict = field(default_factory=dict)  # field name -> citations


def owner_row(est, value):
    """The active Owners row for an id or name, or None."""
    for r in est.owners.values():
        if value in (r["owner_id"], r["owner_name"]) and r["status"] == "active":
            return r
    return None


def _proposed_owner(est, target_id, model_id):
    """The extended asset's owner, else the semantic model's owner, if still active. Never invented."""
    sources = [est.assets.get(target_id), est.models.get(model_id)]
    for source in sources:
        row = est.owners.get((source or {}).get("owner_id"))
        if row and row["status"] == "active":
            return row["owner_name"]
    return None


def _citations(est, spec, recommendation):
    def cite(table, key, note):
        return {"table": table, "id": key, "note": note}

    m = est.models.get(spec.semantic_model) or {}
    model_cite = cite("Semantic_Models", spec.semantic_model, f"scope {m.get('product_scope')}, region {m.get('region_scope')}")
    products = [cite("Products", est.product_ids[p], p) for p in spec.products if p in est.product_ids]
    if est.all_scope in spec.products:
        products.append(model_cite)
    if spec.market in est.markets:
        market = [cite("Markets", spec.market, est.markets[spec.market]["market_name"])]
    else:
        market = [cite("Markets", i, f"in {spec.market}") for i, r in est.markets.items() if r["region"] == spec.market][:1] or [model_cite]
    row = owner_row(est, spec.owner)
    action = [cite(e["table"], e["id"], e["note"]) for e in recommendation.get("evidence", []) if e["table"] == "Governance_Rules"]
    if spec.target:
        action.append(cite("Analytics_Assets", spec.target, "asset being extended"))
    return {
        "products": products,
        "market": market,
        "kpis": [cite("KPI_Catalog", est.canonical[k], f"{k}: canonical") for k in spec.kpis if k in est.canonical],
        "semantic_model": [model_cite],
        "owner": [cite("Owners", row["owner_id"], f"{row['owner_name']}, {row['role']}, active")] if row else [],
        "source_action": action,
    }


def build_spec(intent, recommendation, est=None, owner=None, review_date=None, as_of=None):
    action = recommendation["action"]
    if action not in {"new_build", "extend"}:
        raise ValueError("DashboardSpec is available only for new_build and extend")
    model = recommendation.get("build_on")
    if not model:
        raise ValueError("DashboardSpec requires a governed semantic model")
    products = ", ".join(intent["products"]) or "the selected products"
    title = f"{products} dashboard"
    target = recommendation.get("target") or {}
    if action == "extend" and target:
        title = f"Extended {target.get('name', 'dashboard')}"
    spec = DashboardSpec(
        title=title,
        purpose=f"Governed view of {', '.join(intent['kpis'])} for {products} in {intent['market']}.",
        products=intent["products"],
        market=intent["market"],
        kpis=intent["kpis"],
        semantic_model=model,
        source_action=action,
        governance=[
            "Use canonical KPI definitions only",
            "Register an owner and review date before release",
            "Keep evidence and approval in the decision log",
        ],
        target=target.get("id"),
        owner=owner,
        review_date=review_date,
    )
    if est is not None:
        start = date.fromisoformat(as_of) if as_of else date.today()
        spec.review_date = review_date or (start + timedelta(days=REVIEW_AFTER_DAYS)).isoformat()
        spec.owner = owner or _proposed_owner(est, spec.target, model)
        spec.measures = [
            {"kpi_id": est.canonical[k], "name": k, "source": "KPI_Catalog"} for k in spec.kpis if k in est.canonical
        ]
        spec.evidence = _citations(est, spec, recommendation)
    return asdict(spec)
