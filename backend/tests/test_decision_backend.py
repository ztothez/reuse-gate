"""REUSE_GATE_DECISION_BACKEND: local and kserve give the same decision, failures fall back to local and say why, and health reports both."""
import importlib.util
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from reuse_gate import decision, kserve_predictor, server
from reuse_gate.answers import AnswerStore
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM
from reuse_gate.pipeline import run_request
from reuse_gate.recommend import parse_request

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "estate.db"
spec = importlib.util.spec_from_file_location("eval_messy", ROOT / "scripts/eval_messy.py")
eval_messy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eval_messy)
TEXT = "I need a dashboard for Nubeqa net sales by region in EMEA"


class SavedOnly:
    """Serves the saved chip answers, so the 10 texts are decided on their AI intents. Any model call fails the test."""
    configured, last_model, last_tier, last_failures = True, None, None, ()

    def __init__(self):
        self.answers = AnswerStore()

    def __getattr__(self, name):
        raise AssertionError(f"model call: {name}")


def strip(result):
    """The result without the fields that name the backend, as JSON."""
    out = json.loads(json.dumps(result, default=str))
    out.pop("decision_backend", None)
    out.pop("decision_backend_reason", None)
    for stage in out["pipeline"]:
        stage["input"].pop("decision_backend", None)
    return out


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class DecisionBackendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))
        cls.patcher = patch.object(server, "EST", cls.est)
        cls.patcher.start()
        cls.predictor = ThreadingHTTPServer(("127.0.0.1", 0), kserve_predictor.Predictor)
        threading.Thread(target=cls.predictor.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.predictor.server_address[1]}"
        cls.kserve = {"REUSE_GATE_DECISION_BACKEND": "kserve", "REUSE_GATE_KSERVE_URL": cls.url, "REUSE_GATE_KSERVE_MODEL": kserve_predictor.NAME}
        cls.texts = list(dict.fromkeys(r["request_text"] for r in cls.est.requests))

    @classmethod
    def tearDownClass(cls):
        cls.predictor.shutdown()
        cls.predictor.server_close()
        cls.patcher.stop()

    def setUp(self):
        decision._health.update(at=0.0, url=None, value=None)

    def req(self, text, rid="P-1"):
        return {"request_id": rid, "request_text": text, "product_context": self.est.all_scope, "market_context": None}

    def both(self, fn):
        with patch.dict(os.environ, {"REUSE_GATE_DECISION_BACKEND": "local"}):
            local = fn()
        with patch.dict(os.environ, self.kserve):
            remote = fn()
        return local, remote

    def test_default_is_local_and_never_calls_kserve(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(decision, "_post", side_effect=AssertionError("called")):
            result = run_request(self.est, self.req(TEXT), NoLLM(), as_of="2026-11-07")
        self.assertEqual(result["decision_backend"], "local")
        self.assertNotIn("decision_backend_reason", result)
        self.assertEqual(result["pipeline"][2]["input"]["decision_backend"], "local")

    def test_kserve_mode_decides_on_the_predictor(self):
        calls = []
        real = decision._post
        with patch.dict(os.environ, self.kserve), patch.object(decision, "_post", side_effect=lambda *a: calls.append(a[0]) or real(*a)):
            result = run_request(self.est, self.req(TEXT), NoLLM(), as_of="2026-11-07")
        self.assertEqual(result["decision_backend"], "kserve")
        self.assertEqual(calls, [f"{self.url}/v1/models/{kserve_predictor.NAME}:predict"])
        self.assertTrue(result["recommendation"]["evidence"])

    def test_parity_on_the_21_messy_prompts_through_the_whole_loop(self):
        rows = eval_messy.load(ROOT / "data/messy_requests.jsonl")
        self.assertEqual(len(rows), 21)
        for row in rows:
            with self.subTest(row=row["id"]):
                (lf, ll), (rf, rl) = self.both(lambda: eval_messy.run_loop(self.est, row, eval_messy.simulate))
                self.assertEqual((rf["decision_backend"], rl["decision_backend"]), ("kserve", "kserve"))
                self.assertEqual(strip(lf), strip(rf))
                self.assertEqual(strip(ll), strip(rl))

    def test_parity_on_the_10_distinct_texts_with_rules_and_saved_ai_intents(self):
        self.assertEqual(len(self.texts), 10)
        for text in self.texts:
            for client in (NoLLM, SavedOnly):
                with self.subTest(text=text[:40], client=client.__name__):
                    local, remote = self.both(lambda: run_request(self.est, self.req(text), client(), as_of="2026-11-07"))
                    self.assertEqual(remote["decision_backend"], "kserve")
                    self.assertEqual(strip(local), strip(remote))

    def test_parity_on_a_human_review_after_three_rounds(self):
        row = {"id": "HR", "text": "dashboard for stuff"}
        (_, local), (_, remote) = self.both(lambda: eval_messy.run_loop(self.est, row, eval_messy.unhelpful))
        self.assertEqual(remote["recommendation"]["action"], "human_review")
        self.assertIn("RULE-008", [e["id"] for e in remote["recommendation"]["evidence"]])
        self.assertEqual(strip(local), strip(remote))

    def test_failures_fall_back_to_local_and_say_why(self):
        with patch.dict(os.environ, {"REUSE_GATE_DECISION_BACKEND": "local"}):
            expected = strip(run_request(self.est, self.req(TEXT), NoLLM(), as_of="2026-11-07"))
        good = decision._post
        cases = {
            "timeout": TimeoutError("slow"),
            "unreachable": urllib.error.URLError("refused"),
            "http_500": urllib.error.HTTPError("u", 500, "x", None, None),
            "bad_response": lambda *a: {"predictions": [{"error": "nope"}]},
            "estate_mismatch": lambda *a: {"predictions": [{**good(*a)["predictions"][0], "estate_snapshot": "sha256:other"}]},
        }
        for code, effect in cases.items():
            with self.subTest(code=code), patch.dict(os.environ, self.kserve), patch.object(decision, "_post", side_effect=effect):
                result = run_request(self.est, self.req(TEXT), NoLLM(), as_of="2026-11-07")
                self.assertEqual((result["decision_backend"], result["decision_backend_reason"]), ("local_fallback", code))
                self.assertEqual(strip(result), expected)
        with patch.dict(os.environ, {**self.kserve, "REUSE_GATE_KSERVE_URL": ""}):
            result = run_request(self.est, self.req(TEXT), NoLLM(), as_of="2026-11-07")
        self.assertEqual((result["decision_backend"], result["decision_backend_reason"]), ("local_fallback", "not_configured"))

    def test_a_dead_endpoint_falls_back_within_the_timeout(self):
        with patch.dict(os.environ, {**self.kserve, "REUSE_GATE_KSERVE_URL": "http://127.0.0.1:9", "REUSE_GATE_KSERVE_TIMEOUT_S": "1"}):
            result = run_request(self.est, self.req(TEXT), NoLLM(), as_of="2026-11-07")
        self.assertEqual((result["decision_backend"], result["decision_backend_reason"]), ("local_fallback", "unreachable"))

    def test_intent_round_trip_keeps_question_fields(self):
        parsed = parse_request(self.est, self.req("Nubeqa dash pls: NSG, fcst var, mkt access by ctry"))
        self.assertTrue(parsed.clarifications)
        back = decision.intent_from(json.loads(json.dumps(decision.intent_json(parsed))))
        self.assertEqual(back, parsed)
        self.assertEqual([(q.field, q.basis) for q in back.clarifications], [(q.field, q.basis) for q in parsed.clarifications])

    def test_predictor_still_serves_text_and_rejects_bad_bodies(self):
        def post(body):
            req = urllib.request.Request(f"{self.url}/v1/models/{kserve_predictor.NAME}:predict", data=body, headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return resp.status, json.load(resp)
            except urllib.error.HTTPError as exc:
                return exc.code, json.load(exc)
        status, body = post(json.dumps({"instances": [{"text": TEXT}]}).encode())
        self.assertEqual(status, 200)
        self.assertIn("recommendation", body["predictions"][0])
        for bad in (b"{}", b"not json", json.dumps({"instances": [{"intent": {"text": "x"}}]}).encode()):
            self.assertEqual(post(bad)[0], 400)

    def test_health_reports_backend_and_reachability(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(decision.health(), {"decision_backend": "local", "kserve": {"url": None, "model": "reuse-gate-kserve", "reachable": None}})
        with patch.dict(os.environ, self.kserve):
            self.assertEqual(decision.health()["kserve"]["reachable"], True)
            self.assertEqual(decision.health()["decision_backend"], "kserve")
        decision._health.update(at=0.0)
        with patch.dict(os.environ, {**self.kserve, "REUSE_GATE_KSERVE_URL": "http://127.0.0.1:9"}):
            self.assertEqual(decision.health()["kserve"]["reachable"], False)

    def test_health_check_is_cached(self):
        calls = []
        with patch.dict(os.environ, self.kserve):
            for _ in range(3):
                decision.health(get=lambda url: calls.append(url) or True)
        self.assertEqual(len(calls), 1)

    def test_api_health_routes(self):
        api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=api.serve_forever, daemon=True).start()
        self.addCleanup(api.server_close)
        self.addCleanup(api.shutdown)
        with patch.dict(os.environ, self.kserve):
            for path in ("/health", "/healthz"):
                with urllib.request.urlopen(f"http://127.0.0.1:{api.server_address[1]}{path}", timeout=10) as resp:
                    body = json.load(resp)
                self.assertEqual((resp.status, body["ok"], body["decision_backend"], body["kserve"]["reachable"]), (200, True, "kserve", True))
                self.assertTrue(body["estate_snapshot"].startswith("sha256:"))
                self.assertEqual(set(body["providers"]), {"intent", "explanation", "speech", "transcription"})

    def test_health_reports_providers_without_calling_them(self):
        with patch.dict(os.environ, {"REUSE_GATE_LLM_TIERS": "together,featherless", "TOGETHER_API_KEY": "fake"}, clear=True):
            self.assertEqual(server.providers(), {"providers": {"intent": "configured", "explanation": "configured", "speech": "not_configured",
                                                                "transcription": "not_configured"}, "llm_tiers": ["together"]})
            self.assertNotIn("fake", json.dumps(server.providers()), "never a key")
        with patch.dict(os.environ, {"LLM_MODE": "rules", "TOGETHER_API_KEY": "fake", "ELEVENLABS_API_KEY": "fake"}, clear=True):
            self.assertEqual(server.providers(), {"providers": {"intent": "off", "explanation": "off", "speech": "configured",
                                                                "transcription": "configured"}, "llm_tiers": []})
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server.providers()["providers"]["intent"], "not_configured")


if __name__ == "__main__":
    unittest.main()
