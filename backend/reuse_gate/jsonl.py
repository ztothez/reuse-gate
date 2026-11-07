"""A small persistent store: one JSON object per line, one full snapshot per change, so the last line for an id wins.

Used for dashboards, config change requests and the notification outbox. A missing or read-only file never stops the
server: the store keeps working in memory.
"""
import json
import sys
import threading
from pathlib import Path


class JsonlStore:
    def __init__(self, path=None, key="id", limit=1000):
        self.path, self.key, self.limit = (Path(path) if path else None), key, limit
        self.items = {}
        self.lock = threading.Lock()
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines() if self.path and self.path.exists() else []
        except OSError as exc:
            sys.stderr.write(f"{self.path.name} not read, kept in memory: {type(exc).__name__}\n")
            lines = []
        for line in lines:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and isinstance(row.get(key), str):
                self.items[row[key]] = row

    def put(self, row):
        with self.lock:
            self.items.pop(row[self.key], None)
            self.items[row[self.key]] = row
            while len(self.items) > self.limit:
                self.items.pop(next(iter(self.items)))
            if self.path:
                try:
                    with self.path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(row, default=str) + "\n")
                except OSError as exc:
                    sys.stderr.write(f"{self.path.name} not written: {type(exc).__name__}\n")
        return row

    def get(self, key):
        return self.items.get(key) if isinstance(key, str) else None

    def all(self, keep=None):
        """Newest first."""
        rows = list(self.items.values())[::-1]
        return [r for r in rows if keep is None or keep(r)]
