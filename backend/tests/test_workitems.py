import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from http.server import ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from reuse_gate import export_mock, server, workitems
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM
from reuse_gate.pipeline import run_request

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data/estate.db"
spec = importlib.util.spec_from_file_location("warmup", ROOT / "scripts/warmup.py")
warmup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(warmup)
FIX = {"type": "assign_owner", "target": "SM-065", "owner_id": "OWN-039"}
ONCOLOGY = "I need a dashboard comparing product performance across oncology brands and markets."
LIST_KEYS = {"request_id", "text", "status", "action", "target", "target_name", "owner", "created", "updated", "open_questions", "gates_passed", "origin"}
DETAIL_KEYS = {"request_id", "text", "status", "created", "updated", "origin", "requester", "result", "rounds", "remediation", "decision", "activity"}


class Api(unittest.TestCase):
    TOKEN = ""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.est = Estate(str(DB))
        cls.store_path = Path(cls.tmp.name) / "requests.jsonl"
        cls.patcher = patch.multiple(server, EST=cls.est, LLM_CLIENT=NoLLM(), LOG=[], LOG_FILE=str(Path(cls.tmp.name) / "log.jsonl"),
                                     STORE=workitems.Store(cls.store_path), WRITE_TOKEN=cls.TOKEN)
        cls.patcher.start()
        server.seed_samples()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patcher.stop()
        cls.tmp.cleanup()

    def call(self, path, body=None, code=None):
        headers = {"X-Access-Code": code} if code is not None else {}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}{path}", data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class WorkItemTest(Api):
    def test_samples_are_seeded_once_and_clearly_marked(self):
        code, rows = self.call("/requests")
        samples = [r for r in rows if r["origin"] == "sample"]
        self.assertEqual(code, 200)
        self.assertEqual(len(samples), 10)
        self.assertEqual({r["text"] for r in samples}, set(workitems.chip_texts(self.est)))
        self.assertTrue(all(r["request_id"].startswith("SAMPLE-") for r in samples))
        _, one = self.call("/requests/SAMPLE-07")
        self.assertEqual((one["requester"], one["activity"][0]["event"]), ("Sample user", "seeded"))
        self.assertIn("not a real business request", one["activity"][0]["detail"])
        self.assertEqual(server.seed_samples(), 0, "a store with items is never seeded again")

    def test_shapes(self):
        code, made = self.call("/requests", {"text": "Create a Nubeqa net sales dashboard for Germany.", "requester": "Riikka"})
        self.assertEqual(code, 200)
        self.assertEqual(set(made), {"request_id", "status", "result"})
        self.assertTrue(made["request_id"].startswith("WI-"))
        self.assertEqual(made["result"]["request_id"], made["request_id"])
        _, rows = self.call("/requests")
        self.assertEqual(set(rows[0]), LIST_KEYS)
        self.assertEqual(rows[0]["request_id"], made["request_id"], "newest first")
        _, one = self.call(f"/requests/{made['request_id']}")
        self.assertEqual(set(one), DETAIL_KEYS)
        self.assertEqual((one["origin"], one["requester"], one["activity"][0]["event"]), ("user", "Riikka", "created"))
        self.assertEqual(self.call("/requests/WI-NOPE")[0], 404)

    def test_filters(self):
        _, clarifying = self.call("/requests?status=clarifying")
        self.assertTrue(clarifying and all(r["status"] == "clarifying" for r in clarifying))
        _, found = self.call("/requests?q=ONCOLOGY")
        self.assertEqual([r["text"] for r in found], [ONCOLOGY])
        self.assertEqual(self.call("/requests?status=done")[0], 400)

    def test_the_loop_runs_through_the_work_item(self):
        _, made = self.call("/requests", {"text": "Nubeqa net sales report please."})
        rid, q = made["request_id"], made["result"]["intent"]["questions"][0]
        self.assertEqual(made["status"], "clarifying")
        code, again = self.call("/requests", {"request_id": rid, "answers": [{"field": q["field"], "question": q["text"], "answer": "Germany"}]})
        self.assertEqual((code, again["status"], again["result"]["intent"]["market"]), (200, "awaiting_approval", "DE"))
        self.assertEqual(again["result"]["loop"]["rounds_used"], 1, "rounds are kept server-side")
        _, one = self.call(f"/requests/{rid}")
        self.assertEqual([a["event"] for a in one["activity"]], ["created", "rechecked"])
        self.assertEqual(len(one["rounds"]), 1)

    def test_three_unusable_rounds_end_in_human_review(self):
        _, made = self.call("/requests", {"text": "Nubeqa net sales report please."})
        result = made["result"]
        for _ in range(3):
            q = result["intent"]["questions"][0]
            _, made = self.call("/requests", {"request_id": made["request_id"], "answers": result["answers"] + [{"field": q["field"], "question": q["text"], "answer": "Atlantis"}]})
            result = made["result"]
        self.assertEqual((made["status"], result["recommendation"]["action"]), ("human_review", "human_review"))

    def test_remediation_and_approval_update_the_item(self):
        _, made = self.call("/requests", {"text": ONCOLOGY})
        rid = made["request_id"]
        q = made["result"]["intent"]["questions"][0]
        self.call("/requests", {"request_id": rid, "answers": [{"field": q["field"], "question": q["text"], "answer": "yes"}]})
        code, sim = self.call("/remediate", {"request_id": rid, "remediations": [FIX], "actor": "Steward"})
        self.assertEqual((code, sim["applied"], sim["passed_after"], sim["request_id"]), (200, "simulated", True, rid))
        _, one = self.call(f"/requests/{rid}")
        self.assertEqual(one["remediation"]["applied"], "simulated")
        self.assertEqual(one["activity"][-1]["event"], "remediation_simulated")
        self.assertIn("simulated, not applied", one["activity"][-1]["detail"])
        self.assertEqual(one["status"], "awaiting_approval", "a simulation does not change status")
        code, ok = self.call("/approve", {"request_id": rid, "decision": "approve", "approver": "A", "owner": "Laura Fischer", "review_by": "2027-11-01"})
        self.assertEqual(code, 200)
        _, one = self.call(f"/requests/{rid}")
        self.assertEqual((one["status"], one["decision"]["registered_id"], one["decision"]["gates_passed"]), ("approved", ok["registered_id"], True))
        self.assertEqual(one["activity"][-1]["event"], "approved")
        _, log = self.call("/log")
        entry = next(e for e in log if e["registered_id"] == ok["registered_id"])
        self.assertEqual(entry["request_id"], rid, "the log keeps the body as sent")
        self.assertEqual(entry["record"]["intent"]["kpis"], ["Net Sales", "Net Sales Growth"])
        self.assertEqual(entry["record"]["recommendation"]["action"], "new_build")
        self.assertEqual(self.call("/approve", {"request_id": rid, "decision": "reject", "approver": "A", "owner": "B"})[0], 409)
        self.assertEqual(self.call("/requests", {"request_id": rid, "answers": []})[0], 409)

    def test_reject_sets_rejected(self):
        _, made = self.call("/requests", {"text": "Create a Nubeqa net sales dashboard for Germany."})
        self.call("/approve", {"request_id": made["request_id"], "decision": "reject", "approver": "A", "owner": "B"})
        _, rows = self.call("/requests?status=rejected")
        self.assertIn(made["request_id"], [r["request_id"] for r in rows])

    def test_old_approve_bodies_and_recommend_still_work(self):
        self.assertEqual(self.call("/approve", {"request_id": "ADHOC-1", "decision": "approve", "approver": "a", "owner": "b"})[0], 200)
        code, result = self.call("/recommend", {"text": "Create a Nubeqa net sales dashboard for Germany."})
        self.assertEqual(code, 200)
        self.assertTrue(result["request_id"].startswith("ADHOC-"))
        self.assertNotIn(result["request_id"], {r["request_id"] for r in self.call("/requests")[1]}, "/recommend creates no work item")

    def test_bad_bodies(self):
        for body in ({}, {"text": ""}, {"text": 5}, {"text": "abc def ghi", "answers": "x"}, {"text": "abc def ghi", "rounds": [1]}):
            with self.subTest(body):
                self.assertEqual(self.call("/requests", body)[0], 400)
        self.assertEqual(self.call("/requests", {"request_id": "WI-NOPE"})[0], 404)

    def test_cors_allows_the_access_code_header(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.httpd.server_port}/approve", method="OPTIONS", headers={"Origin": "http://localhost:8080"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            self.assertIn("X-Access-Code", resp.headers["Access-Control-Allow-Headers"])
            self.assertEqual(resp.headers["Access-Control-Allow-Origin"], "http://localhost:8080")


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class WriteTokenTest(Api):
    TOKEN = "s3cret-code"

    def test_writes_need_the_code_and_reads_stay_open(self):
        _, made = self.call("/requests", {"text": "Create a Nubeqa net sales dashboard for Germany."})
        rid = made["request_id"]
        approve = {"request_id": rid, "decision": "approve", "approver": "A", "owner": "B"}
        for code in (None, "", "wrong", "s3cret-cod", "s3cret-code "):
            with self.subTest(code=code):
                self.assertEqual(self.call("/approve", approve, code)[0], 401)
                self.assertEqual(self.call("/remediate", {"request_id": rid, "remediations": [FIX]}, code)[0], 401)
                self.assertEqual(self.call("/requests", {"request_id": rid, "answers": []}, code)[0], 401)
        self.assertEqual(self.call("/requests", {"request_id": rid, "answers": []}, self.TOKEN)[0], 200)
        self.assertEqual(self.call("/approve", approve, self.TOKEN)[0], 200)
        for path in ("/requests", f"/requests/{rid}", "/log", "/radar", "/owners"):
            self.assertEqual(self.call(path)[0], 200, path)
        self.assertEqual(self.call("/requests", {"text": "Create a Nubeqa net sales dashboard for Germany."})[0], 200, "creating stays open")
        self.assertEqual(self.call("/recommend", {"text": "Create a Nubeqa net sales dashboard."})[0], 200)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class StoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def result(self, text="Create a Nubeqa net sales dashboard for Germany.", rid="WI-1"):
        req = {"request_id": rid, "request_text": text, "product_context": self.est.all_scope, "market_context": None}
        return run_request(self.est, req, NoLLM(), as_of="2026-11-07")

    def test_persists_and_reloads_the_last_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "requests.jsonl"
            store = workitems.Store(path)
            store.create(self.result(rid="WI-A"), request_id="WI-A")
            store.update("WI-A", self.result(rid="WI-A"))
            with open(path, "a", encoding="utf-8") as f:
                f.write('{"torn": ')
            again = workitems.Store(path)
            self.assertEqual([a["event"] for a in again.get("WI-A")["activity"]], ["created", "rechecked"])

    def test_caps_items_and_drops_the_oldest_for_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "requests.jsonl"
            store = workitems.Store(path, max_items=3)
            result = self.result()
            for n in range(5):
                store.create({**result, "request_id": f"WI-{n}"}, request_id=f"WI-{n}", time=f"2026-11-07T0{n}:00:00+00:00")
            self.assertEqual(sorted(store.items), ["WI-2", "WI-3", "WI-4"])
            self.assertEqual(sorted(workitems.Store(path, max_items=3).items), ["WI-2", "WI-3", "WI-4"])
            self.assertEqual(workitems.MAX_ITEMS, 500)

    def test_list_is_capped_at_200(self):
        store, result = workitems.Store(), self.result()
        for n in range(205):
            store.create(result, request_id=f"WI-{n:03d}", time="2026-11-07T00:00:00+00:00")
        self.assertEqual(len(store.list()), workitems.MAX_LIST)

    def test_status_follows_the_result(self):
        self.assertEqual(workitems.status_of(self.result()), "awaiting_approval")
        self.assertEqual(workitems.status_of(self.result("Nubeqa net sales report please.")), "clarifying")
        self.assertEqual(workitems.status_of(self.result("Create a net sales dashboard for Zyntrex in Germany.")), "clarifying")
        self.assertEqual(workitems.status_of(self.result("Please reuse AST-0002 for our launch review.")), "clarifying", "questions come first")
        req = next(r for r in self.est.requests if r["request_id"] == "REQ-0002")
        self.assertEqual(workitems.status_of(run_request(self.est, req, NoLLM(), as_of=req["request_date"])), "human_review")

    def test_seeding_never_calls_a_model(self):
        store = workitems.Store()
        client = workitems.SavedAnswersOnly()
        with patch.object(workitems.SavedAnswersOnly, "parse_intent", side_effect=AssertionError("model call")):
            n = store.seed(self.est, lambda req: run_request(self.est, req, client, as_of="2026-11-07"), workitems.chip_texts(self.est))
        self.assertEqual(n, 10)

    def test_mock_export_has_the_work_items(self):
        mock = json.loads((ROOT / "data/mock_api.json").read_text(encoding="utf-8"))
        fresh = json.loads(json.dumps(export_mock.sample_work_items(self.est), default=str))
        self.assertEqual(mock["work_items"], fresh)
        self.assertEqual(len(mock["work_items"]["list"]), 10)
        self.assertEqual(set(mock["work_items"]["list"][0]), LIST_KEYS)
        self.assertEqual(set(next(iter(mock["work_items"]["detail"].values()))), DETAIL_KEYS)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class WarmupTest(Api):
    def test_warmup_reads_the_work_items(self):
        url = f"http://127.0.0.1:{self.httpd.server_port}"
        with redirect_stdout(StringIO()) as printed:
            self.assertTrue(warmup.warm_requests(url))
            self.assertFalse(warmup.warm_requests("http://127.0.0.1:9"))
        self.assertIn("10 sample(s)", printed.getvalue())


if __name__ == "__main__":
    unittest.main()
