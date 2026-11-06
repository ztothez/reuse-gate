import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from llm import LLM, LLMBudgetError, LLMError, LLMGatedError, live_client


class LLMClientTest(unittest.TestCase):
    def test_chat_uses_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = LLM("http://unused/v1", "secret", "model", cache_dir=tmp)
            key = client._cache_key([{"role": "user", "content": "hi"}], {})
            client._write_cache(key, "cached")
            self.assertEqual(client.chat([{"role": "user", "content": "hi"}]), "cached")

    def test_json_chat_rejects_non_object(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = LLM("http://unused/v1", "", "model", cache_dir=tmp)
            client._write_cache(client._cache_key([], {}), "[]")
            with self.assertRaises(LLMError):
                client.json_chat([])

    def test_json_chat_accepts_fences_and_reasoning(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = LLM("http://unused/v1", "", "model", cache_dir=tmp)
            client._write_cache(client._cache_key([], {}), '<think>{"no": 1}</think>Sure:\n```json\n{"a": 1}\n```')
            self.assertEqual(client.json_chat([]), {"a": 1})

    def test_retry_gated_and_budget(self):
        def http_error(code):
            return urllib.error.HTTPError("http://unused", code, "x", None, None)

        with tempfile.TemporaryDirectory() as tmp:
            client = LLM("http://unused/v1", "", "model", cache_dir=tmp, retries=1, retry_wait=0)
            with patch("urllib.request.urlopen", side_effect=http_error(403)) as spy:
                with self.assertRaises(LLMGatedError):
                    client.chat([{"role": "user", "content": "a"}])
            self.assertEqual(spy.call_count, 1, "403 must not retry")
            with patch("urllib.request.urlopen", side_effect=http_error(503)) as spy:
                with self.assertRaises(LLMError):
                    client.chat([{"role": "user", "content": "b"}])
            self.assertEqual(spy.call_count, 2, "503 retries once")
            client.max_calls = client.calls
            with self.assertRaises(LLMBudgetError):
                client.chat([{"role": "user", "content": "c"}])


def reply(text):
    response = MagicMock()
    response.__enter__.return_value = io.BytesIO(json.dumps({"choices": [{"message": {"content": text}}]}).encode())
    return response


class FallbackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fallback = LLM("http://fallback/v1", "", "glm", cache_dir=self.tmp.name, retries=0)
        self.primary = LLM("http://primary/v1", "", "gpt-oss", cache_dir=self.tmp.name, retries=0, fallback=self.fallback)
        self.msg = [{"role": "user", "content": "hi"}]

    @staticmethod
    def urls(spy):
        return [call.args[0].full_url.split("/")[2] for call in spy.call_args_list]

    def test_primary_answers_when_healthy(self):
        with patch("urllib.request.urlopen", return_value=reply("ok")) as spy:
            self.assertEqual(self.primary.chat(self.msg), "ok")
        self.assertEqual(self.urls(spy), ["primary"])
        self.assertEqual(self.primary.last_model, "gpt-oss")

    def test_falls_back_on_failure_and_reports_who_answered(self):
        for error in (urllib.error.HTTPError("u", 503, "x", None, None), urllib.error.HTTPError("u", 403, "x", None, None),
                      TimeoutError("slow"), urllib.error.URLError("down")):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as tmp:
                fallback = LLM("http://fallback/v1", "", "glm", cache_dir=tmp, retries=0)
                primary = LLM("http://primary/v1", "", "gpt-oss", cache_dir=tmp, retries=0, fallback=fallback)
                with patch("urllib.request.urlopen", side_effect=[error, reply("from glm")]) as spy:
                    self.assertEqual(primary.chat(self.msg), "from glm")
                self.assertEqual(self.urls(spy), ["primary", "fallback"])
                self.assertEqual(primary.last_model, "glm")

    def test_failed_primary_is_skipped_during_the_cooldown(self):
        with patch("urllib.request.urlopen", side_effect=[TimeoutError("slow"), reply("a"), reply("b")]) as spy:
            self.primary.chat(self.msg)
            self.primary.chat([{"role": "user", "content": "again"}])
        self.assertEqual(self.urls(spy), ["primary", "fallback", "fallback"])

    def test_both_failing_raises_so_the_pipeline_uses_the_rules(self):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("slow")):
            with self.assertRaises(LLMError):
                self.primary.chat(self.msg)

    def test_invalid_json_from_the_primary_goes_to_the_fallback(self):
        with patch("urllib.request.urlopen", side_effect=[reply("not json"), reply('{"a": 1}')]):
            self.assertEqual(self.primary.json_chat(self.msg), {"a": 1})
        self.assertEqual(self.primary.last_model, "glm")

    def test_spent_budget_stops_and_does_not_spend_the_fallback(self):
        self.primary.max_calls = 0
        with patch("urllib.request.urlopen") as spy:
            with self.assertRaises(LLMBudgetError):
                self.primary.chat(self.msg)
        spy.assert_not_called()

    def test_live_client_order_and_rules_mode(self):
        env = {"AITTA_API_KEY": "a", "Featherless_AP_KEY": "f"}
        with patch.dict(os.environ, env, clear=True):
            client = live_client()
            self.assertEqual((client.model, client.fallback.model), ("openai/gpt-oss-120b", "zai-org/GLM-5.2"))
        with patch.dict(os.environ, {"Featherless_AP_KEY": "f"}, clear=True):
            self.assertEqual(live_client().model, "zai-org/GLM-5.2")
        with patch.dict(os.environ, {**env, "LLM_MODE": "rules"}, clear=True):
            self.assertFalse(live_client().configured)

    def test_warmup_skips_the_cache(self):
        self.primary.use_cache = False
        with patch("urllib.request.urlopen", side_effect=lambda *a, **k: reply("ok")) as spy:
            self.primary.chat(self.msg)
            self.primary.chat(self.msg)
        self.assertEqual(spy.call_count, 2)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
