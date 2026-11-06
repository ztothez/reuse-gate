import hashlib
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
from estate import Estate
from llm import NoLLM

DB = Path(__file__).parent / "estate.db"


class N8nIntegrationTest(unittest.TestCase):
    def test_digest_requires_key(self):
        with patch.object(server, "N8N_API_KEY", "expected"):
            handler = type("Handler", (), {"headers": {"X-N8N-API-Key": "wrong"}})()
            self.assertFalse(server.n8n_authorized(handler))

    def test_digest_shape(self):
        class FakeEstate:
            assets = {"a": 1}

        with patch.object(server, "EST", FakeEstate()), patch.object(
            server, "radar", return_value={"totals": {"dead_or_unused": 2, "ownerless": 1, "high_reach_uncertified": 3},
                                            "dead_assets": [], "ownerless_assets": [], "high_reach_uncertified": []}
        ):
            digest = server.radar_digest()
        self.assertEqual(digest["totals"]["dead_or_unused"], 2)
        self.assertIn("retire or review", digest["summary"])

    def test_workflow_files_are_wired_and_hold_no_secrets(self):
        for path in Path(__file__).parent.glob("n8n/*_workflow.json"):
            with self.subTest(path.name):
                flow = json.loads(path.read_text(encoding="utf-8"))
                names = {n["name"] for n in flow["nodes"]}
                self.assertFalse(flow["active"], "imported workflows start inactive")
                for source, outputs in flow["connections"].items():
                    self.assertIn(source, names)
                    for link in outputs["main"][0]:
                        self.assertIn(link["node"], names)
                for node in flow["nodes"]:
                    params = json.dumps(node["parameters"])
                    self.assertNotIn("X-N8N-API-Key", params, "keys belong in n8n credentials")
                    for cred in node.get("credentials", {}).values():
                        self.assertEqual(set(cred), {"id", "name"})


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class RadarPingTest(unittest.TestCase):
    KEY = "expected-key"

    @classmethod
    def setUpClass(cls):
        cls.patcher = patch.multiple(server, EST=Estate(str(DB)), N8N_API_KEY=cls.KEY, LLM_CLIENT=NoLLM())
        cls.patcher.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patcher.stop()

    def call(self, path, data=None, headers=None, method=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}{path}", data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    @staticmethod
    def stable(digest):
        return {k: v for k, v in digest.items() if k != "generated_at"}

    def test_returns_exactly_the_key_protected_digest_with_no_key(self):
        code, ping = self.call("/radar-ping", b"{}", method="POST")
        self.assertEqual(code, 200)
        code, digest = self.call("/n8n/radar-digest", headers={"X-N8N-API-Key": self.KEY})
        self.assertEqual(code, 200)
        self.assertEqual(set(ping), set(digest))
        self.assertEqual(self.stable(ping), self.stable(digest))

    def test_exposes_only_what_public_radar_already_exposes(self):
        _, radar = self.call("/radar")
        _, ping = self.call("/radar-ping", b"", method="POST")
        self.assertEqual(ping["totals"], radar["totals"])
        self.assertEqual(ping["retire_or_review"], radar["dead_assets"])
        self.assertEqual(ping["ownerless"], radar["ownerless_assets"])
        self.assertEqual(ping["high_reach_uncertified"], radar["high_reach_uncertified"])
        self.assertEqual(set(ping), {"subject", "generated_at", "summary", "totals", "retire_or_review", "ownerless", "high_reach_uncertified"})

    def test_ignores_the_body(self):
        cloud_event = {"Content-Type": "application/json", "ce-type": "dev.knative.sources.ping", "ce-source": "x", "ce-id": "1", "ce-specversion": "1.0"}
        bodies = [b"", b"{}", b'{"message": "radar"}', b"not json", b"[1, 2]", b'{"request_id": "X", "decision": "approve"}', b"x" * 200_000]
        _, expected = self.call("/radar-ping", b"", method="POST")
        for body in bodies:
            with self.subTest(body=body[:20]):
                code, ping = self.call("/radar-ping", body, headers=cloud_event, method="POST")
                self.assertEqual(code, 200)
                self.assertEqual(self.stable(ping), self.stable(expected))

    def test_changes_no_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "decisions.jsonl"
            log.write_text("existing\n", encoding="utf-8")
            db_before, log_entries = hashlib.sha256(DB.read_bytes()).hexdigest(), list(server.LOG)
            con = sqlite3.connect(str(DB))
            changes_before = con.total_changes
            with patch.object(server, "LOG_FILE", str(log)):
                for body in (b"{}", b'{"request_id": "X", "decision": "approve", "approver": "a", "owner": "b"}'):
                    self.assertEqual(self.call("/radar-ping", body, method="POST")[0], 200)
            self.assertEqual(log.read_text(encoding="utf-8"), "existing\n")
            self.assertEqual(server.LOG, log_entries)
            self.assertEqual(hashlib.sha256(DB.read_bytes()).hexdigest(), db_before)
            self.assertEqual(server.EST.con.in_transaction, False)
            self.assertEqual(con.total_changes, changes_before)
            con.close()

    def test_is_post_only(self):
        self.assertEqual(self.call("/radar-ping")[0], 404)

    def test_key_protected_digest_still_needs_the_key(self):
        self.assertEqual(self.call("/n8n/radar-digest")[0], 401)
        self.assertEqual(self.call("/n8n/radar-digest", headers={"X-N8N-API-Key": "wrong"})[0], 401)
        self.assertEqual(self.call("/n8n/radar-digest", headers={"X-N8N-API-Key": self.KEY})[0], 200)

    def test_with_no_key_configured_the_protected_route_stays_closed_and_ping_works(self):
        with patch.object(server, "N8N_API_KEY", ""):
            self.assertEqual(self.call("/n8n/radar-digest")[0], 401)
            self.assertEqual(self.call("/radar-ping", b"{}", method="POST")[0], 200)

    def test_approval_webhook_still_needs_the_key(self):
        self.assertEqual(self.call("/n8n/approval", b"{}", method="POST")[0], 401)


if __name__ == "__main__":
    unittest.main()
