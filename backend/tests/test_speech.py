"""The /speak endpoint: right call to ElevenLabs, protected credits, and no key in any error."""
import hashlib
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

from reuse_gate import server
from reuse_gate import speech
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM
from reuse_gate.pipeline import run_request, speech_script
from reuse_gate.recommend import NAME_NOTE

KEY = "test-secret-value"
ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "estate.db"
REAL_URLOPEN = urllib.request.urlopen


def audio_reply(data=b"ID3audio"):
    response = MagicMock()
    response.__enter__.return_value = io.BytesIO(data)
    return response


class SpeakBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        env = patch.dict(os.environ, {"ELEVENLABS_API_KEY": KEY, "LLM_CACHE_DIR": tmp.name}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        calls = patch.object(speech, "_calls", 0)
        calls.start()
        self.addCleanup(calls.stop)


class SpeakTest(SpeakBase):
    def test_calls_elevenlabs_with_the_key_in_the_header(self):
        with patch("urllib.request.urlopen", return_value=audio_reply()) as spy:
            self.assertEqual(speech.speak("Hello there"), b"ID3audio")
        req = spy.call_args.args[0]
        self.assertTrue(req.full_url.startswith("https://api.elevenlabs.io/v1/text-to-speech/"))
        self.assertEqual(req.get_header("Xi-api-key"), KEY)
        self.assertEqual(req.get_header("Accept"), "audio/mpeg")
        self.assertEqual(json.loads(req.data)["text"], "Hello there")
        self.assertNotIn(KEY, req.full_url)

    def test_repeat_text_is_cached_and_costs_nothing(self):
        with patch("urllib.request.urlopen", return_value=audio_reply()) as spy:
            speech.speak("Same text")
            self.assertEqual(speech.speak("Same text"), b"ID3audio")
        self.assertEqual(spy.call_count, 1)
        self.assertEqual(speech._calls, 1)

    def test_audio_is_cached_on_disk_by_the_sha256_of_the_text(self):
        with patch("urllib.request.urlopen", return_value=audio_reply()):
            speech.speak("Hello there")
        name = hashlib.sha256("Hello there".encode()).hexdigest() + ".mp3"
        files = [p.name for p in (Path(os.environ["LLM_CACHE_DIR"]) / "speech").iterdir()]
        self.assertEqual(files, [name])

    def test_cache_key_is_the_text_alone(self):
        with patch("urllib.request.urlopen", return_value=audio_reply()) as spy:
            speech.speak("Hello there")
            with patch.dict(os.environ, {"ELEVENLABS_VOICE_ID": "other"}):
                speech.speak("Hello there")
        self.assertEqual(spy.call_count, 1)

    def test_key_comes_only_from_the_specified_variable(self):
        for name in ("ElevenLabs_API_KEY", "XI_API_KEY", "LLM_API_KEY"):
            with self.subTest(name), patch.dict(os.environ, {"ELEVENLABS_API_KEY": "", name: KEY}):
                self.assertRefused(503, "Hello")

    @unittest.skipUnless((ROOT / "frontend/src").exists() and (ROOT / "env.example").exists(),
                         "frontend and env.example are not in the OpenShift image; this runs in the full local suite")
    def test_key_is_never_in_the_front_end_or_in_tracked_config(self):
        root = ROOT
        for path in (root / "frontend/src").rglob("*"):
            if path.is_file() and path.suffix in {".ts", ".tsx", ".json"}:
                text = path.read_text(encoding="utf-8").lower()
                self.assertNotIn("xi-api-key", text, path)
                self.assertNotIn("elevenlabs_api_key", text, path)
                self.assertNotIn("api.elevenlabs.io", text, path)
        self.assertRegex((root / "env.example").read_text(encoding="utf-8"), r"(?m)^ELEVENLABS_API_KEY=$")

    def test_voice_and_model_can_be_set(self):
        with patch.dict(os.environ, {"ELEVENLABS_VOICE_ID": "voice1", "ELEVENLABS_MODEL": "model1"}), patch("urllib.request.urlopen", return_value=audio_reply()) as spy:
            speech.speak("Hello")
        req = spy.call_args.args[0]
        self.assertTrue(req.full_url.endswith("/voice1"))
        self.assertEqual(json.loads(req.data)["model_id"], "model1")

    def assertRefused(self, status, text):
        with patch("urllib.request.urlopen") as spy, self.assertRaises(speech.SpeechError) as caught:
            speech.speak(text)
        self.assertEqual(caught.exception.status, status)
        spy.assert_not_called()

    def test_bad_text_is_refused_without_spending(self):
        for text in ("", "   ", None, 5, ["x"], "x" * (speech.MAX_CHARS + 1)):
            with self.subTest(text=str(text)[:10]):
                self.assertRefused(400, text)

    def test_missing_key_is_a_clear_503(self):
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}):
            self.assertRefused(503, "Hello")

    def test_budget_stops_paid_calls_but_not_cached_audio(self):
        with patch("urllib.request.urlopen", return_value=audio_reply()):
            speech.speak("Already paid")
        with patch.dict(os.environ, {"SPEAK_MAX_CALLS": "1"}):
            self.assertRefused(429, "Something new")
            with patch("urllib.request.urlopen") as spy:
                self.assertEqual(speech.speak("Already paid"), b"ID3audio")
            spy.assert_not_called()

    def test_upstream_failures_are_502_and_never_show_the_key(self):
        for error in (urllib.error.HTTPError("u", 401, KEY, None, None), urllib.error.HTTPError("u", 402, "quota", None, None),
                      urllib.error.URLError(KEY), TimeoutError(KEY)):
            with self.subTest(error=type(error).__name__), patch("urllib.request.urlopen", side_effect=error):
                with self.assertRaises(speech.SpeechError) as caught:
                    speech.speak("Hello")
                self.assertEqual(caught.exception.status, 502)
                self.assertNotIn(KEY, str(caught.exception))

    def test_failed_call_is_not_cached(self):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("slow")), self.assertRaises(speech.SpeechError):
            speech.speak("Hello")
        with patch("urllib.request.urlopen", return_value=audio_reply()):
            self.assertEqual(speech.speak("Hello"), b"ID3audio")


