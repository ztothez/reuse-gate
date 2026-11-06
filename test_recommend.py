"""Property tests over all 150 business requests. Run load_estate.py first to create estate.db."""
import unittest
from pathlib import Path

from estate import Estate
from recommend import LOW_VIEWS, parse_request, recommend, scoped_assessments

DB = Path(__file__).parent / "estate.db"


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class RecommendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))
        cls.runs = []
        for req in cls.est.requests:
            intent = parse_request(cls.est, req)
            cls.runs.append((intent, recommend(cls.est, intent)))

    def test_documented_baseline(self):  # README and CLAUDE.md state these numbers
        self.assertEqual(sum(len(rec.evidence) for _, rec in self.runs), 1434)
        self.assertEqual(len({a for _, rec in self.runs for a in rec.retire}), 5)
        self.assertEqual(len({a for _, rec in self.runs for a in rec.consolidate}), 7)
        self.assertEqual(sum(rec.action != "new_build" for _, rec in self.runs), 79)

    def test_every_request_parses_to_products_and_kpis(self):
        for intent, _ in self.runs:
            self.assertTrue(intent.products, intent.text)
            self.assertTrue(intent.kpis, intent.text)

    def test_all_citations_exist_in_the_data(self):  # RULE-008
        for _, rec in self.runs:
            for table, key, _ in rec.evidence:
                self.assertTrue(self.est.exists(table, key), (table, key))

    def test_every_recommendation_is_explained_and_cited(self):
        for intent, rec in self.runs:
            self.assertTrue(rec.rationale, intent.request_id)
            self.assertTrue(rec.evidence, intent.request_id)

    def test_no_new_build_when_a_usable_asset_exists(self):  # RULE-001
        checked = 0
        for intent, rec in self.runs:
            if intent.kind != "new_report" or rec.action != "new_build":
                continue
            checked += 1
            for x in scoped_assessments(self.est, intent):
                self.assertFalse(x["repairable"], (intent.request_id, x["asset"]["asset_id"]))
                share = len(x["covered"]) / len(intent.kpis)
                self.assertFalse(x["alive"] and share >= 0.5, (intent.request_id, x["asset"]["asset_id"]))
        self.assertGreater(checked, 0)

    def test_targets_are_alive_power_bi_assets(self):  # do not repair or extend dead content
        for intent, rec in self.runs:
            if rec.action in ("reuse", "repair_and_reuse", "extend", "retire_and_reuse"):
                a = self.est.assets[rec.target]
                self.assertEqual(a["platform"], "Power BI")
                self.assertEqual(a["lifecycle_status"], "active")
                self.assertGreaterEqual(self.est.views(rec.target), LOW_VIEWS)

    def test_target_is_never_retired(self):
        for intent, rec in self.runs:
            self.assertNotIn(rec.target, rec.retire, intent.request_id)

    def test_migration_requests_follow_the_backlog(self):  # RULE-006
        for intent, rec in self.runs:
            if intent.kind == "migration" and rec.action == "migrate":
                path = self.est.backlog[rec.target]["recommended_path_candidate"]
                self.assertIn(path, {"MIGRATE", "REBUILD_ON_SHARED_MODEL", "CONSOLIDATE_BEFORE_MIGRATION"})


if __name__ == "__main__":
    unittest.main()
