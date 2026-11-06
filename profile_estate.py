"""Profile the loaded estate: what is messy, duplicated, stale or ungoverned.

Usage: python3 -I profile_estate.py <db>
"""
import sqlite3
import sys

QUERIES = {
    "assets by lifecycle_status": "SELECT lifecycle_status, COUNT(*) FROM Analytics_Assets GROUP BY 1 ORDER BY 2 DESC",
    "assets by endorsement": "SELECT endorsement, COUNT(*) FROM Analytics_Assets GROUP BY 1 ORDER BY 2 DESC",
    "assets by platform / type": "SELECT platform, asset_type, COUNT(*) FROM Analytics_Assets GROUP BY 1,2 ORDER BY 3 DESC",
    "KPI definition/approval status": "SELECT definition_status, approval_status, COUNT(*) FROM KPI_Catalog GROUP BY 1,2 ORDER BY 3 DESC",
    "canonical metrics with several variants": "SELECT canonical_metric, COUNT(*) n FROM KPI_Catalog GROUP BY 1 HAVING n>1 ORDER BY n DESC LIMIT 12",
    "owners by status": "SELECT status, COUNT(*) FROM Owners GROUP BY 1",
    "assets with missing or inactive owner": "SELECT COUNT(*) FROM Analytics_Assets a LEFT JOIN Owners o ON a.owner_id=o.owner_id WHERE o.owner_id IS NULL OR o.status<>'active'",
    "high reach (audience>=1000) but not certified/promoted": "SELECT COUNT(*) FROM Analytics_Assets WHERE estimated_audience>=1000 AND endorsement NOT IN ('certified','promoted')",
    "assets with <100 total views": "SELECT COUNT(*) FROM (SELECT asset_id, SUM(views) v FROM Asset_Usage GROUP BY 1) WHERE v<100",
    "governance signals by code/severity": "SELECT signal_code, severity, COUNT(*) FROM Governance_Signals GROUP BY 1,2 ORDER BY 3 DESC",
    "migration backlog path/status": "SELECT recommended_path_candidate, status, COUNT(*) FROM Migration_Backlog GROUP BY 1,2 ORDER BY 3 DESC",
    "semantic models by ai_readiness / issue": "SELECT ai_readiness, ai_issue_pattern, COUNT(*) FROM Semantic_Models GROUP BY 1,2 ORDER BY 3 DESC",
    "distinct business request texts": "SELECT COUNT(DISTINCT request_text) FROM Business_Requests",
    "most common request texts": "SELECT substr(request_text,1,110), COUNT(*) FROM Business_Requests GROUP BY request_text ORDER BY 2 DESC LIMIT 12",
    "models serving the most assets": "SELECT model_id, COUNT(*) n FROM Analytics_Assets GROUP BY 1 ORDER BY n DESC LIMIT 5",
    "sample asset names": "SELECT asset_name, product_scope, market_scope, lifecycle_status FROM Analytics_Assets LIMIT 12",
}

con = sqlite3.connect(sys.argv[1])
for title, sql in QUERIES.items():
    print(f"\n## {title}")
    for row in con.execute(sql):
        print("  " + " | ".join(str(c) for c in row))
