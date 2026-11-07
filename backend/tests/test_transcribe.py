"""POST /transcribe: the right call to ElevenLabs, honest errors, limits, and nothing stored or logged. No real service is called."""
import io
import json
import os
import struct
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from reuse_gate import server, transcribe
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM

KEY = "test-secret-value"
ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "estate.db"
WEBM = b"\x1aE\xdf\xa3" + b"\x00" * 2000


def wav(seconds, rate=8000):
    data = b"\x00\x00" * int(rate * seconds)
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    return header + b"data" + struct.pack("<I", len(data)) + data


class Fake:
    """Stands in for the HTTP call to ElevenLabs and remembers what it was sent."""

    def __init__(self, status=200, body=None, error=None):
        self.status, self.error, self.calls = status, error, []
        self.body = json.dumps({"text": "Nubeqa net sales for Germany", "language_code": "eng", "language_probability": 0.98}).encode() if body is None else body

    def __call__(self, url, data, headers, timeout):
        self.calls.append({"url": url, "data": data, "headers": headers, "timeout": timeout})
        if self.error:
            raise self.error
        return self.status, self.body


class Base(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"ELEVENLABS_API_KEY": KEY}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        for name, value in (("_calls", 0), ("_seen", {})):
            p = patch.object(transcribe, name, value)
            p.start()
            self.addCleanup(p.stop)


