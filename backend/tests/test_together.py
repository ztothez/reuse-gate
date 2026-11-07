"""The Together AI tier and the evaluation's provider settings, against fake OpenAI-compatible servers. No real calls."""
import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from reuse_gate import pipeline
from reuse_gate.estate import Estate
from reuse_gate.llm import live_client

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "estate.db"
TEXT = "I need a dashboard for Nubeqa net sales by region in EMEA"
INTENT = {"products": ["Nubeqa"], "market": "", "kpis": ["Net Sales"], "kind": "new_report", "clarifications": []}


class FakeProvider:
    """A fake /v1/chat/completions. Records model and auth of each call; status and explanation lines are settable."""

    def __init__(self):
        self.calls, self.status, self.explanation, self.counter = [], 200, None, 0
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fake.calls.append({"path": self.path, "model": body["model"], "auth": self.headers.get("Authorization")})
                if fake.status != 200:
                    self.send_response(fake.status)
                    self.end_headers()
                    return
                system = body["messages"][0]["content"]
                if system.startswith("Parse analytics"):
                    content = INTENT
                elif system.startswith("Explain"):
                    fake.counter += 1
                    content = {"explanation": fake.explanation or [f"The existing report covers what was asked, check {fake.counter}."]}
                else:
                    content = {"faithful": True, "unsupported_claims": []}
                data = json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class TogetherTierTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def setUp(self):
        self.together, self.featherless = FakeProvider(), FakeProvider()
        self.addCleanup(self.together.close)
        self.addCleanup(self.featherless.close)
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)
        self.env = {"REUSE_GATE_LLM_TIERS": "together,featherless", "TOGETHER_API_KEY": "tg-fake-key", "TOGETHER_BASE_URL": self.together.url,
                    "FEATHERLESS_API_KEY": "fl-fake-key", "REUSE_GATE_LLM_FEATHERLESS_BASE_URL": self.featherless.url,
                    "LLM_CACHE_DIR": self.cache.name}

    def run_one(self, env):
        with patch.dict(os.environ, env, clear=True):
            client = live_client()
            client.answers = None  # no saved answers, so every call reaches the fake servers
            req = {"request_id": "TG-1", "request_text": TEXT, "product_context": self.est.all_scope, "market_context": None}
            return pipeline.run_request(self.est, req, client, as_of="2026-11-07")

    def test_default_order_does_not_use_together(self):
        with patch.dict(os.environ, {"AITTA_API_KEY": "a", "FEATHERLESS_API_KEY": "f", "TOGETHER_API_KEY": "t"}, clear=True):
            client = live_client()
        self.assertEqual((client.tier, client.fallback.tier, client.fallback.fallback), ("aitta", "featherless", None))

    def test_together_answers_with_its_key_and_default_model(self):
        result = self.run_one(self.env)
        self.assertEqual((result["ai"]["source"], result["ai"]["tier"], result["ai"]["explanation_tier"]), ("llm", "together", "together"))
        self.assertEqual(result["ai"]["model"], "openai/gpt-oss-120b")
        self.assertEqual(result["ai"]["guard"], "passed")
        self.assertEqual({(c["model"], c["auth"]) for c in self.together.calls}, {("openai/gpt-oss-120b", "Bearer tg-fake-key")})
        self.assertEqual(self.featherless.calls, [])
        self.assertNotIn("tg-fake-key", json.dumps(result))

    def test_model_comes_from_together_model(self):
        self.run_one({**self.env, "TOGETHER_MODEL": "meta-llama/Llama-3.3-70B-Instruct-Turbo"})
        self.assertEqual({c["model"] for c in self.together.calls}, {"meta-llama/Llama-3.3-70B-Instruct-Turbo"})

    def test_outage_falls_back_to_featherless_and_is_recorded(self):
        self.together.status = 503
        result = self.run_one(self.env)
        self.assertEqual(result["ai"]["tier"], "featherless")
        self.assertEqual(result["ai"]["tiers_failed"][0], {"tier": "together", "reason": "http_503", "call": "intent"})
        self.assertTrue(self.featherless.calls)

    def test_circuit_breaker_skips_together_after_a_failure(self):
        self.together.status = 503
        self.run_one(self.env)
        with patch.dict(os.environ, self.env, clear=True):
            client = live_client()
        client.use_cache = False
        client._skip_until = float("inf")
        with patch.dict(os.environ, self.env, clear=True):
            client.chat([{"role": "user", "content": "x"}])
        self.assertEqual(client.last_failures[0], {"tier": "together", "reason": "cooling_down"})

    def test_faithfulness_guard_applies_to_together(self):
        self.together.explanation = ["Reuse AST-9999, which already has 123456 views."]
        result = self.run_one(self.env)
        self.assertEqual((result["ai"]["guard"], result["ai"]["explanation_source"]), ("replaced", "rules"))


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class EvalProviderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("eval_quality", ROOT / "scripts/eval_quality.py")
        cls.eq = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.eq)
        cls.est = Estate(str(DB))

    def setUp(self):
        self.fake = FakeProvider()
        self.addCleanup(self.fake.close)
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)

    def test_defaults_are_todays_values(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.eq.role("GENERATOR"), ("aitta", "CSC Aitta", "https://aitta-api.csc.fi/openai/v1", "AITTA_API_KEY", None))
            self.assertEqual(self.eq.clients(), (None, None, None))

    def test_together_run_names_provider_and_models(self):
        env = {"EVAL_GENERATOR_PROVIDER": "together", "EVAL_GENERATOR_BASE_URL": self.fake.url, "EVAL_JUDGE_PROVIDER": "together",
               "EVAL_JUDGE_BASE_URL": self.fake.url, "EVAL_JUDGE_MODEL": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
               "TOGETHER_API_KEY": "tg-fake-key", "LLM_CACHE_DIR": self.cache.name}
        with patch.dict(os.environ, env, clear=True):
            generator, judge_client, judge_model = self.eq.clients()
            self.assertEqual((generator.model, judge_model), ("openai/gpt-oss-120b", "meta-llama/Llama-3.3-70B-Instruct-Turbo"))
            group = self.eq.generation(self.est, generator, judge_client, judge_model)
        metrics = {m["id"]: m for m in group["metrics"]}
        judged = metrics["faithfulness_judge"]
        self.assertIsNotNone(judged["value"])
        self.assertIn("meta-llama/Llama-3.3-70B-Instruct-Turbo on Together AI", judged["method"])
        self.assertIn("openai/gpt-oss-120b on Together AI", judged["method"])
        for m in metrics.values():
            self.assertIn("differs from the earlier design", m["caveat"], m["id"])
        self.assertIn("openai/gpt-oss-120b on Together AI", metrics["faithfulness_deterministic"]["method"])
        self.assertEqual({c["auth"] for c in self.fake.calls}, {"Bearer tg-fake-key"})
        self.assertNotIn("tg-fake-key", json.dumps(group))

    def test_unknown_provider_is_refused(self):
        with patch.dict(os.environ, {"EVAL_GENERATOR_PROVIDER": "nowhere"}, clear=True), self.assertRaises(SystemExit):
            self.eq.role("GENERATOR")


if __name__ == "__main__":
    unittest.main()
