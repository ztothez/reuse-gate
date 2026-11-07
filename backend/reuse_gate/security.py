"""API hardening in one place: CORS allow-list, security headers, per-address rate limits and secret redaction."""
import os
import re
import threading
import time
from collections import deque

LIVE_UI = "https://reuse-gate-ui-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com"
LOCAL = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d{1,5})?$")
HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
    "Strict-Transport-Security": "max-age=31536000",
}
# Requests a minute per client address on each costly route. RATE_<ROUTE> overrides, for example RATE_RECOMMEND=60.
LIMITS = {"/recommend": 30, "/requests": 30, "/speak": 10, "/remediate": 30, "/approve": 30, "/spec": 30}
SECRET_ENV = ("AITTA_API_KEY", "FEATHERLESS_API_KEY", "Featherless_AP_KEY", "ELEVENLABS_API_KEY", "N8N_API_KEY", "n8n_API_KEY",
              "REUSE_GATE_WRITE_TOKEN", "LLM_API_KEY")


def allowed_origins():
    """CORS_ORIGINS (comma separated) replaces the default: the deployed UI, and localhost on any port for development."""
    value = os.environ.get("CORS_ORIGINS", "").strip()
    return [o.strip().rstrip("/") for o in value.split(",") if o.strip()] if value else None


def cors_origin(origin):
    """The value for Access-Control-Allow-Origin, or None when the origin is not allowed. CORS_ORIGINS=* allows any."""
    listed = allowed_origins()
    if listed == ["*"]:
        return "*"
    if not origin:
        return None
    origin = origin.rstrip("/")
    if listed is not None:
        return origin if origin in listed else None
    return origin if origin == LIVE_UI or LOCAL.match(origin) else None


class RateLimiter:
    """Sliding one-minute window per (route, address). Off unless enabled, so tests and scripts are not throttled by accident."""

    def __init__(self, enabled=False, limits=None):
        self.enabled, self.limits = enabled, dict(limits or LIMITS)
        self._seen, self._lock = {}, threading.Lock()

    def limit(self, route):
        name = "RATE_" + route.strip("/").upper().replace("-", "_")
        return int(os.environ.get(name, self.limits.get(route, 0)))

    def allow(self, route, client, now=None):
        limit = self.limit(route) if self.enabled else 0
        if not limit:
            return True
        now = time.monotonic() if now is None else now
        with self._lock:
            recent = self._seen.setdefault((route, client), deque())
            while recent and now - recent[0] > 60:
                recent.popleft()
            if len(recent) >= limit:
                return False
            recent.append(now)
            if len(self._seen) > 20_000:  # forget idle clients so the table cannot grow without bound
                for key in [k for k, v in self._seen.items() if not v or now - v[-1] > 60]:
                    del self._seen[key]
        return True


def redact(text):
    """The text with every configured secret value replaced. Used on everything the server writes to its log."""
    for name in SECRET_ENV:
        value = os.environ.get(name, "")
        if len(value) >= 6:
            text = text.replace(value, "[redacted]")
    return text
