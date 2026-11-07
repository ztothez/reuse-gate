"""KServe v1 protocol predictor wrapping the Reuse Gate decision service.

Serves:  GET  /v1/models/<name>            readiness
         POST /v1/models/<name>:predict    {"instances": [{"text": "..."}]} -> {"predictions": [...]}, a full recommendation each
                                           {"instances": [{"intent": {...}, "human_review": false}]} -> the decision for a parsed
                                           intent, with the estate snapshot. The API sends this in REUSE_GATE_DECISION_BACKEND=kserve
The decision logic is deterministic and cites its evidence, so it is served the same way a model would be.
Usage: PYTHONPATH=backend python3 -m reuse_gate.kserve_predictor   (env: DB_PATH, PORT, MODEL_NAME)
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from reuse_gate import server
from reuse_gate.decision import intent_from
from reuse_gate.estate import Estate
from reuse_gate.pipeline import decide_local
from reuse_gate.remediate import snapshot_id

NAME = os.environ.get("MODEL_NAME", "reuse-gate")
MAX_BODY = 1_000_000


def predict(inst):
    if isinstance(inst, dict) and "intent" in inst:
        return {**decide_local(server.EST, intent_from(inst["intent"]), bool(inst.get("human_review"))),
                "estate_snapshot": snapshot_id(server.EST)}
    text = (inst.get("text") if isinstance(inst, dict) else inst) or ""
    if len(text.strip()) < 10:
        return {"error": "describe the request in a sentence or more"}
    return server.do_recommend(text.strip())


class Predictor(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/healthz", "/v2/health/live", "/v2/health/ready"):
            self._send(200, {"status": "alive"})
        elif self.path == "/v1/models":
            self._send(200, {"models": [NAME]})
        elif self.path == f"/v1/models/{NAME}":
            self._send(200, {"name": NAME, "ready": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != f"/v1/models/{NAME}:predict":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self._send(413, {"error": "request body is too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
            self._send(200, {"predictions": [predict(inst) for inst in body["instances"]]})
        except (KeyError, TypeError, AttributeError, ValueError):
            self._send(400, {"error": 'expected {"instances": [{"text": "..."}]} or {"instances": [{"intent": {...}}]}'})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server.EST = Estate(os.environ.get("DB_PATH", "data/estate.db"))
    port = int(os.environ.get("PORT", "8080"))
    print(f"KServe predictor '{NAME}' on :{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Predictor).serve_forever()
