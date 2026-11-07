"""Reuse Gate API. Standard library only, so it runs anywhere with Python 3.10+.

Usage: PYTHONPATH=backend python3 -m reuse_gate.server data/estate.db [port]      (default port 8000)

POST /recommend  {"text": "...", "answers": [...]}      -> recommendation item (same shape as mock_api.json)
POST /speak      {"text": "..."}                       -> audio/mpeg from ElevenLabs, capped and cached
POST /spec       {intent, recommendation, owner, review_by} -> {spec, gates}
GET  /radar                                            -> radar summary, with ownership_bottlenecks
GET  /owners                                           -> active owners who can be assigned, Semantic Model Owners first
POST /remediate  {request_id | intent, remediations: [{type: assign_owner, target, owner_id}], owner?, review_by?, as_of?}
                                                       -> simulated before and after gates. Never changes the estate
POST /approve    {request_id, decision, approver, owner, review_by, text?, intent?, rounds?, remediations?, ...}
                                                       -> stores the body plus a server-built record (decision, gates, estate hash)
GET  /log                                              -> approvals recorded by this process
GET  /health
GET  /n8n/radar-digest
POST /radar-ping                                       -> same digest with no key, for a Knative PingSource. Read-only, ignores the body
POST /n8n/approval
"""
import json
import hmac
import os
import sys
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from reuse_gate.estate import DEFAULT_CATALOG, Estate
from reuse_gate.export_mock import radar
from reuse_gate.llm import live_client, load_env
from reuse_gate.pipeline import run_request
from reuse_gate.remediate import RemediationError, active_owners, decision_record, simulate
from reuse_gate.spec import build_spec
from reuse_gate.spec_gate import check
from reuse_gate.speech import SpeechError, speak

EST = None
LOG = []
LOG_FILE = "decision_log.jsonl"
LLM_CLIENT = None
N8N_API_KEY = os.environ.get("N8N_API_KEY", "")
MAX_BODY = 1_000_000


def do_recommend(text, answers=None, rounds=None):
    req = {"request_id": "ADHOC-" + uuid.uuid4().hex[:6].upper(), "request_text": text,
           "product_context": EST.all_scope, "market_context": None}
    return run_request(EST, req, LLM_CLIENT, answers=answers, rounds=rounds)


def register_decision(body):
    entry = {**body, "registered_id": "REG-" + uuid.uuid4().hex[:8].upper(),
             "time": datetime.now(timezone.utc).isoformat(), "record": decision_record(EST, body)}
    LOG.append(entry)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


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
    def _send(self, code, body):
        data = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def _send_audio(self, audio):
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(audio)

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

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "assets": len(EST.assets)})
        elif self.path == "/radar":
            self._send(200, radar(EST))
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

    def do_POST(self):
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
            if self.path == "/remediate":
                try:
                    return self._send(200, simulate(EST, body))
                except RemediationError as exc:
                    return self._send(400, {"error": str(exc), "applied": "nothing"})
            if self.path == "/approve":
                missing = [k for k in ("request_id", "decision", "approver", "owner") if not body.get(k)]
                if missing or body["decision"] not in ("approve", "reject"):
                    return self._send(400, {"error": f"missing or invalid: {missing or 'decision'}"})
                entry = register_decision(body)
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

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    load_env()
    N8N_API_KEY = os.environ.get("N8N_API_KEY") or os.environ.get("n8n_API_KEY", "")
    EST = Estate(sys.argv[1], os.environ.get("CATALOG_PATH", DEFAULT_CATALOG))
    LLM_CLIENT = live_client()
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    print(f"Reuse Gate API on http://0.0.0.0:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
