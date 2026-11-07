"""Reuse Gate API. Standard library only, so it runs anywhere with Python 3.10+.

Usage: PYTHONPATH=backend python3 -m reuse_gate.server data/estate.db [port]      (default port 8000)

POST /recommend  {"text": "...", "answers": [...]}      -> recommendation item (same shape as mock_api.json)
POST /speak      {"text": "..."}                       -> audio/mpeg from ElevenLabs, capped and cached
POST /transcribe raw audio body, Content-Type audio/webm|ogg|mp4|wav, at most 1 MB -> {text, language}. Not stored or logged
POST /spec       {intent, recommendation, owner, review_by} -> {spec, gates}
GET  /radar                                            -> radar summary, with ownership_bottlenecks
GET  /evaluation                                       -> data/evaluation.json, written by scripts/eval_quality.py
GET  /owners                                           -> active owners who can be assigned, Semantic Model Owners first
POST /remediate  {request_id | intent, remediations: [{type: assign_owner, target, owner_id}], owner?, review_by?, as_of?}
                                                       -> simulated before and after gates. Never changes the estate
POST /requests   {text, answers?, rounds?, request_id?, requester?}   -> {request_id, status, result}. Creates, or re-checks a work item
GET  /requests?status=&q=                              -> work items, newest first, at most 200
GET  /requests/{id}                                    -> one work item with its result, rounds, remediation, decision and activity
POST /approve    {request_id, decision, approver, owner, review_by, text?, intent?, rounds?, remediations?, ...}
                                                       -> stores the body plus a server-built record (decision, gates, estate hash)
GET  /log                                              -> approvals recorded by this process
With REUSE_GATE_WRITE_TOKEN set, POST /approve, /remediate and work item re-checks need a matching X-Access-Code header.
GET  /health, /healthz                                 -> ok, the decision backend in use and whether reuse-gate-kserve answers
GET  /n8n/radar-digest
POST /radar-ping                                       -> same digest with no key, for a Knative PingSource. Read-only, ignores the body
POST /n8n/approval
"""
import json
import hmac
from http import HTTPStatus
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from reuse_gate.estate import DEFAULT_CATALOG, Estate
from reuse_gate.export_mock import radar
from reuse_gate.llm import live_client, load_env
from reuse_gate.pipeline import run_request
from reuse_gate import decision, security, workitems
from reuse_gate.answers import AnswerStore
from reuse_gate.remediate import RemediationError, active_owners, decision_record, simulate
from reuse_gate.spec import build_spec
from reuse_gate.spec_gate import check
from reuse_gate.speech import SpeechError, speak
from reuse_gate.transcribe import MAX_BYTES as MAX_AUDIO, TranscribeError, transcribe

EST = None
LOG = []
LOG_FILE = "decision_log.jsonl"
LLM_CLIENT = None
N8N_API_KEY = os.environ.get("N8N_API_KEY", "")
EVALUATION = Path(__file__).resolve().parents[2] / "data" / "evaluation.json"
WRITE_TOKEN = os.environ.get("REUSE_GATE_WRITE_TOKEN", "")
MAX_BODY = 1_000_000
STORE = workitems.Store()  # replaced at startup by a store next to the decision log
LIMITER = security.RateLimiter()  # enabled at startup; off in tests unless a test turns it on


def do_recommend(text, answers=None, rounds=None):
    req = {"request_id": "ADHOC-" + uuid.uuid4().hex[:6].upper(), "request_text": text,
           "product_context": EST.all_scope, "market_context": None}
    return run_request(EST, req, LLM_CLIENT, answers=answers, rounds=rounds)


def register_decision(body, context=None):
    """context adds what the server knows about a work item to the record. The body is stored as sent."""
    entry = {**body, "registered_id": "REG-" + uuid.uuid4().hex[:8].upper(),
             "time": datetime.now(timezone.utc).isoformat(), "record": decision_record(EST, context or body)}
    LOG.append(entry)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def write_authorized(handler):
    """Open when no token is set. Otherwise X-Access-Code must match, compared in constant time."""
    if not WRITE_TOKEN:
        return True
    return hmac.compare_digest(handler.headers.get("X-Access-Code", "").encode(), WRITE_TOKEN.encode())