class SpeechScriptTest(unittest.TestCase):
    def test_leaves_out_ids_and_the_name_note(self):
        script = speech_script("repair_and_reuse", ["X covers ['Net Sales'], but has gaps", "requested KPIs this target covers: Net Sales (Asset_KPI_Map AST-1:KPI-2)", NAME_NOTE])
        self.assertEqual(script, "Recommendation: repair and reuse. X covers Net Sales, but has gaps.")

    def test_long_script_is_cut_at_a_sentence_within_the_cap(self):
        script = speech_script("new_build", [f"sentence number {i} of a long explanation" for i in range(100)])
        self.assertLessEqual(len(script), speech.MAX_CHARS)
        self.assertTrue(script.endswith("."))

    @unittest.skipUnless(DB.exists(), "run load_estate.py first")
    def test_every_batch_script_fits_and_is_readable(self):
        est = Estate(str(DB))
        for req in est.requests:
            script = run_request(est, req, NoLLM(), as_of=req["request_date"])["ai"]["speech"]
            self.assertLessEqual(len(script), speech.MAX_CHARS)
            self.assertTrue(script.startswith("Recommendation: "))
            self.assertNotIn("Asset_KPI_Map", script)
            self.assertNotIn("['", script)


class SpeakApiTest(SpeakBase):
    def setUp(self):
        super().setUp()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def post(self, data):
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}/speak", data=data, method="POST")
        try:
            with REAL_URLOPEN(req, timeout=20) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, exc.headers, exc.read()

    def test_returns_audio_with_cors(self):
        with patch.object(server, "speak", return_value=b"ID3audio"):
            code, headers, body = self.post(b'{"text": "Hello"}')
        self.assertEqual((code, headers["Content-Type"], body), (200, "audio/mpeg", b"ID3audio"))
        self.assertNotIn("Access-Control-Allow-Origin", headers, "no Origin header, so no CORS grant")

    def test_errors_are_json_with_the_right_status(self):
        for data, status in ((b'{"text": ""}', 400), (b'{"text": 5}', 400), (b"[1]", 400), (b"not json", 400)):
            with self.subTest(data=data):
                code, headers, body = self.post(data)
                self.assertEqual(code, status)
                self.assertIn("error", json.loads(body))
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}):
            self.assertEqual(self.post(b'{"text": "Hello"}')[0], 503)


if __name__ == "__main__":
    unittest.main()
