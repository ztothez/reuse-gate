"""In-memory view of the analytics estate, loaded into SQLite by load_estate.py.

Division vocabulary (KPI phrases, the all-products scope) lives in data/catalog.json, not in code.
"""
import json
import re
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path

DEFAULT_CATALOG = Path(__file__).resolve().parents[2] / "data" / "catalog.json"

ID_COLUMN = {
    "Analytics_Assets": "asset_id",
    "KPI_Catalog": "kpi_id",
    "Semantic_Models": "model_id",
    "Governance_Signals": "signal_id",
    "Migration_Backlog": "source_asset_id",
    "Governance_Rules": "rule_id",
    "Owners": "owner_id",
    "Asset_Usage": "asset_id",
    "Products": "product_id",
    "Markets": "market_id",
}


MAX_NAME = 120  # longer display names are cut; the data pack's longest asset name is far shorter
NAME_FIELDS = (("assets", "asset_name"), ("kpis", "kpi_name"))  # display names that reach the rationale, the UI and Listen


def clean_name(value, row_id):
    """A display name safe to show and read aloud: (clean value, list of issues). Ids and canonical metrics are never changed.

    Control and format characters (NUL, bidi overrides, zero-width) are removed, whitespace is collapsed, an instruction-like
    name is withheld and replaced by its id, and an over-long name is cut.
    """
    from reuse_gate.recommend import INJECTION  # recommend imports modules that import this one
    if not isinstance(value, str):
        return value, []
    issues = []
    text = "".join(ch for ch in value if not unicodedata.category(ch).startswith("C") or ch in "\t\n")
    if text != value:
        issues.append("control characters removed")
    text = re.sub(r"\s+", " ", text).strip()
    if INJECTION.search(text):
        return f"[name withheld: {row_id}]", issues + ["instruction-like wording"]
    if len(text) > MAX_NAME:
        text, issues = text[: MAX_NAME - 3].rstrip() + "...", issues + [f"longer than {MAX_NAME} characters"]
    return text, issues


def _rows(con, sql, params=()):
    return [dict(r) for r in con.execute(sql, params)]


class Estate:
    def __init__(self, db_path, catalog_path=DEFAULT_CATALOG):
        self.catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
        self.all_scope = self.catalog["all_scope"]
        self.con = sqlite3.connect(db_path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        c = self.con
        self.assets = {r["asset_id"]: r for r in _rows(c, "SELECT * FROM Analytics_Assets")}
        self.models = {r["model_id"]: r for r in _rows(c, "SELECT * FROM Semantic_Models")}
        self.owners = {r["owner_id"]: r for r in _rows(c, "SELECT * FROM Owners")}
        self.kpis = {r["kpi_id"]: r for r in _rows(c, "SELECT * FROM KPI_Catalog")}
        self.markets = {r["market_id"]: r for r in _rows(c, "SELECT * FROM Markets")}
        self.product_ids = {r["product_name"]: r["product_id"] for r in _rows(c, "SELECT product_id, product_name FROM Products")}
        self.products = list(self.product_ids)
        self.rules = {r["rule_id"]: r for r in _rows(c, "SELECT * FROM Governance_Rules")}
        self.backlog = {r["source_asset_id"]: r for r in _rows(c, "SELECT * FROM Migration_Backlog")}
        self.requests = _rows(c, "SELECT * FROM Business_Requests ORDER BY request_id")
        self.canonical = {
            r["canonical_metric"]: r["kpi_id"] for r in self.kpis.values() if r["definition_status"] == "canonical"
        }
        self.asset_kpis = defaultdict(list)
        self.kpi_roles = {}
        for r in _rows(c, "SELECT asset_id, kpi_id, usage_role FROM Asset_KPI_Map"):
            self.asset_kpis[r["asset_id"]].append(r["kpi_id"])
            self.kpi_roles[(r["asset_id"], r["kpi_id"])] = r["usage_role"]
        self.signals = defaultdict(list)
        for r in _rows(c, "SELECT * FROM Governance_Signals"):
            self.signals[r["asset_id"]].append(r)
        months = sorted(r["month"] for r in _rows(c, "SELECT DISTINCT month FROM Asset_Usage"))[-3:]
        marks = ",".join("?" * len(months))
        self.usage = {
            r["asset_id"]: r
            for r in _rows(
                c,
                "SELECT asset_id, SUM(views) AS views, SUM(unique_users) AS users, SUM(query_errors) AS errors "
                f"FROM Asset_Usage WHERE month IN ({marks}) GROUP BY asset_id",
                months,
            )
        }
        self.max_views = max((u["views"] for u in self.usage.values()), default=1) or 1
        self.name_issues = []  # (table attribute, id, issues) for every display name cleaned at load
        for attr, column in NAME_FIELDS:
            for row_id, row in getattr(self, attr).items():
                row[column], issues = clean_name(row[column], row_id)
                if issues:
                    self.name_issues.append((attr, row_id, issues))

    def views(self, asset_id):
        return (self.usage.get(asset_id) or {}).get("views", 0)

    def users(self, asset_id):
        return (self.usage.get(asset_id) or {}).get("users", 0)

    def owner_active(self, asset):
        owner = self.owners.get(asset["owner_id"])
        return bool(owner) and owner["status"] == "active"

    def asset_model(self, asset_id):
        row = self.con.execute(
            "SELECT source_id FROM Lineage_Edges WHERE target_id=? AND edge_type='MODEL_TO_ASSET'", (asset_id,)
        ).fetchone()
        return row[0] if row else None

    def exists(self, table, key):
        if table == "Lineage_Edges":
            src, _, tgt = key.partition("->")
            sql, args = "SELECT 1 FROM Lineage_Edges WHERE source_id=? AND target_id=?", (src, tgt)
        elif table == "Asset_KPI_Map":
            asset, _, kpi = key.partition(":")
            sql, args = "SELECT 1 FROM Asset_KPI_Map WHERE asset_id=? AND kpi_id=?", (asset, kpi)
        else:
            sql, args = f"SELECT 1 FROM {table} WHERE {ID_COLUMN[table]}=? LIMIT 1", (key,)
        return self.con.execute(sql, args).fetchone() is not None
