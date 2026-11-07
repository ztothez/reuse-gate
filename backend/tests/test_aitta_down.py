"""Aitta down (chat and embeddings, HTTP 503 or unreachable): every decision on the 150 batch requests, the 10 ad hoc texts,
the 10 saved chips and the 24 edge cases equals the decision made with no model at all, and the breaker keeps it fast."""
import os
import time
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from reuse_gate import kpi_match
from reuse_gate.answers import AnswerStore
from reuse_gate.edge_cases import CASES, run_case
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM, live_client
from reuse_gate.pipeline import run_request

DB = Path(__file__).resolve().parents[2] / "data" / "estate.db"


class SavedOnly:
    """The saved chip answers and nothing else: the baseline for the chips."""
    configured, last_model, last_tier, last_failures = True, None, None, ()

    def __init__(self):
        self.answers = AnswerStore()

    def __getattr__(self, name):
        raise AssertionError(f"model call: {name}")


def view(result):
    rec = result["recommendation"]
    return (result["intent"]["products"], result["intent"]["market"], result["intent"]["kpis"], rec["action"],
            (rec["target"] or {}).get("id"), rec["build_on"], [a["id"] for a in rec["retire"]],
            [a["id"] for a in rec["consolidate_later"]], [(e["table"], e["id"]) for e in rec["evidence"]])


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class AittaDownTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))
        cls.texts = list(dict.fromkeys(r["request_text"] for r in cls.est.requests))

    def adhoc(self, text):
        return {"request_id": "A", "request_text": text, "product_context": self.est.all_scope, "market_context": None}

    def baseline(self):
        out = {}
        for req in self.est.requests:
            out[("batch", req["request_id"])] = view(run_request(self.est, req, NoLLM(), as_of=req["request_date"]))
        for text in self.texts:
            out[("adhoc", text)] = view(run_request(self.est, self.adhoc(text), NoLLM(), as_of="2026-11-07"))
            out[("chip", text)] = view(run_request(self.est, self.adhoc(text), SavedOnly(), as_of="2026-11-07"))
        for name, text, _ in CASES:
            out[("edge", name)] = view(run_case(self.est, text))
        return out

    def with_aitta_down(self, failure):
        hosts = []

        def network(req, *a, **k):
            url = getattr(req, "full_url", str(req))
            hosts.append(url.split("/")[2])
            if "aitta-api.csc.fi" in url:
                raise failure
            raise AssertionError(f"unexpected call to {url}")

        env = {"AITTA_API_KEY": "fake-aitta-key", "LLM_CACHE_DIR": "/nonexistent-cache-dir", "LLM_TIER_COOLDOWN_S": "120"}
        kpi_match._EMBEDDERS.clear()
        with patch.dict(os.environ, env, clear=True), patch("urllib.request.urlopen", side_effect=network):
            client = live_client()
            self.assertEqual((client.tier, client.fallback), ("aitta", None))
            client.use_cache = False  # nothing on disk may stand in for the call
            saved, client.answers = client.answers, None  # batch, ad hoc and edge sets: every request must try the model
            out, sources, started = {}, set(), time.monotonic()
            for req in self.est.requests:
                r = run_request(self.est, req, client, as_of=req["request_date"])
                out[("batch", req["request_id"])], _ = view(r), sources.add((r["ai"]["source"], r["ai"]["reason"]))
            for text in self.texts:
                out[("adhoc", text)] = view(run_request(self.est, self.adhoc(text), client, as_of="2026-11-07"))
            for name, text, _ in CASES:
                out[("edge", name)] = view(run_case(self.est, text, client))
            client.answers = saved  # the chips: served from the saved answers, as on the live API
            for text in self.texts:
                out[("chip", text)] = view(run_request(self.est, self.adhoc(text), client, as_of="2026-11-07"))
            seconds = time.monotonic() - started
        kpi_match._EMBEDDERS.clear()
        return out, hosts, sources, seconds

    def test_decisions_are_unchanged_when_aitta_answers_503_or_is_unreachable(self):
        expected = self.baseline()
        self.assertEqual(len(expected), 150 + 10 + 10 + 24)
        for label, failure in (("HTTP 503", urllib.error.HTTPError("https://aitta-api.csc.fi", 503, "Service Unavailable", None, None)),
                               ("unreachable", urllib.error.URLError(ConnectionRefusedError("refused")))):
            with self.subTest(failure=label):
                got, hosts, sources, seconds = self.with_aitta_down(failure)
                changed = [k for k in expected if got[k] != expected[k]]
                self.assertEqual(changed, [], f"{len(changed)} decision(s) changed")
                self.assertEqual(set(hosts), {"aitta-api.csc.fi"}, "only Aitta was called")
                self.assertLessEqual(len(hosts), 2, "the breaker stops calls after the first chat and embeddings failure")
                self.assertTrue(all(src == "rules" for src, _ in sources))
                self.assertLess(seconds, 120, "no request waits on the dead provider")

    def test_chat_without_a_kpi_and_embeddings_down_falls_back_to_the_rules(self):
        class NoKpi:
            """A chat tier (Featherless, say) that reads the product but no KPI, so KPI matching would need Aitta embeddings."""
            configured, answers, last_model, last_tier, last_failures = True, None, "glm", "featherless", ()

            def parse_intent(self, *a):
                return {"products": ["Nubeqa"], "market": "", "kpis": [], "kind": "new_report", "clarifications": []}

            def json_chat(self, *a, **k):
                raise AssertionError("no confirmation call without an embedding match")

        kpi_match._EMBEDDERS.clear()
        req = self.adhoc("Nubeqa dashboard showing how well the launch is going, by country")
        with patch.dict(os.environ, {"AITTA_API_KEY": "fake-aitta-key", "LLM_CACHE_DIR": "/nonexistent-cache-dir"}), \
             patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("https://aitta-api.csc.fi", 503, "x", None, None)) as spy:
            got = run_request(self.est, req, NoKpi(), as_of="2026-11-07")
        kpi_match._EMBEDDERS.clear()
        self.assertEqual(spy.call_count, 1, "one embeddings call, then the breaker")
        self.assertEqual((got["ai"]["source"], got["ai"]["reason"]), ("rules", "unusable"))
        self.assertEqual(view(got), view(run_request(self.est, req, NoLLM(), as_of="2026-11-07")))


if __name__ == "__main__":
    unittest.main()
