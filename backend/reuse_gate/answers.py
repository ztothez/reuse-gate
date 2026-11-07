"""LLM answers cached by a hash of the normalized request text.

data/prewarmed_answers.json holds the UI's example requests, so they answer with no model call. Other requests are
saved under .llm_cache/answers after a model answers them. Saved values still pass the allow list on every read.
"""
import hashlib
import json
import os
import threading
from pathlib import Path

PREWARMED = Path(__file__).resolve().parents[2] / "data" / "prewarmed_answers.json"


def normalize(text):
    return " ".join(text.split()).casefold()


def key(text):
    return hashlib.sha256(normalize(text).encode()).hexdigest()


class AnswerStore:
    def __init__(self, prewarmed=PREWARMED, cache_dir=None):
        self.cache_dir = Path(cache_dir or os.environ.get("LLM_CACHE_DIR", ".llm_cache")) / "answers"
        self._lock = threading.Lock()
        try:
            self.entries = json.loads(Path(prewarmed).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.entries = {}

    def get(self, text):
        k = key(text)
        with self._lock:
            if k in self.entries:
                return self.entries[k]
        try:
            entry = json.loads((self.cache_dir / f"{k}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        with self._lock:
            self.entries[k] = entry
        return entry

    def _save(self, text, **fields):
        k = key(text)
        with self._lock:
            entry = {**self.entries.get(k, {}), "text": normalize(text), **fields}
            self.entries[k] = entry
        try:  # a read-only disk only loses the cache, never the answer
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            (self.cache_dir / f"{k}.json").write_text(json.dumps(entry), encoding="utf-8")
        except OSError:
            pass

    def intent(self, text):
        return (self.get(text) or {}).get("intent")

    def model(self, text):
        return (self.get(text) or {}).get("model")

    def explanation(self, text, action, target):
        """The saved explanation, only if it was written for this same decision."""
        entry = self.get(text) or {}
        if entry.get("action") == action and entry.get("target") == target:
            return entry.get("explanation")
        return None

    def put_intent(self, text, value, model):
        self._save(text, intent=value, model=model)

    def put_explanation(self, text, action, target, explanation):
        self._save(text, action=action, target=target, explanation=explanation)
