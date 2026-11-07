"""ElevenLabs Speech to Text for dictating a request. The caller can always type instead.

Audio and transcripts are never stored or logged here: they go to ElevenLabs and back to the caller only.
The key is the same ELEVENLABS_API_KEY that /speak uses. Errors are short JSON messages with a code, never the key,
the provider's body or a stack trace. An empty result is an error, never a made-up transcript.
"""
import json
import os
import struct
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import deque

API_URL = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL = "scribe_v2"  # scribe_v1 is deprecated
TIMEOUT = 20
MAX_BYTES = 1_048_576  # about 1 MB
MAX_SECONDS = 30
MAX_TEXT = 2000
TYPES = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav"}
_lock = threading.Lock()
_calls = 0
_seen = {}  # client address -> times of recent calls


class TranscribeError(RuntimeError):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code

    def body(self):
        return {"error": str(self), "code": self.code}


def media_type(content_type):
    """The audio type without parameters (audio/webm;codecs=opus is audio/webm), or None if it is not allowed."""
    base = (content_type or "").split(";")[0].strip().lower()
    return base if base in TYPES else None


def check_audio(audio, content_type):
    """Refuse what should not reach the provider. Duration is checked for WAV, the only format with a plain header."""
    kind = media_type(content_type)
    if not kind:
        raise TranscribeError(415, "unsupported_type", "send webm, ogg, mp4 or wav audio")
    if not audio:
        raise TranscribeError(400, "empty_audio", "the recording is empty")
    if len(audio) > MAX_BYTES:
        raise TranscribeError(413, "too_large", f"the recording is larger than {MAX_BYTES // 1024} KB")
    if TYPES[kind] == "wav" and audio[:4] == b"RIFF" and audio[8:12] == b"WAVE" and len(audio) >= 44:
        byte_rate = struct.unpack("<I", audio[28:32])[0]
        if byte_rate and (len(audio) - 44) / byte_rate > MAX_SECONDS + 1:
            raise TranscribeError(413, "too_long", f"the recording is longer than {MAX_SECONDS} seconds")
    return kind


def allow(client, now=None):
    """Per-address limit, TRANSCRIBE_PER_MINUTE calls a minute (default 6), plus TRANSCRIBE_MAX_CALLS per process (default 100)."""
    global _calls
    now = time.monotonic() if now is None else now
    per_minute = int(os.environ.get("TRANSCRIBE_PER_MINUTE", "6"))
    with _lock:
        recent = _seen.setdefault(client, deque())
        while recent and now - recent[0] > 60:
            recent.popleft()
        if len(recent) >= per_minute:
            raise TranscribeError(429, "rate_limited", "too many recordings from this address; wait a minute or type instead")
        if _calls >= int(os.environ.get("TRANSCRIBE_MAX_CALLS", "100")):
            raise TranscribeError(429, "budget_spent", "the speech to text budget for this server is spent; please type instead")
        recent.append(now)
        _calls += 1
        if len(_seen) > 10_000:  # forget idle addresses so the table cannot grow without bound
            for key in [k for k, v in _seen.items() if not v or now - v[-1] > 60]:
                del _seen[key]


def _post(url, data, headers, timeout):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        with exc:
            return exc.code, exc.read()


def multipart(audio, kind):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in (("model_id", MODEL), ("tag_audio_events", "false")):  # no language_code, so the service detects it
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.{TYPES[kind]}"\r\n'
                 f"Content-Type: {kind}\r\n\r\n".encode() + audio + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def transcribe(audio, content_type, client, post=None):
    """{text, language} for the recording. Raises TranscribeError with a status and code for every failure."""
    kind = check_audio(audio, content_type)
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key:
        raise TranscribeError(503, "not_configured", "speech to text is not configured on this server; please type instead")
    allow(client)
    data, form = multipart(audio, kind)
    try:
        status, raw = (post or _post)(API_URL, data, {"xi-api-key": key, "Content-Type": form, "Accept": "application/json", "User-Agent": "reuse-gate"}, TIMEOUT)
    except TimeoutError:
        raise TranscribeError(504, "provider_timeout", f"speech to text took longer than {TIMEOUT} seconds; please type instead") from None
    except OSError:
        raise TranscribeError(502, "provider_failed", "the speech to text service could not be reached; please type instead") from None
    if status in (401, 403):
        raise TranscribeError(503, "permission_missing", "this server's speech key is not allowed to use Speech to Text; please type instead")
    if status == 429:
        raise TranscribeError(429, "provider_busy", "the speech to text service is busy; please type instead")
    if status != 200:
        raise TranscribeError(502, "provider_failed", f"the speech to text service returned HTTP {status}; please type instead")
    try:
        value = json.loads(raw)
        text, language = value.get("text"), value.get("language_code")
    except (ValueError, AttributeError):
        raise TranscribeError(502, "provider_failed", "the speech to text service returned an unreadable answer; please type instead") from None
    text = " ".join(text.split()) if isinstance(text, str) else ""
    if not text:
        raise TranscribeError(422, "no_speech", "no speech was recognised; please try again or type instead")
    return {"text": text[:MAX_TEXT], "language": language if isinstance(language, str) else None}
