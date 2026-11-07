"""Model tiers from the environment: order, fallback, skipped tiers, the default chain, and the tier trail in the ai block."""
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from reuse_gate import pipeline
from reuse_gate.estate import Estate
from reuse_gate.llm import LLM, LLMError, NoLLM, live_client, live_tiers, tier_config

DB = Path(__file__).resolve().parents[2] / "data" / "estate.db"
DEFAULT_ENV = {"AITTA_API_KEY": "a-key", "FEATHERLESS_API_KEY": "f-key"}
INCLUSTER = {"REUSE_GATE_LLM_TIERS": "incluster,aitta,featherless",
             "REUSE_GATE_LLM_INCLUSTER_BASE_URL": "http://vllm.ns.svc.cluster.local/v1",
             "REUSE_GATE_LLM_INCLUSTER_MODEL": "small-instruct", "REUSE_GATE_LLM_INCLUSTER_TIMEOUT_S": "15"}


def reply(text):
    response = MagicMock()
    response.__enter__.return_value = io.BytesIO(json.dumps({"choices": [{"message": {"content": text}}]}).encode())
    return response


def chain(env):
    with patch.dict(os.environ, env, clear=True):
        client = live_client()
    tiers, c = [], client
    while c is not None:
        tiers.append(c)
        c = c.fallback
    return client, tiers


class TierConfigTest(unittest.TestCase):
    def test_default_config_is_unchanged(self):
        client, tiers = chain(DEFAULT_ENV)
        self.assertEqual([(t.tier, t.base_url, t.model, t.timeout, t.retries) for t in tiers], [
            ("aitta", "https://aitta-api.csc.fi/openai/v1", "openai/gpt-oss-120b", 20.0, 0),
            ("featherless", "https://api.featherless.ai/v1", "zai-org/GLM-5.2", 40.0, 0)])
        self.assertEqual([t.api_key for t in tiers], ["a-key", "f-key"])
        self.assertIsNotNone(client.limiter)
        self.assertIsNotNone(client.answers)

    def test_old_key_names_and_timeouts_still_work(self):
        _, tiers = chain({"AITTA_API_KEY": "a", "Featherless_AP_KEY": "f", "LLM_TIMEOUT": "7", "LLM_FALLBACK_TIMEOUT": "9"})
        self.assertEqual([(t.tier, t.timeout) for t in tiers], [("aitta", 7.0), ("featherless", 9.0)])

    def test_order_comes_from_the_tier_list(self):
        _, tiers = chain({**DEFAULT_ENV, **INCLUSTER})
        self.assertEqual([t.tier for t in tiers], ["incluster", "aitta", "featherless"])
        self.assertEqual((tiers[0].base_url, tiers[0].model, tiers[0].timeout, tiers[0].api_key),
                         ("http://vllm.ns.svc.cluster.local/v1", "small-instruct", 15.0, ""))
        _, tiers = chain({**DEFAULT_ENV, "REUSE_GATE_LLM_TIERS": "featherless,aitta"})
        self.assertEqual([t.tier for t in tiers], ["featherless", "aitta"])

    def test_missing_config_skips_a_tier(self):
        _, tiers = chain({"FEATHERLESS_API_KEY": "f", **INCLUSTER, "REUSE_GATE_LLM_INCLUSTER_MODEL": ""})
        self.assertEqual([t.tier for t in tiers], ["featherless"])  # no in-cluster model, no Aitta key
        with patch.dict(os.environ, {"REUSE_GATE_LLM_TIERS": "nothing"}, clear=True):
            self.assertIsInstance(live_client(), NoLLM)
            self.assertIsNone(tier_config("aitta"))

    def test_per_tier_overrides_for_a_built_in_tier(self):
        env = {**DEFAULT_ENV, "REUSE_GATE_LLM_AITTA_MODEL": "other", "REUSE_GATE_LLM_AITTA_API_KEY": "k2", "REUSE_GATE_LLM_AITTA_TIMEOUT_S": "5"}
        _, tiers = chain(env)
        self.assertEqual((tiers[0].model, tiers[0].api_key, tiers[0].timeout), ("other", "k2", 5.0))

    def test_rules_mode_still_wins(self):
        with patch.dict(os.environ, {**DEFAULT_ENV, **INCLUSTER, "LLM_MODE": "rules"}, clear=True):
            self.assertIsInstance(live_client(), NoLLM)

    def test_names_are_sanitised(self):
        with patch.dict(os.environ, {"REUSE_GATE_LLM_TIERS": "Aitta, ../x ,", **DEFAULT_ENV}, clear=True):
            self.assertEqual([t.tier for t in live_tiers()], ["aitta"])


class TierFallbackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.c = LLM("http://c/v1", "", "m3", cache_dir=self.tmp.name, retries=0, tier="featherless")
        self.b = LLM("http://b/v1", "", "m2", cache_dir=self.tmp.name, retries=0, tier="aitta", fallback=self.c)
        self.a = LLM("http://a/v1", "", "m1", cache_dir=self.tmp.name, retries=0, tier="incluster", fallback=self.b)
        self.msg = [{"role": "user", "content": "hi"}]

    def test_each_failure_moves_to_the_next_tier_and_is_recorded(self):
        errors = {"timeout": TimeoutError("slow"), "http_401": urllib.error.HTTPError("u", 401, "x", None, None),
                  "http_503": urllib.error.HTTPError("u", 503, "x", None, None), "unreachable": urllib.error.URLError("down")}
        for code, error in errors.items():
            with self.subTest(code=code):
                self.setUp()
                with patch("urllib.request.urlopen", side_effect=[error, reply("ok")]) as spy:
                    self.assertEqual(self.a.chat(self.msg), "ok")
                self.assertEqual([c.args[0].full_url.split("/")[2] for c in spy.call_args_list], ["a", "b"])
                self.assertEqual((self.a.last_tier, self.a.last_model), ("aitta", "m2"))
                self.assertEqual(list(self.a.last_failures), [{"tier": "incluster", "reason": code}])

    def test_two_failures_reach_the_third_tier(self):
        with patch("urllib.request.urlopen", side_effect=[TimeoutError("slow"), urllib.error.HTTPError("u", 500, "x", None, None), reply("ok")]):
            self.assertEqual(self.a.chat(self.msg), "ok")
        self.assertEqual(self.a.last_tier, "featherless")
        self.assertEqual(list(self.a.last_failures), [{"tier": "incluster", "reason": "timeout"}, {"tier": "aitta", "reason": "http_500"}])

    def test_all_failing_raises_with_every_failure_recorded(self):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("slow")):
            with self.assertRaises(LLMError):
                self.a.chat(self.msg)
        self.assertEqual([f["tier"] for f in self.a.last_failures], ["incluster", "aitta", "featherless"])

    def test_invalid_json_is_recorded_as_a_failure(self):
        with patch("urllib.request.urlopen", side_effect=[reply("not json"), reply('{"a": 1}')]):
            self.assertEqual(self.a.json_chat(self.msg), {"a": 1})
        self.assertEqual((self.a.last_tier, list(self.a.last_failures)), ("aitta", [{"tier": "incluster", "reason": "invalid_json"}]))

    def test_no_secret_in_the_trail(self):
        a = LLM("http://a/v1", "sk-secret-value", "m1", cache_dir=self.tmp.name, retries=0, tier="aitta", fallback=self.b)
        with patch("urllib.request.urlopen", side_effect=[urllib.error.HTTPError("u", 401, "x", None, None), reply("ok")]):
            a.chat(self.msg)
        self.assertNotIn("sk-secret-value", json.dumps(list(a.last_failures)))


