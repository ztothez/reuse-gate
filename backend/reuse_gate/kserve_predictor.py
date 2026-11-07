"""KServe v1 protocol predictor wrapping the Reuse Gate decision service.

Serves:  GET  /v1/models/<name>            readiness
         POST /v1/models/<name>:predict    {"instances": [{"text": "..."}]} -> {"predictions": [...]}
The decision logic is deterministic and cites its evidence, so it is served the same way a model would be.
Usage: PYTHONPATH=backend python3 -m reuse_gate.kserve_predictor   (env: DB_PATH, PORT, MODEL_NAME)
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from reuse_gate import server
from reuse_gate.estate import Estate

NAME = os.environ.get("MODEL_NAME", "reuse-gate")


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
            body = json.loads(self.rfile.read(n) or b"{}")
            instances = body["instances"]
            preds = []
            for inst in instances:
                text = (inst.get("text") if isinstance(inst, dict) else inst) or ""
                if len(text.strip()) < 10:
                    preds.append({"error": "describe the request in a sentence or more"})
                else:
                    preds.append(server.do_recommend(text.strip()))
            self._send(200, {"predictions": preds})
        except (KeyError, TypeError, json.JSONDecodeError):
            self._send(400, {"error": 'expected {"instances": [{"text": "..."}]}'})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server.EST = Estate(os.environ.get("DB_PATH", "data/estate.db"))
    port = int(os.environ.get("PORT", "8080"))
    print(f"KServe predictor '{NAME}' on :{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Predictor).serve_forever()