class TranscribeTest(Base):
    def test_calls_scribe_v2_with_the_audio_and_lets_the_service_detect_the_language(self):
        fake = Fake()
        out = transcribe.transcribe(WEBM, "audio/webm;codecs=opus", "1.2.3.4", fake)
        self.assertEqual(out, {"text": "Nubeqa net sales for Germany", "language": "eng"})
        call = fake.calls[0]
        self.assertEqual((call["url"], call["timeout"]), ("https://api.elevenlabs.io/v1/speech-to-text", 20))
        self.assertEqual(call["headers"]["xi-api-key"], KEY)
        self.assertTrue(call["headers"]["Content-Type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b'name="model_id"\r\n\r\nscribe_v2\r\n', call["data"])
        self.assertIn(b'filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\n' + WEBM, call["data"])
        self.assertNotIn(b"language_code", call["data"])

    def test_every_browser_format_is_accepted(self):
        for kind, ext in (("audio/webm", "webm"), ("audio/ogg;codecs=opus", "ogg"), ("audio/mp4", "mp4"), ("audio/wav", "wav"), ("audio/x-wav", "wav")):
            with self.subTest(kind):
                fake = Fake()
                transcribe.transcribe(wav(1) if ext == "wav" else WEBM, kind, f"ip-{ext}-{kind}", fake)
                self.assertIn(f'filename="recording.{ext}"'.encode(), fake.calls[0]["data"])

    def assertRefused(self, status, code, *args, fake=None):
        fake = fake or Fake()
        with self.assertRaises(transcribe.TranscribeError) as caught:
            transcribe.transcribe(*args, fake)
        self.assertEqual((caught.exception.status, caught.exception.code), (status, code))
        body = json.dumps(caught.exception.body())
        self.assertNotIn(KEY, body)
        return fake, body

    def test_bad_input_never_reaches_the_provider(self):
        for status, code, audio, kind in ((400, "empty_audio", b"", "audio/webm"), (413, "too_large", b"x" * (transcribe.MAX_BYTES + 1), "audio/webm"),
                                          (415, "unsupported_type", WEBM, "video/webm"), (415, "unsupported_type", WEBM, None),
                                          (413, "too_long", wav(35), "audio/wav")):
            with self.subTest(code):
                fake, _ = self.assertRefused(status, code, audio, kind, "ip")
                self.assertEqual(fake.calls, [])
        transcribe.transcribe(wav(29), "audio/wav", "ip2", Fake())

    def test_no_key(self):
        with patch.dict(os.environ, {}, clear=True):
            fake, _ = self.assertRefused(503, "not_configured", WEBM, "audio/webm", "ip")
        self.assertEqual(fake.calls, [])

    def test_provider_answers_map_to_clear_errors_without_their_body(self):
        secret_body = json.dumps({"detail": {"status": "missing_permissions", "message": f"key {KEY} lacks speech_to_text"}}).encode()
        cases = [(401, secret_body, 503, "permission_missing"), (403, secret_body, 503, "permission_missing"), (429, b"{}", 429, "provider_busy"),
                 (500, b"Traceback (most recent call last)", 502, "provider_failed"), (422, b'{"detail": []}', 502, "provider_failed"),
                 (200, b"not json", 502, "provider_failed"), (200, b"[]", 502, "provider_failed")]
        for n, (status, body, ours, code) in enumerate(cases):
            with self.subTest(status=status, code=code):
                _, text = self.assertRefused(ours, code, WEBM, "audio/webm", f"ip{n}", fake=Fake(status, body))
                self.assertNotIn("missing_permissions", text)
                self.assertNotIn("Traceback", text)

    def test_timeout_and_network_failure(self):
        self.assertRefused(504, "provider_timeout", WEBM, "audio/webm", "a", fake=Fake(error=TimeoutError()))
        self.assertRefused(502, "provider_failed", WEBM, "audio/webm", "b", fake=Fake(error=urllib.error.URLError("down")))

    def test_an_empty_transcript_is_an_error_not_a_fake_text(self):
        for body in ({"text": "", "language_code": "eng"}, {"text": "   ", "language_code": "eng"}, {"language_code": "eng"}, {"text": None}):
            with self.subTest(body):
                self.assertRefused(422, "no_speech", WEBM, "audio/webm", str(body), fake=Fake(body=json.dumps(body).encode()))

    def test_rate_limit_is_per_address(self):
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": KEY, "TRANSCRIBE_PER_MINUTE": "2"}):
            for _ in range(2):
                transcribe.transcribe(WEBM, "audio/webm", "1.1.1.1", Fake())
            self.assertRefused(429, "rate_limited", WEBM, "audio/webm", "1.1.1.1")
            transcribe.transcribe(WEBM, "audio/webm", "2.2.2.2", Fake())
        transcribe.allow("3.3.3.3", now=0)
        with patch.dict(os.environ, {"TRANSCRIBE_PER_MINUTE": "1"}):
            transcribe.allow("3.3.3.3", now=61)  # a minute later the address may call again

    def test_process_budget(self):
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": KEY, "TRANSCRIBE_MAX_CALLS": "1"}):
            transcribe.transcribe(WEBM, "audio/webm", "a", Fake())
            self.assertRefused(429, "budget_spent", WEBM, "audio/webm", "b")


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class TranscribeApiTest(Base):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.patcher = patch.multiple(server, EST=Estate(str(DB)), LLM_CLIENT=NoLLM(), LOG=[], LOG_FILE=str(Path(cls.tmp.name) / "log.jsonl"))
        cls.patcher.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patcher.stop()
        cls.tmp.cleanup()

    def post(self, data, kind="audio/webm", headers=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}/transcribe", data=data, method="POST",
                                     headers={"Content-Type": kind, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    def test_round_trip_and_nothing_is_logged_or_stored(self):
        fake = Fake()
        log, before = io.StringIO(), set(Path(self.tmp.name).iterdir())
        with patch.object(transcribe, "_post", fake), redirect_stderr(log):
            code, body = self.post(WEBM)
        self.assertEqual((code, body), (200, {"text": "Nubeqa net sales for Germany", "language": "eng"}))
        self.assertNotIn("Nubeqa", log.getvalue())
        self.assertIn("/transcribe", log.getvalue(), "the request line is logged, its content is not")
        self.assertEqual(set(Path(self.tmp.name).iterdir()), before)
        self.assertEqual(server.LOG, [])

    def test_errors_over_http(self):
        with patch.object(transcribe, "_post", Fake(401, b'{"detail": "x"}')):
            self.assertEqual(self.post(WEBM, headers={"X-Forwarded-For": "9.9.9.1"}), (503, {"error": "this server's speech key is not allowed to use Speech to Text; please type instead", "code": "permission_missing"}))
        self.assertEqual(self.post(b"", headers={"X-Forwarded-For": "9.9.9.2"})[1]["code"], "empty_audio")
        self.assertEqual(self.post(WEBM, "text/plain")[1]["code"], "unsupported_type")
        code, body = self.post(b"x" * (transcribe.MAX_BYTES + 10))
        self.assertEqual((code, body["code"]), (413, "too_large"))

    def test_the_router_address_is_the_one_limited(self):
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": KEY, "TRANSCRIBE_PER_MINUTE": "1"}), patch.object(transcribe, "_post", Fake()):
            self.assertEqual(self.post(WEBM, headers={"X-Forwarded-For": "6.6.6.6, 5.5.5.5"})[0], 200)
            self.assertEqual(self.post(WEBM, headers={"X-Forwarded-For": "7.7.7.7, 5.5.5.5"})[1]["code"], "rate_limited", "a forged first entry does not help")
            self.assertEqual(self.post(WEBM, headers={"X-Forwarded-For": "5.5.5.6"})[0], 200)

    def test_other_endpoints_are_unchanged(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}/recommend", data=b'{"text": "Create a Nubeqa net sales dashboard for Germany."}', method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()