class BreakerTest(unittest.TestCase):
    """Every tier, the last one and the embeddings included, is skipped for LLM_TIER_COOLDOWN_S after a failure."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.msg = [{"role": "user", "content": "hi"}]

    def test_last_tier_breaker_opens_then_closes(self):
        c = LLM("http://c/v1", "", "m", cache_dir=self.tmp.name, retries=0, tier="featherless")
        c.use_cache = False
        with patch.dict(os.environ, {"LLM_TIER_COOLDOWN_S": "60"}), patch("urllib.request.urlopen", side_effect=TimeoutError("slow")) as spy:
            with self.assertRaises(LLMError):
                c.chat(self.msg)
            with self.assertRaises(LLMError) as ctx:
                c.chat(self.msg)
        self.assertEqual((spy.call_count, ctx.exception.code), (1, "cooling_down"))
        self.assertEqual(list(c.last_failures), [{"tier": "featherless", "reason": "cooling_down"}])
        c._skip_until = 0  # the cooldown has passed
        with patch("urllib.request.urlopen", side_effect=[reply("ok")]):
            self.assertEqual(c.chat(self.msg), "ok")

    def test_open_breakers_cost_no_time(self):
        b = LLM("http://b/v1", "", "m2", cache_dir=self.tmp.name, retries=0, tier="featherless")
        a = LLM("http://a/v1", "", "m1", cache_dir=self.tmp.name, retries=0, tier="aitta", fallback=b)
        a.use_cache = b.use_cache = False
        with patch("urllib.request.urlopen", side_effect=TimeoutError("slow")):
            with self.assertRaises(LLMError):
                a.chat(self.msg)
        with patch("urllib.request.urlopen") as spy:
            for _ in range(5):
                with self.assertRaises(LLMError):
                    a.chat(self.msg)
        spy.assert_not_called()
        self.assertEqual(list(a.last_failures), [{"tier": "aitta", "reason": "cooling_down"}, {"tier": "featherless", "reason": "cooling_down"}])

    def test_embeddings_breaker_survives_across_requests(self):
        from reuse_gate import kpi_match
        kpi_match._EMBEDDERS.clear()
        with patch.dict(os.environ, {"AITTA_API_KEY": "k"}):
            first = kpi_match.embedder_from_env()
            first.use_cache = False
            with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 503, "x", None, None)) as spy:
                with self.assertRaises(LLMError):
                    first.embed(["a"], "e5")
                again = kpi_match.embedder_from_env()
                with self.assertRaises(LLMError) as ctx:
                    again.embed(["b"], "e5")
        self.assertIs(again, first)
        self.assertEqual((spy.call_count, ctx.exception.code), (1, "cooling_down"))
        kpi_match._EMBEDDERS.clear()

    def test_timeouts_stay_short(self):
        _, tiers = chain({**DEFAULT_ENV, "REUSE_GATE_LLM_TIERS": "aitta,featherless,together", "TOGETHER_API_KEY": "t"})
        self.assertEqual([(t.tier, t.timeout, t.retries) for t in tiers], [("aitta", 20.0, 0), ("featherless", 40.0, 0), ("together", 20.0, 0)])


class FakeTieredClient:
    """Answers intent and explanation like the chain would after the first tier failed."""
    configured, answers, last_model, last_tier = True, None, "m2", "aitta"
    last_failures = ({"tier": "incluster", "reason": "timeout"},)

    def parse_intent(self, text, products, markets, kpis):
        return {"products": ["Nubeqa"], "market": "", "kpis": ["Net Sales"], "kind": "new_report", "clarifications": []}

    def explain(self, request, intent, recommendation):
        raise LLMError("down", "unreachable")


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class TierInResultTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def run_one(self, client):
        req = {"request_id": "T-1", "request_text": "I need a dashboard for Nubeqa net sales by region in EMEA",
               "product_context": self.est.all_scope, "market_context": None}
        return pipeline.run_request(self.est, req, client)

    def test_rules_only_says_rules(self):
        ai = self.run_one(NoLLM())["ai"]
        self.assertEqual((ai["tier"], ai["explanation_tier"], ai["tiers_failed"]), ("rules", "rules", []))

    def test_answering_and_failed_tiers_are_recorded(self):
        ai = self.run_one(FakeTieredClient())["ai"]
        self.assertEqual((ai["source"], ai["tier"], ai["explanation_tier"]), ("llm", "aitta", "rules"))
        self.assertEqual(ai["tiers_failed"][0], {"tier": "incluster", "reason": "timeout", "call": "intent"})
        self.assertIn("explanation", [f["call"] for f in ai["tiers_failed"]])


if __name__ == "__main__":
    unittest.main()
