"""Where the deterministic decision runs: in this process, or on the KServe InferenceService reuse-gate-kserve.

REUSE_GATE_DECISION_BACKEND=local (default) decides in the API process. =kserve sends the parsed intent to the InferenceService
over the KServe v1 protocol and uses its decision; any failure decides locally instead, and the result says so.
Env: REUSE_GATE_KSERVE_URL (cluster internal URL), REUSE_GATE_KSERVE_MODEL, REUSE_GATE_KSERVE_TIMEOUT_S.
Models never take part: the intent is parsed before, and the explanation is written after, in the API.
"""
import http.client
import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import fields

from reuse_gate.recommend import Intent, Question

DEFAULT_MODEL = "reuse-gate-kserve"
HEALTH_TTL = 30  # seconds a reachability check is reused, so probes do not call KServe every time
_health = {"at": 0.0, "url": None, "value": None}
_health_lock = threading.Lock()


def mode():
    return "kserve" if os.environ.get("REUSE_GATE_DECISION_BACKEND", "local").strip().lower() == "kserve" else "local"


def kserve_url():
    return os.environ.get("REUSE_GATE_KSERVE_URL", "").strip().rstrip("/")


def kserve_model():
    return os.environ.get("REUSE_GATE_KSERVE_MODEL", "").strip() or DEFAULT_MODEL


def kserve_timeout():
    return float(os.environ.get("REUSE_GATE_KSERVE_TIMEOUT_S", "5"))


def intent_json(intent):
    """The parsed intent as plain JSON. Clarifications keep the field they fill and why it is unclear."""
    value = json.loads(json.dumps({f.name: getattr(intent, f.name) for f in fields(intent) if f.name != "clarifications"}, default=list))
    value["clarifications"] = [{"text": str(q), "field": getattr(q, "field", "model"), "basis": getattr(q, "basis", "assumed")}
                               for q in intent.clarifications]
    return value


def intent_from(value):
    """Rebuild an Intent sent by intent_json. Raises KeyError or TypeError on a malformed one."""
    fields = {k: value[k] for k in Intent.__dataclass_fields__ if k in value}
    fields["clarifications"] = [Question(c["field"], c["text"], c.get("basis", "assumed")) if isinstance(c, dict) else c
                                for c in value.get("clarifications") or []]
    return Intent(**fields)


class KServeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _post(url, body, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def remote(est, intent, human_review, post=None):
    """The decision from reuse-gate-kserve. Raises KServeError with a short code on any failure."""
    base = kserve_url()
    if not base:
        raise KServeError("not_configured")
    body = {"instances": [{"intent": intent_json(intent), "human_review": human_review}]}
    try:
        reply = (post or _post)(f"{base}/v1/models/{kserve_model()}:predict", body, kserve_timeout())
    except urllib.error.HTTPError as exc:
        code = exc.code
        exc.close()
        raise KServeError(f"http_{code}") from None
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
        slow = isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError)
        raise KServeError("timeout" if slow else "unreachable") from exc
    except ValueError as exc:
        raise KServeError("bad_response") from exc
    try:
        pred = reply["predictions"][0]
        ok = isinstance(pred["recommendation"], dict) and isinstance(pred["intent"], dict) and pred["request_id"] == intent.request_id
    except (KeyError, IndexError, TypeError):
        ok = False
    if not ok:
        raise KServeError("bad_response")
    from reuse_gate.remediate import snapshot_id  # remediate imports the pipeline, which imports this module
    if pred.pop("estate_snapshot", None) != snapshot_id(est):
        raise KServeError("estate_mismatch")  # a predictor on other data must not decide for this API
    return pred


def decide(est, intent, human_review, local, post=None):
    """(decision, backend, reason). local(est, intent, human_review) decides in this process."""
    if mode() != "kserve":
        return local(est, intent, human_review), "local", None
    try:
        return remote(est, intent, human_review, post), "kserve", None
    except KServeError as exc:
        return local(est, intent, human_review), "local_fallback", exc.code


def health(get=None):
    """Which backend is active and whether the KServe endpoint answers. Cached for HEALTH_TTL seconds; never raises."""
    base, name = kserve_url(), kserve_model()
    out = {"decision_backend": mode(), "kserve": {"url": base or None, "model": name, "reachable": None}}
    if not base:
        return out
    with _health_lock:
        if _health["url"] == base and time.monotonic() - _health["at"] < HEALTH_TTL:
            out["kserve"]["reachable"] = _health["value"]
            return out
    try:
        if get:
            reachable = bool(get(f"{base}/v1/models/{name}"))
        else:
            with urllib.request.urlopen(f"{base}/v1/models/{name}", timeout=2) as resp:
                reachable = bool(json.load(resp).get("ready"))
    except Exception:
        reachable = False
    with _health_lock:
        _health.update(at=time.monotonic(), url=base, value=reachable)
    out["kserve"]["reachable"] = reachable
    return out
