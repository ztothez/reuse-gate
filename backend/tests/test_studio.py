"""Each role's own workspace: analyst dashboards over the data pack, the executive report, the operator wall, developer config
change requests reviewed by an approver, and email through n8n. All with role codes enforced."""
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from reuse_gate import explore, notify, server
from reuse_gate.jsonl import JsonlStore
from tests.test_access import CODES as BASE
from tests.test_workitems import DB, Api

CODES = {**BASE, "executive": "exe-code-123456", "operator": "ops-code-123456", "dev2": "dev-code-second1", "apr2": "apr-code-second1"}
ENV = ";".join([
    f"business:Maria Business:{CODES['business']}",
    f"analyst:Ana Analyst:{CODES['analyst']}",
    f"developer:Dev Developer:{CODES['developer']}",
    f"approver:Anna Approver:{CODES['approver']}",
    f"admin:Ada Admin:{CODES['admin']}",
    f"executive:Eve Executive:{CODES['executive']}",
    f"operator:Otto Operator:{CODES['operator']}",
])
ROLES = ("business", "analyst", "developer", "approver", "admin", "executive", "operator")
TILE = {"dataset": "sales", "dimension": "product", "measure": "net_sales"}


class ExploreTest(unittest.TestCase):
    def test_only_catalog_identifiers_reach_sql(self):
        for bad in ({"dataset": "sales; DROP TABLE x", "measure": "net_sales"}, {"dataset": "sales", "measure": "1) --"},
                    {"dataset": "sales", "measure": "net_sales", "dimension": "p.product_name"},
                    {**TILE, "filters": {"product": [{"x": 1}]}}, {**TILE, "split": "product"}):
            with self.subTest(bad=bad), self.assertRaises(explore.QueryError):
                explore.query(None, bad)

    def test_spec_kpis_become_tiles_the_pack_can_fill(self):
        tiles = explore.tiles_for_spec({"measures": [{"name": "Net Sales"}, {"name": "Forecast Variance"}, {"name": "Unknown KPI"}]})
        self.assertEqual([(t["measure"], t["dimension"]) for t in tiles],
                         [("net_sales", "month"), ("net_sales", "market"), ("forecast_variance", "month"), ("forecast_variance", "market")])


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class StudioTest(Api):
    @classmethod
    def setUpClass(cls):
        cls.env = patch.dict(os.environ, {"REUSE_GATE_ROLE_CODES": ENV})
        cls.env.start()
        cls.stores = patch.multiple(server, DASHBOARDS=JsonlStore(key="id"), CHANGES=JsonlStore(key="id"))
        cls.stores.start()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls.stores.stop()
        cls.env.stop()

    def test_each_role_opens_only_its_own_workspace(self):
        expected = {
            "/explore/catalog": {"analyst", "developer", "approver", "admin", "executive"},
            "/dashboards": {"analyst", "developer", "approver", "admin", "executive"},
            "/report": {"executive", "approver", "admin"},
            "/operations": {"operator", "approver", "admin"},
            "/config": {"developer", "approver", "admin"},
            "/notifications": {"admin"},
            "/requests": {"business", "analyst", "developer", "approver", "admin", "executive"},
        }
        for path, roles in expected.items():
            for role in ROLES:
                with self.subTest(path=path, role=role):
                    self.assertEqual(self.call(path, code=CODES[role])[0], 200 if role in roles else 403)

    def test_analyst_builds_a_dashboard_from_real_rows_and_shares_it(self):
        code, rows = self.call("/explore/query", {"tile": TILE}, CODES["analyst"])
        self.assertEqual(code, 200)
        self.assertEqual(rows["source"], "Product_Market_Monthly")
        self.assertEqual(len(rows["rows"]), 7, "one row per product in the pack")
        self.assertEqual(self.call("/explore/query", {"tile": {"dataset": "x", "measure": "y"}}, CODES["analyst"])[0], 400)
        code, preview = self.call("/explore/preview", {"request_id": "SAMPLE-01"}, CODES["analyst"])
        self.assertEqual(code, 200)
        self.assertTrue(preview["tiles"])
        self.assertEqual(self.call("/dashboards", {"title": "Mine", "tiles": [TILE]}, CODES["developer"])[0], 403)
        code, board = self.call("/dashboards", {"title": "Nubeqa sales", "tiles": preview["tiles"]}, CODES["analyst"])
        self.assertEqual((code, board["owner"]), (200, "Ana Analyst"))
        self.assertEqual(self.call(f"/dashboards/{board['id']}", code=CODES["executive"])[0], 404, "private until shared")
        self.call("/dashboards", {**board, "shared": True, "owner": "Someone Else"}, CODES["analyst"])
        code, shared = self.call(f"/dashboards/{board['id']}", code=CODES["executive"])
        self.assertEqual((code, shared["owner"]), (200, "Ana Analyst"), "the owner never comes from the body")
        self.assertEqual(self.call("/dashboards", {**board, "title": "Taken"}, CODES["admin"])[0], 200, "admin may edit")

    def test_executive_report_is_plain_language_with_sources(self):
        code, rep = self.call("/report", code=CODES["executive"])
        self.assertEqual(code, 200)
        self.assertIn("57", rep["headline"])
        self.assertTrue(all(s["source"] for s in rep["sections"]))
        self.assertIn("Recommended actions", rep["text"])

    def test_operator_wall_names_owners_and_shows_no_request_text(self):
        code, ops = self.call("/operations", code=CODES["operator"])
        self.assertEqual(code, 200)
        self.assertEqual(len(ops["failed_refresh"]), 14)
        self.assertNotIn("text", json.dumps(ops["queue"]))
        self.assertEqual(self.call("/requests/SAMPLE-01", code=CODES["operator"])[0], 403)

    def test_config_change_is_measured_and_needs_another_person(self):
        body = {"settings": {"low_views": 300}, "reason": "Unused should mean fewer than 300 views a quarter"}
        self.assertEqual(self.call("/config/changes", body, CODES["approver"])[0], 403, "approvers do not propose")
        self.assertEqual(self.call("/config/changes", {**body, "settings": {"low_views": 5}}, CODES["developer"])[0], 400)
        code, change = self.call("/config/changes", body, CODES["developer"])
        self.assertEqual(code, 200)
        self.assertEqual(change["impact"]["before"]["avoided"], 57, "the service's own decisions are unchanged")
        self.assertEqual(change["impact"]["after"]["avoided"], 51)
        self.assertEqual(change["impact"]["changed_count"], 7)
        self.assertEqual(server.EST and __import__("reuse_gate.recommend").recommend.LOW_VIEWS, 100, "nothing applied in process")
        decide = f"/config/changes/{change['id']}"
        self.assertEqual(self.call(decide, {"decision": "approve"}, CODES["developer"])[0], 403)
        with patch.object(server.CHANGES, "items", {**server.CHANGES.items, change["id"]: {**change, "proposed_by": "Anna Approver"}}):
            self.assertEqual(self.call(decide, {"decision": "approve"}, CODES["approver"])[0], 403, "nobody approves their own")
        code, done = self.call(decide, {"decision": "approve", "comment": "ok"}, CODES["approver"])
        self.assertEqual((code, done["status"], done["decided_by"]), (200, "approved", "Anna Approver"))
        self.assertEqual(done["patch"]["constants"], {"reuse_gate.recommend.LOW_VIEWS": 300})
        self.assertEqual(self.call(decide, {"decision": "reject"}, CODES["approver"])[0], 409)


