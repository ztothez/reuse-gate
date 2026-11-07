"""Least privilege: with role codes configured, every endpoint checks the caller's role and returns only that role's data."""
import os
import unittest
from io import StringIO
from contextlib import redirect_stderr
from unittest.mock import patch

from reuse_gate import access
from tests.test_workitems import DB, FIX, ONCOLOGY, Api

CODES = {
    "business": "biz-code-123456",
    "other": "biz-code-other99",
    "analyst": "ana-code-123456",
    "developer": "dev-code-123456",
    "approver": "apr-code-123456",
    "admin": "adm-code-123456",
}
ENV = ";".join([
    f"business:Maria Business:{CODES['business']}",
    f"business:Olli Other:{CODES['other']}",
    f"analyst:Ana Analyst:{CODES['analyst']}",
    f"developer:Dev Developer:{CODES['developer']}",
    f"approver:Anna Approver:{CODES['approver']}",
    f"admin:Ada Admin:{CODES['admin']}",
])
TEXT = "Create a Nubeqa net sales dashboard for Germany."


class ParseTest(unittest.TestCase):
    def test_entries_and_skipped_entries(self):
        with redirect_stderr(StringIO()) as err:
            entries = access.parse("business:Maria:long-enough-code;nobody:X:long-enough-code;admin:Ada:zq7x;analyst:a:b:c:long-code-1")
        self.assertEqual(entries, [("business", "Maria", "long-enough-code"), ("analyst", "a", "b:c:long-code-1")])
        self.assertIn("entry 2 skipped", err.getvalue())
        self.assertNotIn("zq7x", err.getvalue(), "a skipped code is never printed")

    def test_open_without_codes(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(access.principal({}), access.OPEN)
            self.assertFalse(access.enforced())


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class RoleCodeTest(Api):
    @classmethod
    def setUpClass(cls):
        cls.env = patch.dict(os.environ, {"REUSE_GATE_ROLE_CODES": ENV})
        cls.env.start()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls.env.stop()

    def test_no_or_wrong_code_gets_401_and_me_names_the_caller(self):
        for code in (None, "", "wrong-code-123456", CODES["admin"] + " "):
            with self.subTest(code=code):
                for path in ("/requests", "/me", "/evaluation", "/radar", "/log"):
                    self.assertEqual(self.call(path, code=code)[0], 401, path)
                self.assertEqual(self.call("/requests", {"text": TEXT}, code)[0], 401)
        self.assertEqual(self.call("/me", code=CODES["approver"]), (200, {"role": "approver", "name": "Anna Approver", "enforced": True, "views": ["approver"]}))
        self.assertEqual(self.call("/healthz")[0], 200, "probes need no code")

    def test_permission_matrix(self):
        expected = {  # path: roles that get 200
            "/radar": {"analyst", "approver", "admin"},
            "/owners": {"approver", "admin"},
            "/log": {"approver", "admin"},
            "/evaluation": {"business", "analyst", "developer", "approver", "admin"},
            "/requests": {"business", "analyst", "developer", "approver", "admin"},
        }
        for path, roles in expected.items():
            for role in ("business", "analyst", "developer", "approver", "admin"):
                with self.subTest(path=path, role=role):
                    self.assertEqual(self.call(path, code=CODES[role])[0], 200 if role in roles else 403)

    def test_business_sees_only_its_own_requests_and_is_the_requester(self):
        code, made = self.call("/requests", {"text": TEXT, "requester": "Someone Else"}, CODES["business"])
        self.assertEqual(code, 200)
        rid = made["request_id"]
        _, mine = self.call(f"/requests/{rid}", code=CODES["business"])
        self.assertEqual(mine["requester"], "Maria Business", "the requester is the signed-in name, not the body")
        _, rows = self.call("/requests", code=CODES["business"])
        self.assertEqual({r["request_id"] for r in rows}, {rid}, "no samples, no other people's items")
        self.assertEqual(self.call(f"/requests/{rid}", code=CODES["other"])[0], 404, "another person's item looks missing")
        self.assertEqual(self.call("/requests", {"request_id": rid, "answers": []}, CODES["other"])[0], 404)
        self.assertNotIn(rid, {r["request_id"] for r in self.call("/requests", code=CODES["other"])[1]})
        self.assertIn(rid, {r["request_id"] for r in self.call("/requests", code=CODES["analyst"])[1]})

    def test_only_deciders_write_and_the_record_names_the_signed_in_approver(self):
        _, made = self.call("/requests", {"text": ONCOLOGY}, CODES["business"])
        rid = made["request_id"]
        q = made["result"]["intent"]["questions"][0]
        self.call("/requests", {"request_id": rid, "answers": [{"field": q["field"], "question": q["text"], "answer": "yes"}]}, CODES["business"])
        for role in ("analyst", "developer", "business"):
            with self.subTest(role=role):
                self.assertEqual(self.call("/remediate", {"request_id": rid, "remediations": [FIX]}, CODES[role])[0], 403)
                self.assertEqual(self.call("/approve", {"request_id": rid, "decision": "approve", "approver": "x", "owner": "B"}, CODES[role])[0], 403)
        self.assertEqual(self.call("/requests", {"text": TEXT}, CODES["analyst"])[0], 403, "analysts read, they do not file requests")
        self.assertEqual(self.call("/spec", {}, CODES["business"])[0], 403)
        self.assertEqual(self.call("/remediate", {"request_id": rid, "remediations": [FIX], "actor": "Fake"}, CODES["approver"])[0], 200)
        code, ok = self.call("/approve", {"request_id": rid, "decision": "approve", "approver": "Fake Name", "owner": "Laura Fischer",
                                          "review_by": "2027-11-01"}, CODES["approver"])
        self.assertEqual(code, 200)
        _, log = self.call("/log", code=CODES["admin"])
        entry = next(e for e in log if e["registered_id"] == ok["registered_id"])
        self.assertEqual(entry["approver"], "Anna Approver")
        _, as_admin = self.call(f"/requests/{rid}", code=CODES["admin"])
        self.assertEqual(as_admin["decision"]["approver"], "Anna Approver")
        self.assertEqual(next(a for a in as_admin["activity"] if a["event"] == "remediation_simulated")["actor"], "Anna Approver")
        for role in ("business", "analyst", "developer"):
            _, seen = self.call(f"/requests/{rid}", code=CODES[role])
            with self.subTest(role=role):
                self.assertEqual(seen["decision"]["approver"], "An approver", "approver names stay with the deciders")
                self.assertNotIn("Anna Approver", str(seen["activity"]))
