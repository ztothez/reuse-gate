"""State on a volume: the decision log and work items survive a restart, samples seed an empty volume, and a missing or
read-only directory never stops the server."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

from reuse_gate import server, workitems

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "estate.db"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LogFileTest(unittest.TestCase):
    def test_load_log_skips_bad_lines_and_missing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "decision_log.jsonl"
            self.assertEqual(server.load_log(path), [])
            path.write_text('{"registered_id": "REG-1"}\nnot json\n[1]\n{"registered_id": "REG-2"}\n', encoding="utf-8")
            self.assertEqual([e["registered_id"] for e in server.load_log(path)], ["REG-1", "REG-2"])

    @unittest.skipIf(os.geteuid() == 0, "root ignores file permissions")
    def test_read_only_state_keeps_working_in_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            locked = Path(tmp) / "locked"
            locked.mkdir()
            os.chmod(locked, 0o500)
            store = server.open_store(locked / "requests.jsonl")
            item = store.create({"request_id": "WI-1", "text": "x", "intent": {"questions": []}, "loop": {"status": "clear"},
                                 "recommendation": {"action": "reuse", "target": None}, "answers": []}, request_id="WI-1")
            self.assertEqual(store.get("WI-1")["request_id"], item["request_id"])
            with patch.object(server, "LOG", []), patch.object(server, "LOG_FILE", str(locked / "decision_log.jsonl")), \
                 patch.object(server, "decision_record", lambda est, ctx: {}):
                entry = server.register_decision({"request_id": "R", "decision": "approve", "approver": "a", "owner": "o"})
                self.assertEqual(server.LOG, [entry])


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class RestartTest(unittest.TestCase):
    """The real server process, started twice on the same state directory."""

    def start(self, state):
        port = free_port()
        env = {**os.environ, "PYTHONPATH": str(ROOT / "backend"), "LLM_MODE": "rules", "REUSE_GATE_STATE_DIR": str(state),
               "RATE_LIMITS": "off", "REUSE_GATE_WRITE_TOKEN": ""}
        proc = subprocess.Popen([sys.executable, "-m", "reuse_gate.server", str(DB), str(port)], cwd=tempfile.gettempdir(), env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.addCleanup(lambda: (proc.poll() is None and proc.kill(), proc.wait(), proc.stdout.close()))
        url = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                with urllib.request.urlopen(url + "/healthz", timeout=1):
                    return proc, url
            except OSError:
                if proc.poll() is not None:
                    self.fail("server exited: " + proc.stdout.read())
                time.sleep(0.1)
        self.fail("server did not start")

    @staticmethod
    def get(url):
        with urllib.request.urlopen(url, timeout=30) as resp:
            return json.load(resp)

    @staticmethod
    def post(url, body):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)

    def test_state_survives_a_restart_and_samples_seed_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state"  # does not exist yet: an empty volume
            proc, url = self.start(state)
            items = self.get(url + "/requests")
            self.assertEqual(sum(i["origin"] == "sample" for i in items), 10)
            created = self.post(url + "/requests", {"text": "I need a dashboard for Nubeqa net sales by region in EMEA"})
            approved = self.post(url + "/approve", {"request_id": "ADHOC-1", "decision": "approve", "approver": "Ann", "owner": "Bo"})
            proc.terminate()
            proc.wait(10)

            proc, url = self.start(state)
            ids = [i["request_id"] for i in self.get(url + "/requests")]
            self.assertIn(created["request_id"], ids)
            self.assertEqual(len(ids), 11, "samples are not seeded again on a volume that has items")
            self.assertEqual([e["registered_id"] for e in self.get(url + "/log")], [approved["registered_id"]])
            self.assertTrue((state / "decision_log.jsonl").exists() and (state / "requests.jsonl").exists())

    @unittest.skipIf(os.geteuid() == 0, "root ignores file permissions")
    def test_read_only_state_dir_does_not_stop_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            locked = Path(tmp) / "locked"
            locked.mkdir()
            os.chmod(locked, 0o500)
            _, url = self.start(locked)
            self.assertTrue(self.get(url + "/healthz")["ok"])
            self.assertEqual(len(self.get(url + "/requests")), 10)
            self.assertIn("request_id", self.post(url + "/requests", {"text": "I need a dashboard for Nubeqa net sales by region in EMEA"}))


if __name__ == "__main__":
    unittest.main()
