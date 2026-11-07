"""Start from a spec that passes every gate, break one thing, confirm the right gate fails."""
import copy
import unittest
from pathlib import Path

from reuse_gate import spec_gate
from reuse_gate.estate import Estate
from reuse_gate.pipeline import rec_json
from reuse_gate.recommend import parse_request, recommend
from reuse_gate.spec import build_spec
from reuse_gate.spec_gate import batch, canonical_only, check, report

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "estate.db"


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class SpecGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = est = Estate(str(DB))
        cls.as_of = "2026-11-06"
        cls.good = None
        for req in est.requests:
            intent = parse_request(est, req)
            out = rec_json(est, intent, recommend(est, intent))
            if out["recommendation"]["action"] not in ("new_build", "extend") or not out["recommendation"]["build_on"]:
                continue
            spec = build_spec(out["intent"], out["recommendation"], est, as_of=cls.as_of)
            if check(est, spec, cls.as_of)["passed"] and spec["source_action"] == "extend":
                cls.good = spec
                break
        if cls.good is None:
            for req in est.requests:
                intent = parse_request(est, req)
                out = rec_json(est, intent, recommend(est, intent))
                if out["recommendation"]["action"] == "new_build":
                    spec = build_spec(out["intent"], out["recommendation"], est, as_of=cls.as_of)
                    if check(est, spec, cls.as_of)["passed"]:
                        cls.good = spec
                        break
        assert cls.good, "no spec passes every gate, so the break tests prove nothing"

    def failed(self, spec):
        return {g["gate"] for g in check(self.est, spec, self.as_of)["gates"] if not g["passed"]}

    def broken(self, **changes):
        spec = copy.deepcopy(self.good)
        spec.update(changes)
        return spec

    def test_baseline_spec_passes_everything(self):
        self.assertEqual(self.failed(self.good), set())

    def test_non_canonical_kpi_name(self):
        self.assertIn("canonical_kpis", self.failed(self.broken(kpis=["Net Sales Local"])))

    def test_no_kpis(self):
        self.assertIn("canonical_kpis", self.failed(self.broken(kpis=[])))

    def test_measure_uses_a_conflicting_definition(self):
        measures = [{"kpi_id": "KPI-002", "name": "Net Sales", "source": "KPI_Catalog"}]
        self.assertEqual(self.failed(self.broken(measures=measures)), {"canonical_kpis"})

    def test_uncertified_model(self):
        model = next(m["model_id"] for m in self.est.models.values() if m["endorsement"] != "certified" and m["refresh_status"] == "healthy")
        self.assertIn("certified_healthy_model", self.failed(self.broken(semantic_model=model)))

    def test_unhealthy_model(self):
        model = next(m["model_id"] for m in self.est.models.values() if m["endorsement"] == "certified" and m["refresh_status"] == "failed")
        self.assertIn("certified_healthy_model", self.failed(self.broken(semantic_model=model)))

    def test_model_that_does_not_exist(self):
        self.assertIn("certified_healthy_model", self.failed(self.broken(semantic_model="SM-999")))

    def test_owner_missing(self):
        self.assertIn("owner_and_review_date", self.failed(self.broken(owner=None)))

    def test_inactive_owner(self):
        inactive = next(o["owner_id"] for o in self.est.owners.values() if o["status"] == "inactive")
        self.assertIn("owner_and_review_date", self.failed(self.broken(owner=inactive)))

    def test_owner_who_is_not_in_the_table(self):
        self.assertIn("owner_and_review_date", self.failed(self.broken(owner="Someone Made Up")))

    def test_review_date_missing_past_or_garbage(self):
        for value in (None, "2020-01-01", "soon"):
            with self.subTest(value=value):
                self.assertEqual(self.failed(self.broken(review_date=value)), {"owner_and_review_date"})

    def test_measure_outside_the_catalog(self):
        measures = self.good["measures"] + [{"kpi_id": "KPI-999", "name": "Secret Margin", "source": "spreadsheet"}]
        self.assertEqual(self.failed(self.broken(measures=measures)), {"measures_in_catalog"})

    def test_measure_with_no_measures(self):
        self.assertEqual(self.failed(self.broken(measures=[])), {"measures_in_catalog"})

    def test_duplicate_of_an_alive_asset(self):
        for x in self.est.assets.values():
            if self.est.views(x["asset_id"]) >= 100 and x["lifecycle_status"] == "active" and x["platform"] == "Power BI":
                self.assertIn("no_alive_duplicate", self.failed(self.broken(title=x["asset_name"], target=None, source_action="new_build")))
                return
        self.fail("no alive asset in the data")

    def test_extend_target_that_does_not_exist(self):
        self.assertIn("valid_extend_target", self.failed(self.broken(source_action="extend", target="AST-9999")))

    def test_extend_target_that_is_dead(self):
        self.assertIn("valid_extend_target", self.failed(self.broken(source_action="extend", target="AST-0002")))

    def test_field_with_no_citation(self):
        evidence = {**self.good["evidence"], "semantic_model": []}
        self.assertEqual(self.failed(self.broken(evidence=evidence)), {"evidence_cited"})

    def test_citation_of_a_row_that_does_not_exist(self):
        evidence = {**self.good["evidence"], "kpis": [{"table": "KPI_Catalog", "id": "KPI-999", "note": "fake"}]}
        self.assertEqual(self.failed(self.broken(evidence=evidence)), {"evidence_cited"})

    def test_canonical_only_comparison_does_not_change_the_rule(self):
        before = (dict(self.est.kpi_roles), batch(self.est))
        strict = canonical_only(self.est)
        batch(strict)
        self.assertEqual((self.est.kpi_roles, batch(self.est)), before)
        self.assertTrue(any(role == "primary" and self.est.kpis[key[1]]["definition_status"] != "canonical" for key, role in self.est.kpi_roles.items()))
        self.assertFalse(any(role == "primary" and self.est.kpis[key[1]]["definition_status"] != "canonical" for key, role in strict.kpi_roles.items()))
        self.assertIn("the rule has not changed", report(self.est, batch(self.est)))

    def test_estate_impact_adds_up_and_the_committed_figure_is_current(self):
        impact = spec_gate.estate_impact(self.est)
        self.assertEqual(impact["today"], len(self.est.assets))
        self.assertEqual(impact["builds"] + impact["avoided"], impact["requests"])
        self.assertEqual(impact["without"], impact["today"] + impact["requests"])
        self.assertEqual(impact["with"], impact["today"] + impact["builds"] - impact["retired"])
        self.assertEqual((impact["requests"], impact["avoided"], impact["retired"], impact["consolidate"]), (150, 57, 2, 2), "the baseline in CLAUDE.md")
        self.assertLessEqual(impact["distinct_builds"], impact["builds"])
        self.assertLessEqual(impact["ownerless_after"], impact["ownerless"])
        svg = spec_gate.impact_svg(impact)
        if not (ROOT / "docs/estate_impact.svg").exists():
            self.skipTest("docs/ is not in the container image; the figures above were checked")
        self.assertEqual(svg, (ROOT / "docs/estate_impact.svg").read_text(encoding="utf-8"))
        written = (ROOT / "docs/quality_report.md").read_text(encoding="utf-8")
        self.assertIn(f"| Assets in the estate | {impact['today']} | {impact['without']} | {impact['with']} |", written)
        self.assertIn("(estate_impact.svg)", written)

    def test_batch_covers_all_requests_and_reruns_identically(self):
        first, second = batch(self.est), batch(self.est)
        self.assertEqual(len(first), len(self.est.requests))
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
