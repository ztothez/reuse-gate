"""Smoke test: runs the eval harness against a fake OpenAI-compatible server."""
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import eval_runner


class FakeLLM(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        question = req["messages"][-1]["content"]
        text = "Net revenue comes from the approved metric list." if "revenue" in question else "unknown"
        body = json.dumps({"choices": [{"message": {"content": text}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class SmokeTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), FakeLLM)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        os.environ["LLM_BASE_URL"] = f"http://127.0.0.1:{self.server.server_port}/v1"
        os.environ["LLM_MODEL"] = "fake"
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        self.server.shutdown()

    def run_cases(self, text):
        cases = self.tmp / "cases.jsonl"
        cases.write_text(text, encoding="utf-8")
        return eval_runner.main([str(cases), "--out", str(self.tmp / "report.json")])

    def test_passing_cases(self):
        code = self.run_cases(Path("cases.example.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(code, 0)

    def test_failing_case_returns_nonzero(self):
        code = self.run_cases('{"id": "bad", "question": "What is net revenue?", "must_contain": ["xyz"]}\n')
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
