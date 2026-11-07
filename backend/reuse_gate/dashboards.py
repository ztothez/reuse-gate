"""Dashboards analysts build from the data pack: a title and a list of tiles, each one an explore query plus how to draw it.

The owner is the signed-in name. A dashboard is private to its owner until shared; shared dashboards are readable by every
role that reads all requests. Only the owner or an admin changes one.
"""
import uuid
from datetime import datetime, timezone

from reuse_gate.explore import CATALOG

CHARTS = ("bar", "line", "table", "number")
MAX_TILES = 24


class DashboardError(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def clean_tile(tile):
    if not isinstance(tile, dict):
        raise DashboardError("each tile must be an object")
    d = CATALOG.get(tile.get("dataset"))
    if not d or tile.get("measure") not in d["measures"]:
        raise DashboardError("each tile needs a known dataset and measure")
    for key in ("dimension", "split"):
        if tile.get(key) is not None and tile[key] not in d["dimensions"]:
            raise DashboardError(f"unknown {key}: {tile[key]}")
    chart = tile.get("chart") or "bar"
    width = tile.get("width") or 1
    if chart not in CHARTS or width not in (1, 2, 3):
        raise DashboardError(f"chart must be one of {', '.join(CHARTS)} and width 1 to 3")
    filters = tile.get("filters") or None
    if filters is not None and (not isinstance(filters, dict) or any(k not in d["dimensions"] for k in filters)):
        raise DashboardError("filters must use the dataset's dimensions")
    title = str(tile.get("title") or d["measures"][tile["measure"]][0])[:80]
    return {"dataset": tile["dataset"], "measure": tile["measure"], "dimension": tile.get("dimension"), "split": tile.get("split"),
            "filters": filters, "chart": chart, "width": width, "title": title}


def save(store, body, who):
    title = body.get("title")
    tiles = body.get("tiles")
    if not isinstance(title, str) or not title.strip():
        raise DashboardError("title is required")
    if not isinstance(tiles, list) or len(tiles) > MAX_TILES:
        raise DashboardError(f"tiles must be a list of at most {MAX_TILES}")
    existing = store.get(body.get("id"))
    if existing and existing["owner"] != who.name and who.role != "admin":
        raise PermissionError("only the owner or an admin changes this dashboard")
    request_id = body.get("request_id") if isinstance(body.get("request_id"), str) else None
    row = {"id": existing["id"] if existing else "DASH-" + uuid.uuid4().hex[:8].upper(), "title": title.strip()[:100],
           "description": str(body.get("description") or "")[:500], "tiles": [clean_tile(t) for t in tiles],
           "shared": bool(body.get("shared")), "request_id": request_id or (existing or {}).get("request_id"),
           "owner": existing["owner"] if existing else who.name, "created": existing["created"] if existing else now(),
           "updated": now(), "updated_by": who.name}
    return store.put(row)


def visible(who, row):
    return row["owner"] == who.name or row["shared"] or who.role == "admin" or not who.enforced