class Capture(BaseHTTPRequestHandler):
    seen = []

    def do_POST(self):
        Capture.seen.append((dict(self.headers), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


class NotifyTest(unittest.TestCase):
    def test_posts_to_n8n_with_the_secret_and_records_the_outcome(self):
        hook = ThreadingHTTPServer(("127.0.0.1", 0), Capture)
        threading.Thread(target=hook.serve_forever, daemon=True).start()
        env = {"REUSE_GATE_NOTIFY_URL": f"http://127.0.0.1:{hook.server_port}/webhook", "N8N_WEBHOOK_SECRET": "s3cret-value",
               "REUSE_GATE_NOTIFY_EMAILS": "approver:a@example.com,b@example.com;business:m@example.com", "REUSE_GATE_UI_URL": "https://ui"}
        try:
            with patch.dict(os.environ, env), patch.object(notify, "OUTBOX", JsonlStore()):
                row = notify.send("test", "approver", "Hello", "Body", "/x", "Ada", wait=True)
                self.assertEqual((row["status"], row["to_count"]), ("sent", 2))
                headers, payload = Capture.seen[-1]
                self.assertEqual(headers["X-Webhook-Secret"], "s3cret-value")
                self.assertEqual(payload["to"], "a@example.com, b@example.com")
                self.assertIn("https://ui/x", payload["text"])
                self.assertEqual(notify.send("test", "operator", "x", "y", wait=True)["status"], "no_recipient")
                self.assertNotIn("s3cret", json.dumps(notify.status()))
            with patch.dict(os.environ, {"REUSE_GATE_NOTIFY_URL": ""}):
                self.assertEqual(notify.send("test", "approver", "x", "y")["status"], "not_configured")
        finally:
            hook.shutdown()
            hook.server_close()


class FakeModel:
    configured = True
    last_tier = "fake"

    def __init__(self, answer):
        self.answer = answer

    def json_chat(self, messages, **params):
        return {"answer": self.answer}


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class ChatTest(Api):
    @classmethod
    def setUpClass(cls):
        cls.env = patch.dict(os.environ, {"REUSE_GATE_ROLE_CODES": ENV})
        cls.env.start()
        cls.stores = patch.multiple(server, CHATS=JsonlStore(key="id"))
        cls.stores.start()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls.stores.stop()
        cls.env.stop()

    def test_agent_answers_from_the_request_and_the_guard_drops_invented_facts(self):
        code, msgs = self.call("/requests/SAMPLE-07/chat", {"message": "Which gates block release?"}, CODES["analyst"])
        self.assertEqual(code, 200)
        self.assertEqual([m["role"] for m in msgs], ["analyst", "agent"])
        self.assertEqual(msgs[0]["author"], "Ana Analyst")
        self.assertIn("owner and review date", msgs[1]["text"])
        with patch.object(server, "LLM_CLIENT", FakeModel("It reuses AST-9999 with 4242 views.")):
            _, msgs = self.call("/requests/SAMPLE-07/chat", {"message": "Why?"}, CODES["analyst"])
        self.assertEqual(msgs[1]["source"], "rules_guard", "an invented ID never reaches the thread")
        self.assertNotIn("AST-9999", msgs[1]["text"])
        with patch.object(server, "LLM_CLIENT", FakeModel("A person should review the owner first.")):
            _, msgs = self.call("/requests/SAMPLE-07/chat", {"message": "What next?"}, CODES["developer"])
        self.assertEqual((msgs[1]["source"], msgs[1]["tier"]), ("llm", "fake"))
        code, thread = self.call("/requests/SAMPLE-07/chat", code=CODES["approver"])
        self.assertEqual((code, len(thread)), (200, 6))
        self.assertEqual(thread[0]["text"], "Which gates block release?", "oldest first")

    def test_only_people_who_see_the_request_can_chat(self):
        self.assertEqual(self.call("/requests/SAMPLE-07/chat", code=CODES["operator"])[0], 403)
        self.assertEqual(self.call("/requests/SAMPLE-07/chat", code=CODES["business"])[0], 404, "not their request")
        self.assertEqual(self.call("/requests/SAMPLE-07/chat", {"message": " "}, CODES["analyst"])[0], 400)
        self.assertEqual(self.call("/requests/SAMPLE-07/chat", {"message": "hi"})[0], 401)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class JudgeTest(Api):
    JUDGE = "jdg-code-123456"

    @classmethod
    def setUpClass(cls):
        cls.env = patch.dict(os.environ, {"REUSE_GATE_ROLE_CODES": f"{ENV};judge:Judge:{cls.JUDGE}"})
        cls.env.start()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls.env.stop()

    def as_view(self, path, view):
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}{path}",
                                     headers={"X-Access-Code": self.JUDGE, "X-View-Role": view})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    def test_judge_views_as_any_role_and_gets_exactly_that_roles_rights(self):
        code, me = self.as_view("/me", "operator")
        self.assertEqual((code, me["role"], me["name"]), (200, "operator", "Judge"))
        self.assertEqual(set(me["views"]), set(ROLES))
        self.assertEqual(self.as_view("/operations", "operator")[0], 200)
        self.assertEqual(self.as_view("/requests", "operator")[0], 403, "the operator view stays an operator view")
        self.assertEqual(self.as_view("/notifications", "admin")[0], 200)
        self.assertEqual(self.as_view("/me", "superuser")[1]["role"], "admin", "an unknown view falls back to admin")
        code, rows = self.as_view("/requests", "business")
        self.assertEqual(code, 200)
        self.assertTrue(rows and all(r["origin"] == "sample" for r in rows), "business view: the marked samples")
        self.assertEqual(self.call("/me", code=CODES["analyst"])[1]["views"], ["analyst"], "X-View-Role means nothing to other codes")