def with_item(body):
    """The work item a body names, and the body with that item's intent, rounds and text filled in where missing."""
    item = STORE.get(body.get("request_id")) if isinstance(body.get("request_id"), str) else None
    if not item:
        return None, body
    known = {"intent": workitems.intent_of(item), "rounds": item["rounds"], "text": item["text"]}
    return item, {**{k: v for k, v in known.items() if k not in body}, **body, "request_id": None}


def run_item(request_id, text, answers, rounds):
    req = {"request_id": request_id, "request_text": text, "product_context": EST.all_scope, "market_context": None}
    return run_request(EST, req, LLM_CLIENT, answers=answers, rounds=rounds)


def seed_samples():
    answers = getattr(LLM_CLIENT, "answers", None) or AnswerStore()
    client = workitems.SavedAnswersOnly(answers)
    return STORE.seed(EST, lambda req: run_request(EST, req, client), workitems.chip_texts(EST))


def n8n_authorized(handler):
    supplied = handler.headers.get("X-N8N-API-Key", "")
    return bool(N8N_API_KEY) and hmac.compare_digest(supplied, N8N_API_KEY)


def radar_digest():
    summary = radar(EST)
    totals = summary["totals"]
    return {
        "subject": "Reuse Gate radar digest",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": (
            f"{totals['ownerless']} ownerless assets, "
            f"{totals['high_reach_uncertified']} high-reach uncertified assets, "
            f"{totals['dead_or_unused']} assets to retire or review."
        ),
        "totals": totals,
        "retire_or_review": summary["dead_assets"],
        "ownerless": summary["ownerless_assets"],
        "high_reach_uncertified": summary["high_reach_uncertified"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version, sys_version = "reuse-gate", ""  # no Python version in the Server header

    def version_string(self):
        return self.server_version

    def _common_headers(self):
        headers = getattr(self, "headers", None)  # absent when the request line itself could not be parsed
        origin = security.cors_origin(headers.get("Origin") if headers else None)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Access-Code")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")
        for name, value in security.HEADERS.items():
            self.send_header(name, value)

    def _send(self, code, body):
        data = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._common_headers()
        self.end_headers()
        self.wfile.write(data)

    def _send_audio(self, audio):
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self._common_headers()
        self.end_headers()
        self.wfile.write(audio)

    def send_error(self, code, message=None, explain=None):
        """http.server's own errors (bad request line, oversized headers) as short JSON, never an HTML page."""
        self.close_connection = True
        try:
            self._send(code, {"error": (message or HTTPStatus(code).phrase)[:200]})
        except OSError:
            pass

    def _not_allowed(self):
        self._send(405, {"error": f"method {self.command} is not allowed; use GET, POST or OPTIONS"})

    do_PUT = do_DELETE = do_PATCH = do_TRACE = do_CONNECT = do_HEAD = _not_allowed

    def _guarded(self, handler):
        """Any unexpected failure answers 500 with no detail. The log gets the exception type only, never a traceback or a value."""
        try:
            handler()
        except Exception as exc:
            sys.stderr.write(f"{self.command} {urlsplit(self.path).path} failed: {type(exc).__name__}\n")
            try:
                self._send(500, {"error": "internal error"})
            except OSError:
                pass

    def do_GET(self):
        self._guarded(self._get)

    def do_POST(self):
        route = urlsplit(self.path).path
        if route in security.LIMITS and not LIMITER.allow(route, self._client()):
            self._drain()
            return self._send(429, {"error": "too many requests from this address; wait a minute", "code": "rate_limited"})
        self._guarded(self._post)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("request body is too large")
        body = json.loads(self.rfile.read(n) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("request body must be a JSON object")
        return body

    def do_OPTIONS(self):
        self._send(204, {})

    def _get(self):
        url = urlsplit(self.path)
        if url.path == "/requests":
            query = parse_qs(url.query)
            status, q = (query.get("status") or [None])[0], (query.get("q") or [None])[0]
            if status and status not in workitems.STATUSES:
                return self._send(400, {"error": f"status must be one of {', '.join(workitems.STATUSES)}"})
            return self._send(200, STORE.list(status, q))
        if url.path.startswith("/requests/"):
            item = STORE.get(url.path[len("/requests/"):])
            return self._send(200, workitems.detail(item)) if item else self._send(404, {"error": "no such request"})
        if self.path in ("/health", "/healthz"):  # always 200 while the process serves, so probes never fail on KServe
            self._send(200, {"ok": True, "assets": len(EST.assets), **decision.health()})
        elif self.path == "/radar":
            self._send(200, radar(EST))
        elif self.path == "/evaluation":
            try:
                self._send(200, json.loads(EVALUATION.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                self._send(404, {"error": "no evaluation on this server; run scripts/eval_quality.py"})
        elif self.path == "/owners":
            self._send(200, active_owners(EST))
        elif self.path == "/log":
            self._send(200, LOG)
        elif self.path == "/n8n/radar-digest":
            if not n8n_authorized(self):
                return self._send(401, {"error": "n8n API key required"})
            self._send(200, radar_digest())
        else:
            self._send(404, {"error": "not found"})

    def _drain(self):
        """Read and discard the body, so closing the connection cannot lose the response."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return
        if n > 0:
            self.rfile.read(min(n, MAX_BODY))

    def _client(self):
        """The address the OpenShift router saw: the last X-Forwarded-For entry, which the router appends. A client cannot forge it."""
        forwarded = [p.strip() for p in self.headers.get("X-Forwarded-For", "").split(",") if p.strip()]
        return forwarded[-1] if forwarded else self.client_address[0]

    def _transcribe(self):
        """POST /transcribe. The audio is read, sent on, and dropped; nothing about it is logged."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0:
            return self._send(400, {"error": "Content-Length is required", "code": "empty_audio"})
        if n > MAX_AUDIO:
            self._drain()
            return self._send(413, {"error": f"the recording is larger than {MAX_AUDIO // 1024} KB", "code": "too_large"})
        audio = self.rfile.read(n) if n else b""
        try:
            return self._send(200, transcribe(audio, self.headers.get("Content-Type"), self._client()))
        except TranscribeError as exc:
            return self._send(exc.status, exc.body())

    def _post(self):
        if self.path == "/transcribe":
            return self._transcribe()
        if self.path == "/radar-ping":  # a PingSource cannot send the n8n key; this exposes nothing beyond GET /radar
            self._drain()
            return self._send(200, radar_digest())
        try:
            body = self._body()
            if self.path == "/recommend":
                text = body.get("text", "")
                if not isinstance(text, str):
                    return self._send(400, {"error": "text must be a string"})
                answers = body.get("answers", [])
                if not isinstance(answers, list) or not all(isinstance(a, dict) and isinstance(a.get("answer", ""), str) for a in answers):
                    return self._send(400, {"error": "answers must be a list of objects with a text answer"})
                rounds = body.get("rounds", [])
                if not isinstance(rounds, list) or not all(isinstance(r, dict) for r in rounds):
                    return self._send(400, {"error": "rounds must be a list of objects"})
                return self._send(200, do_recommend(text.strip(), answers, rounds))
            if self.path == "/speak":
                try:
                    return self._send_audio(speak(body.get("text")))
                except SpeechError as exc:
                    return self._send(exc.status, {"error": str(exc)})
            if self.path == "/requests":
                return self._requests(body)
            if self.path == "/remediate":
                if not write_authorized(self):
                    return self._send(401, {"error": "access code required"})
                item, context = with_item(body)
                try:
                    response = simulate(EST, context)
                except RemediationError as exc:
                    return self._send(400, {"error": str(exc), "applied": "nothing"})
                if item:
                    response["request_id"] = item["request_id"]
                    STORE.remediated(item["request_id"], response, body.get("actor"))
                return self._send(200, response)
            if self.path == "/approve":
                if not write_authorized(self):
                    return self._send(401, {"error": "access code required"})
                missing = [k for k in ("request_id", "decision", "approver", "owner") if not body.get(k)]
                if missing or body["decision"] not in ("approve", "reject"):
                    return self._send(400, {"error": f"missing or invalid: {missing or 'decision'}"})
                item, context = with_item(body)
                if item and item["status"] in ("approved", "rejected"):
                    return self._send(409, {"error": f"{item['request_id']} is already {item['status']}"})
                entry = register_decision(body, context)
                if item:
                    STORE.decide(item["request_id"], entry)
                return self._send(200, {"ok": True, "registered_id": entry["registered_id"]})
            if self.path == "/n8n/approval":
                if not n8n_authorized(self):
                    return self._send(401, {"error": "n8n API key required"})
                missing = [k for k in ("request_id", "decision", "approver", "owner") if not body.get(k)]
                if missing or body["decision"] not in ("approve", "reject"):
                    return self._send(400, {"error": f"missing or invalid: {missing or 'decision'}"})
                entry = register_decision(body)
                return self._send(200, {"ok": True, "registered_id": entry["registered_id"], "source": "n8n"})
            if self.path == "/spec":
                try:
                    spec = build_spec(body.get("intent") or {}, body.get("recommendation") or {}, EST,
                                      owner=body.get("owner"), review_date=body.get("review_by"))
                    return self._send(200, {"spec": spec, "gates": check(EST, spec)})
                except (KeyError, TypeError, AttributeError) as exc:
                    return self._send(400, {"error": f"invalid intent or recommendation: {exc}"})
            self._send(404, {"error": "not found"})
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid JSON"})
        except ValueError as exc:
            self._send(400, {"error": str(exc)})

    def _requests(self, body):
        """POST /requests: create a work item, or re-check one. Answers are sent in full, as with /recommend."""
        rid = body.get("request_id")
        answers, rounds, text = body.get("answers"), body.get("rounds"), body.get("text")
        if answers is not None and (not isinstance(answers, list) or not all(isinstance(a, dict) and isinstance(a.get("answer", ""), str) for a in answers)):
            return self._send(400, {"error": "answers must be a list of objects with a text answer"})
        if rounds is not None and (not isinstance(rounds, list) or not all(isinstance(r, dict) for r in rounds)):
            return self._send(400, {"error": "rounds must be a list of objects"})
        if text is not None and not isinstance(text, str):
            return self._send(400, {"error": "text must be a string"})
        requester = body.get("requester") if isinstance(body.get("requester"), str) else None
        if rid is None:
            if not (text or "").strip():
                return self._send(400, {"error": "text is required"})
            new = workitems.new_id()
            item = STORE.create(run_item(new, text.strip(), answers or [], rounds or []), requester and requester[:100], request_id=new)
            return self._send(200, {"request_id": item["request_id"], "status": item["status"], "result": item["result"]})
        if not write_authorized(self):
            return self._send(401, {"error": "access code required"})
        item = STORE.get(rid) if isinstance(rid, str) else None
        if not item:
            return self._send(404, {"error": "no such request"})
        if item["status"] in ("approved", "rejected"):
            return self._send(409, {"error": f"{rid} is already {item['status']}; submit a new request"})
        result = run_item(rid, (text or item["text"]).strip(), item["answers"] if answers is None else answers, item["rounds"] if rounds is None else rounds)
        item = STORE.update(rid, result, requester and requester[:100])
        return self._send(200, {"request_id": rid, "status": item["status"], "result": result})

    def log_message(self, fmt, *args):
        """The request line and status only. Bodies are never logged, and any configured secret value is redacted."""
        sys.stderr.write(security.redact("%s %s\n" % (self.address_string(), fmt % args)))


if __name__ == "__main__":
    load_env()
    N8N_API_KEY = os.environ.get("N8N_API_KEY") or os.environ.get("n8n_API_KEY", "")
    EST = Estate(sys.argv[1], os.environ.get("CATALOG_PATH", DEFAULT_CATALOG))
    LLM_CLIENT = live_client()
    WRITE_TOKEN = os.environ.get("REUSE_GATE_WRITE_TOKEN", "")
    if not WRITE_TOKEN:
        print("WARNING: REUSE_GATE_WRITE_TOKEN is not set, so approve, remediate and work item updates are open to anyone", file=sys.stderr)
    STORE = workitems.Store(Path(LOG_FILE).parent / "requests.jsonl")
    LIMITER = security.RateLimiter(enabled=os.environ.get("RATE_LIMITS", "on") != "off")
    seeded = seed_samples()
    if seeded:
        print(f"Seeded {seeded} sample work items")
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    print(f"Reuse Gate API on http://0.0.0.0:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
