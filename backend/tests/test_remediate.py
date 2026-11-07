import hashlib
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from reuse_gate import server
from reuse_gate.estate import Estate
from reuse_gate.export_mock import radar
from reuse_gate.llm import NoLLM
from reuse_gate.remediate import RemediationError, decision_record, ownership_bottlenecks, simulate, snapshot_id
from reuse_gate.spec_gate import batch

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data/estate.db"
FIX = {"type": "assign_owner", "target": "SM-065", "owner_id": "OWN-039"}


def finance(est):
    return next(r["request_id"] for r in est.requests if r["request_text"].startswith("Can we have a new finance"))


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class RemediateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def test_assigning_an_active_owner_to_sm065_clears_the_owner_gates(self):
        out = simulate(self.est, {"request_id": finance(self.est), "remediations": [FIX]})
        self.assertEqual(out["applied"], "simulated")
        self.assertEqual((out["passed_before"], out["passed_after"]), (False, True))
        self.assertEqual(out["fixed"], ["evidence_cited", "owner_and_review_date"])
        self.assertEqual(out["still_failing"], [])
        self.assertEqual({d["gate"] for d in out["diff"]}, {"evidence_cited", "owner_and_review_date"})
        self.assertEqual((out["before"]["owner"], out["after"]["owner"]), (None, "Laura Fischer"))
        change = out["remediations"][0]
        self.assertEqual((change["from_owner_id"], change["from_status"], change["target_table"]), ("OWN-037", "inactive", "Semantic_Models"))
        for c in change["citations"]:
            self.assertTrue(self.est.exists(*c.split(":", 1)), c)
        self.assertTrue(out["estate_snapshot"].startswith("sha256:"))

    def test_the_part_a_numbers(self):
        """All 80 SM-065 specs fail only on the owner gates, and one active owner makes all 80 pass."""
        blocked = [r for r in batch(self.est) if r["spec"] and r["model"] == "SM-065" and not r["passed"]]
        self.assertEqual(len(blocked), 80)
        self.assertTrue(all({g["gate"] for g in r["failed"]} == {"owner_and_review_date", "evidence_cited"} for r in blocked))
        passed = sum(simulate(self.est, {"request_id": r["id"], "remediations": [FIX]})["passed_after"] for r in blocked)
        self.assertEqual(passed, 80)

    def test_gates_an_owner_cannot_fix_stay_failing(self):
        out = simulate(self.est, {"request_id": "REQ-0004", "remediations": [{"type": "assign_owner", "target": "SM-034", "owner_id": "OWN-039"}]})
        self.assertIn("certified_healthy_model", out["still_failing"])
        self.assertFalse(out["passed_after"])
        self.assertNotIn("certified_healthy_model", out["fixed"])

    def test_a_decision_with_no_spec_reports_no_gates(self):
        out = simulate(self.est, {"request_id": "REQ-0002", "remediations": [FIX]})
        self.assertEqual((out["decision"]["action"], out["before"]["gates"]["passed"], out["diff"]), ("human_review", None, []))

    def test_an_intent_works_as_the_reference(self):
        intent = {"products": ["All Pharma"], "market": "MX", "kpis": ["Net Sales", "Budget Variance", "Gross-to-Net Rate"], "kind": "new_report"}
        out = simulate(self.est, {"intent": intent, "remediations": [FIX], "as_of": "2026-11-07"})
        self.assertEqual((out["passed_before"], out["passed_after"]), (False, True))

    def test_everything_outside_the_allow_list_is_refused(self):
        rid = finance(self.est)
        inactive = next(i for i, o in self.est.owners.items() if o["status"] != "active")
        bad = [
            None, [], "x", [FIX] * 11,
            [{"type": "certify", "target": "SM-065"}],
            [{"type": "assign_owner", "target": "SM-065", "owner_id": inactive}],
            [{"type": "assign_owner", "target": "SM-065", "owner_id": "OWN-999"}],
            [{"type": "assign_owner", "target": "AST-9999", "owner_id": "OWN-039"}],
            [{**FIX, "endorsement": "certified"}],
            [FIX, {"type": "assign_owner", "target": "SM-065", "owner_id": inactive}],
            ["assign_owner"],
        ]
        for remediations in bad:
            with self.subTest(str(remediations)[:60]):
                with self.assertRaises(RemediationError):
                    simulate(self.est, {"request_id": rid, "remediations": remediations})
        with self.assertRaises(RemediationError):
            simulate(self.est, {"request_id": "REQ-NOPE", "remediations": [FIX]})
        with self.assertRaises(RemediationError):
            simulate(self.est, {"intent": {"products": ["Fake"], "market": "DE", "kpis": ["Net Sales"]}, "remediations": [FIX]})

    def test_nothing_is_written(self):
        db_before = hashlib.sha256(DB.read_bytes()).hexdigest()
        owner_before = self.est.models["SM-065"]["owner_id"]
        for _ in range(3):
            simulate(self.est, {"request_id": finance(self.est), "remediations": [FIX]})
        self.assertEqual(self.est.models["SM-065"]["owner_id"], owner_before)
        self.assertEqual(hashlib.sha256(DB.read_bytes()).hexdigest(), db_before)
        self.assertEqual(snapshot_id(self.est), "sha256:" + db_before)
        again = simulate(self.est, {"request_id": finance(self.est), "remediations": [FIX]})
        self.assertFalse(again["passed_before"], "an earlier simulation left nothing behind")


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class RecordTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def test_record_is_rebuilt_from_the_data_not_copied_from_the_client(self):
        rounds = [{"round": 1, "questions": [], "answers": [{"field": "market", "question": "q", "answer": "Mexico"}]}]
        body = {"request_id": finance(self.est), "decision": "approve", "approver": "A", "owner": "Laura Fischer", "review_by": "2027-11-01",
                "text": "finance", "action": "reuse", "target": "AST-0001", "rounds": rounds, "remediations": [FIX]}
        rec = decision_record(self.est, body)
        self.assertEqual(rec["recommendation"]["action"], "new_build")
        self.assertFalse(rec["recommendation"]["matches_client"])
        self.assertGreater(rec["recommendation"]["citations"], 0)
        self.assertTrue(rec["gates"]["at_approval"]["passed"], "the approver named an active owner")
        self.assertFalse(rec["gates"]["before_remediation"]["passed"], "the original blocker is kept")
        self.assertEqual(rec["remediation"]["applied"], "simulated")
        self.assertEqual(rec["rounds"], rounds)
        self.assertEqual((rec["approver"], rec["owner"], rec["review_by"]), ("A", "Laura Fischer", "2027-11-01"))
        self.assertEqual(rec["estate_snapshot"], snapshot_id(self.est))

    def test_sm065_record_keeps_the_original_blocker_and_the_approval_result(self):
        body = {"request_id": finance(self.est), "decision": "approve", "approver": "A", "owner": "Laura Fischer", "review_by": "2027-11-01",
                "remediations": [FIX]}
        gates = decision_record(self.est, body)["gates"]
        self.assertEqual(list(gates), ["before_remediation", "at_approval"])
        before, after = gates["before_remediation"], gates["at_approval"]
        self.assertEqual((before["owner"], before["passing"], before["total"], before["passed"]), (None, 5, 7, False))
        self.assertEqual(sorted(before["failing"]), ["evidence_cited", "owner_and_review_date"])
        self.assertEqual((after["owner"], after["passing"], after["total"], after["passed"], after["failing"]), ("Laura Fischer", 7, 7, True, []))
        self.assertEqual(before["as_of"], after["as_of"])

    def test_without_a_remediation_only_the_approval_result_is_stored(self):
        body = {"request_id": finance(self.est), "decision": "approve", "approver": "A", "owner": "Laura Fischer", "review_by": "2027-11-01"}
        gates = decision_record(self.est, body)["gates"]
        self.assertEqual(list(gates), ["at_approval"])
        self.assertEqual(gates["at_approval"]["passing"], 7)
        no_spec = decision_record(self.est, {"request_id": "REQ-0002", "decision": "approve", "approver": "A", "owner": "B"})["gates"]["at_approval"]
        self.assertEqual((no_spec["passed"], no_spec["total"]), (None, 0))
        self.assertIn("reason", no_spec)

    def test_a_bare_old_style_body_still_records(self):
        rec = decision_record(self.est, {"request_id": "ADHOC-1", "decision": "approve", "approver": "a", "owner": "b"})
        self.assertIsNone(rec["intent"])
        self.assertIn("no intent to check", rec["note"])
        self.assertTrue(rec["estate_snapshot"].startswith("sha256:"))

    def test_rejected_remediation_is_recorded_not_applied(self):
        rec = decision_record(self.est, {"request_id": finance(self.est), "remediations": [{"type": "certify"}]})
        self.assertIn("rejected", rec["remediation"])


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class BottleneckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))
        cls.rows = ownership_bottlenecks(cls.est)

    def test_oliver_schmidt_blocks_the_80_specs(self):
        top = self.rows[0]
        self.assertEqual((top["owner_id"], top["specs_blocked"], top["semantic_models"]), ("OWN-037", 80, ["SM-065"]))
        self.assertEqual(sum(r["specs_blocked"] for r in self.rows), 80, "the quality report's owner gate failures")

    def test_only_real_inactive_owners_ranked_and_cited(self):
        keys = [(-r["specs_blocked"], -r["assets_owned"], r["owner_id"]) for r in self.rows]
        self.assertEqual(keys, sorted(keys))
        for r in self.rows:
            self.assertEqual(self.est.owners[r["owner_id"]]["status"], "inactive")
            self.assertTrue(r["specs_blocked"] or r["assets_owned"] or r["semantic_models"])
            for c in r["citations"]:
                self.assertTrue(self.est.exists(*c.split(":", 1)), c)
            self.assertEqual(r["assets_owned"], sum(a["owner_id"] == r["owner_id"] for a in self.est.assets.values()))

    def test_radar_carries_it_and_keeps_its_other_fields(self):
        out = radar(self.est)
        self.assertEqual(out["ownership_bottlenecks"], self.rows)
        mock = json.loads((ROOT / "data/mock_api.json").read_text(encoding="utf-8"))["radar"]
        self.assertEqual(json.loads(json.dumps(out)), mock)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.patcher = patch.multiple(server, EST=Estate(str(DB)), LLM_CLIENT=NoLLM(), LOG=[], LOG_FILE=str(Path(cls.tmp.name) / "log.jsonl"))
        cls.patcher.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patcher.stop()
        cls.tmp.cleanup()

    def call(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}{path}", data=data, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    def test_remediate_over_http(self):
        code, out = self.call("/remediate", {"request_id": finance(server.EST), "remediations": [FIX]})
        self.assertEqual((code, out["applied"], out["passed_after"]), (200, "simulated", True))
        code, out = self.call("/remediate", {"request_id": finance(server.EST), "remediations": [{"type": "assign_owner", "target": "SM-065", "owner_id": "OWN-037"}]})
        self.assertEqual((code, out["applied"]), (400, "nothing"))
        self.assertIn("not active", out["error"])

    def test_approve_stores_the_record_and_old_entries_still_read(self):
        server.LOG.append({"request_id": "OLD", "decision": "approve", "approver": "x", "owner": "y", "registered_id": "REG-OLD", "time": "2026-11-06T00:00:00+00:00"})
        flat = {"request_id": "OLD2", "decision": "approve", "approver": "x", "owner": "y", "registered_id": "REG-OLD2", "time": "2026-11-07T00:00:00+00:00",
                "record": {"gates": {"as_of": "2026-11-07", "passed": True, "gates": []}}}  # the record shape before before/at_approval
        server.LOG.append(flat)
        old_style = {"request_id": "ADHOC-1", "decision": "reject", "approver": "a", "owner": "b"}
        self.assertEqual(self.call("/approve", old_style)[0], 200)
        rich = {"request_id": finance(server.EST), "decision": "approve", "approver": "A", "owner": "Laura Fischer", "review_by": "2027-11-01",
                "rounds": [{"round": 1, "answers": []}], "remediations": [FIX]}
        code, ok = self.call("/approve", rich)
        self.assertEqual(code, 200)
        _, log = self.call("/log")
        self.assertEqual(log[0]["registered_id"], "REG-OLD")
        self.assertNotIn("record", log[0])
        self.assertEqual(log[1], flat, "an entry in the earlier record shape reads back unchanged")
        self.assertEqual({k: log[2][k] for k in old_style}, old_style)
        entry = next(e for e in log if e["registered_id"] == ok["registered_id"])
        record = entry["record"]
        self.assertEqual(record["recommendation"]["action"], "new_build")
        self.assertTrue(record["gates"]["at_approval"]["passed"])
        self.assertEqual(record["remediation"]["passed_after"], True)
        self.assertEqual(record["remediation"]["applied"], "simulated", "the full /remediate response is kept")
        self.assertEqual((record["gates"]["before_remediation"]["passing"], record["gates"]["at_approval"]["passing"]), (5, 7))
        self.assertEqual(record["rounds"], [{"round": 1, "answers": []}])
        stored = [json.loads(line) for line in Path(server.LOG_FILE).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(stored[-1]["record"]["estate_snapshot"], record["estate_snapshot"])

    def test_radar_over_http_has_the_bottleneck(self):
        code, out = self.call("/radar")
        self.assertEqual((code, out["ownership_bottlenecks"][0]["owner_id"]), (200, "OWN-037"))


if __name__ == "__main__":
    unittest.main()
