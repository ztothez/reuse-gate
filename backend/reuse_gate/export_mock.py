"""Export mock API responses (one per distinct request text) plus a radar summary.

Usage: PYTHONPATH=backend python3 -m reuse_gate.export_mock data/estate.db data/mock_api.json
The shapes here are the contract the front end consumes from the API.
"""
import json
import sys
from collections import Counter, defaultdict

from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM
from reuse_gate.pipeline import run_request
from reuse_gate.remediate import ownership_bottlenecks


def radar(est):
    kpi_status = Counter(k["definition_status"] for k in est.kpis.values())
    no_owner = [a for a in est.assets.values() if not est.owner_active(a)]
    uncert = [a for a in est.assets.values()
              if a["endorsement"] not in ("certified", "promoted") and est.views(a["asset_id"]) >= 1000]
    dead = [a for a in est.assets.values()
            if a["lifecycle_status"] != "active" or est.views(a["asset_id"]) < 100]
    by_metric = defaultdict(list)
    for k in est.kpis.values():
        by_metric[k["canonical_metric"]].append(k)
    conflicts = [{"metric": m, "variants": [{"id": k["kpi_id"], "name": k["kpi_name"], "status": k["definition_status"]} for k in ks]}
                 for m, ks in by_metric.items() if len(ks) > 1]
    def reason(a):
        why = []
        if a["lifecycle_status"] != "active":
            why.append(f"lifecycle: {a['lifecycle_status']}")
        if est.views(a["asset_id"]) < 100:
            why.append("low usage")
        return ", ".join(why)
    brief = lambda a: {"id": a["asset_id"], "name": a["asset_name"], "views_3m": est.views(a["asset_id"]),
                       "endorsement": a["endorsement"], "status": a["lifecycle_status"], "reason": reason(a)}
    return {
        "totals": {"assets": len(est.assets), "kpis": len(est.kpis), "kpi_status": dict(kpi_status),
                   "ownerless": len(no_owner), "high_reach_uncertified": len(uncert), "dead_or_unused": len(dead)},
        "kpi_conflicts": sorted(conflicts, key=lambda c: -len(c["variants"]))[:10],
        "ownerless_assets": [brief(a) for a in no_owner[:10]],
        "high_reach_uncertified": [brief(a) for a in sorted(uncert, key=lambda a: -est.views(a["asset_id"]))[:10]],
        "dead_assets": [brief(a) for a in dead[:10]],
        "ownership_bottlenecks": ownership_bottlenecks(est),
    }


def main(db, out):
    est = Estate(db)
    seen, items = set(), []
    for req in est.requests:
        if req["request_text"] in seen:
            continue
        seen.add(req["request_text"])
        items.append(run_request(est, req, NoLLM(), as_of=req["request_date"]))  # rules only, reproducible
    json.dump({"requests": items, "radar": radar(est)}, open(out, "w"), indent=2, default=str)
    print(f"{len(items)} requests exported to {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
