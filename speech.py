"""ElevenLabs text to speech for the Listen button.

The API has no login, so this caps text length and calls, and caches audio, to protect the account's credits.
Set ElevenLabs_API_KEY (or ELEVENLABS_API_KEY). ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL are optional.
"""
import hashlib
import json
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://api.elevenlabs.io/v1/text-to-speech"
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"
DEFAULT_MODEL = "eleven_flash_v2_5"
MAX_CHARS = 1000
TIMEOUT = 30
_lock = threading.Lock()
_calls = 0


class SpeechError(RuntimeError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _key():
    return os.environ.get("ElevenLabs_API_KEY") or os.environ.get("ELEVENLABS_API_KEY", "")


def speak(text):
    """MP3 bytes for the text. Cached by text, voice and model, so repeats cost nothing."""
    global _calls
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        raise SpeechError(400, "there is no text to speak")
    if len(text) > MAX_CHARS:
        raise SpeechError(400, f"text is longer than {MAX_CHARS} characters")
    voice = os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE)
    model = os.environ.get("ELEVENLABS_MODEL", DEFAULT_MODEL)
    cache_dir = Path(os.environ.get("LLM_CACHE_DIR", ".llm_cache")) / "speech"
    path = cache_dir / f"{hashlib.sha256(json.dumps([voice, model, text]).encode()).hexdigest()}.mp3"
    if path.exists():
        return path.read_bytes()
    if not _key():
        raise SpeechError(503, "audio is not configured on this server")
    with _lock:
        if _calls >= int(os.environ.get("SPEAK_MAX_CALLS", "50")):
            raise SpeechError(429, "the audio call budget for this server is spent")
        _calls += 1
    req = urllib.request.Request(
        f"{API_URL}/{voice}",
        data=json.dumps({"text": text, "model_id": model}).encode(),
        headers={"xi-api-key": _key(), "Content-Type": "application/json", "Accept": "audio/mpeg", "User-Agent": "reuse-gate"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as exc:
        raise SpeechError(502, f"the audio service returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SpeechError(502, "the audio service could not be reached") from exc
    if not audio:
        raise SpeechError(502, "the audio service returned no audio")
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    return audio
