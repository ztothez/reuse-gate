import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.request
from contextlib import redirect_stdout
from http.server import ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from reuse_gate import export_mock, server
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM
from reuse_gate.remediate import active_owners, ownership_bottlenecks

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data/estate.db"
spec = importlib.util.spec_from_file_location("warmup", ROOT / "scripts/warmup.py")
warmup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(warmup)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class OwnersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))
        cls.patcher = patch.multiple(server, EST=cls.est, LLM_CLIENT=NoLLM())
        cls.patcher.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patcher.stop()

    def get(self, path):
        with urllib.request.urlopen(self.url + path, timeout=30) as resp:
            return resp.status, json.load(resp)

    def test_get_owners_lists_active_owners_semantic_model_owners_first(self):
        code, owners = self.get("/owners")
        self.assertEqual(code, 200)
        active = {i for i, o in self.est.owners.items() if o["status"] == "active"}
        self.assertEqual({o["owner_id"] for o in owners}, active)
        self.assertEqual(len(owners), 47)
        self.assertEqual(set(owners[0]), {"owner_id", "owner_name", "role", "scope"})
        roles = [o["role"] == "Semantic Model Owner" for o in owners]
        self.assertEqual(roles, sorted(roles, reverse=True))
        self.assertEqual([o["owner_id"] for o in owners[:5]], ["OWN-021", "OWN-039", "OWN-045", "OWN-049", "OWN-056"])
        for o in owners:
            self.assertEqual(o["owner_name"], self.est.owners[o["owner_id"]]["owner_name"])

    def test_owners_endpoint_is_read_only(self):
        before = {i: dict(o) for i, o in self.est.owners.items()}
        self.get("/owners")
        self.assertEqual({i: dict(o) for i, o in self.est.owners.items()}, before)

    def test_mock_export_carries_owners_and_bottlenecks(self):
        mock = json.loads((ROOT / "data/mock_api.json").read_text(encoding="utf-8"))
        self.assertEqual(mock["owners"], active_owners(self.est))
        self.assertEqual(mock["radar"]["ownership_bottlenecks"], json.loads(json.dumps(ownership_bottlenecks(self.est))))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "mock.json"
            with redirect_stdout(StringIO()):
                export_mock.main(str(DB), str(out))
            self.assertEqual(json.loads(out.read_text(encoding="utf-8")), mock, "data/mock_api.json is current")

    def test_warmup_calls_radar(self):
        with redirect_stdout(StringIO()) as printed:
            self.assertTrue(warmup.warm_radar(self.url + "/"))
            self.assertFalse(warmup.warm_radar("http://127.0.0.1:9"))
        self.assertIn("radar", printed.getvalue())
        self.assertTrue(hasattr(self.est, "_bottlenecks"), "the call left the bottleneck cached")


if __name__ == "__main__":
    unittest.main()
