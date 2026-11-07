import copy
import csv
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from http.server import ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from reuse_gate import faithfulness, server
from reuse_gate.answers import AnswerStore
from reuse_gate.estate import Estate
from reuse_gate.llm import NoLLM
from reuse_gate.pipeline import run_request

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data/estate.db"
sys.path.insert(0, str(ROOT / "scripts"))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"scripts/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


eval_quality, score_gold = load("eval_quality"), load("score_gold")
METRIC_KEYS = {"id", "name", "value", "unit", "n", "method", "basis", "caveat"}


class Explaining:
    """A configured client that reads intents and explains with fixed text; explanations are what the guard checks."""
    configured, last_model = True, "fake-model"

    def __init__(self, lines, intent):
        self.lines, self.intent, self.answers = lines, intent, None

    def parse_intent(self, *args):
        return self.intent

    def explain(self, *args):
        return self.lines


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class GuardTest(unittest.TestCase):
    INTENT = {"products": ["Nubeqa"], "market": None, "kpis": ["Net Sales Growth", "Forecast Variance", "Market Access Coverage"], "kind": "new_report", "clarifications": []}
    TEXT = "Create a global Nubeqa dashboard showing sales growth, forecast variance and market access by country."

    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def run_with(self, lines):
        req = {"request_id": "G", "request_text": self.TEXT, "product_context": self.est.all_scope, "market_context": None}
        return run_request(self.est, req, Explaining(lines, self.INTENT), as_of="2026-11-07")

    def test_a_faithful_explanation_is_shown(self):
        rules = run_request(self.est, {"request_id": "G", "request_text": self.TEXT, "product_context": self.est.all_scope, "market_context": None}, NoLLM(), as_of="2026-11-07")
        target = rules["recommendation"]["target"]
        line = f"We will {rules['recommendation']['action'].replace('_', ' ')} {target['name']} ({target['id']}), which covers Net Sales Growth."
        out = self.run_with([line])
        self.assertEqual((out["ai"]["guard"], out["ai"]["explanation_source"], out["ai"]["explanation"]), ("passed", "llm", [line]))

    def test_an_invented_fact_is_replaced_by_the_rules_explanation(self):
        for bad in ("Extend AST-0999, the certified report.", "It had 987654 views last quarter.", "It also covers Units Shipped."):
            with self.subTest(bad):
                out = self.run_with([bad])
                self.assertEqual((out["ai"]["guard"], out["ai"]["explanation_source"]), ("replaced", "rules"))
                self.assertEqual(out["ai"]["explanation"], out["recommendation"]["rationale"])
                self.assertTrue(out["ai"]["guard_unsupported"])
                self.assertNotIn(bad, out["ai"]["speech"])

    def test_the_guard_never_changes_the_decision(self):
        good, bad = self.run_with(["We will build on governed data."]), self.run_with(["Extend AST-0999."])
        self.assertEqual(good["recommendation"], bad["recommendation"])

    def test_unicode_hyphens_in_ids_are_read(self):
        rules = run_request(self.est, {"request_id": "G", "request_text": self.TEXT, "product_context": self.est.all_scope, "market_context": None}, NoLLM())
        aid = rules["recommendation"]["target"]["id"]
        self.assertTrue(faithfulness.check(self.est, rules, [aid.replace("-", "‑")])["passed"])
        self.assertFalse(faithfulness.check(self.est, rules, ["AST‑9999"])["passed"])

    def test_no_ai_explanation_means_no_guard_verdict(self):
        req = {"request_id": "G", "request_text": self.TEXT, "product_context": self.est.all_scope, "market_context": None}
        self.assertIsNone(run_request(self.est, req, NoLLM())["ai"]["guard"])

    def test_every_saved_chip_explanation_passes(self):
        store = AnswerStore()

        class Saved:
            configured, answers, last_model = True, store, None

            def __getattr__(self, name):
                raise AssertionError(f"model call {name}")

        checked = 0
        for text in dict.fromkeys(r["request_text"] for r in self.est.requests):
            out = run_request(self.est, {"request_id": "C", "request_text": text, "product_context": self.est.all_scope, "market_context": None}, Saved())
            if out["ai"]["intent_source"] == "llm" and store.explanation(text, out["recommendation"]["action"], (out["recommendation"]["target"] or {}).get("id")):
                checked += 1
                self.assertEqual((out["ai"]["guard"], out["ai"]["explanation_source"]), ("passed", "llm"), text)
        self.assertEqual(checked, 6)


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class EvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))
        with redirect_stderr(StringIO()):
            cls.out = eval_quality.evaluate(cls.est, gold=None)
        cls.metrics = {m["id"]: m for g in cls.out["groups"] for m in g["metrics"]}

    def test_shape_and_every_metric_has_a_caveat(self):
        self.assertEqual(set(self.out), {"generated_at", "estate_snapshot", "groups"})
        self.assertEqual([g["group"] for g in self.out["groups"]], ["impact", "generation", "retrieval", "intent and decisions", "data", "human-labelled"])
        for m in self.metrics.values():
            self.assertEqual(set(m), METRIC_KEYS, m["id"])
            self.assertTrue(m["caveat"].strip(), m["id"])
            self.assertNotIn("\u2014", json.dumps(m, ensure_ascii=False), "no em dashes in user-facing text")

    def test_known_numbers(self):
        m = self.metrics
        self.assertEqual((m["citation_validity"]["value"], m["citation_validity"]["n"]), (1.0, 1098))
        self.assertIn("1098 citations checked, 0 invalid", m["citation_validity"]["basis"])
        self.assertEqual((m["intent_accuracy_first"]["value"], m["intent_accuracy_after_loop"]["value"]), (round(8 / 21, 3), round(20 / 21, 3)))
        self.assertEqual(m["ownerless_assets"]["value"], 86)
        self.assertEqual(m["faithfulness_deterministic"]["value"], 1.0)
        self.assertLessEqual(m["context_precision"]["value"], 1.0)
        self.assertLess(m["context_recall"]["value"], 1.0, "the migrate citations gap is reported, not hidden")

    def test_impact_numbers(self):
        m = {k: (v["value"], v["n"]) for k, v in self.metrics.items()}
        self.assertEqual(m["new_builds_avoided"], (57, 150))
        self.assertEqual(m["new_builds_avoided_canonical_only"], (33, 150))
        self.assertEqual(m["requests_and_texts"], (150, 10))
        self.assertEqual(m["citations_valid"], (1098, 1098))
        self.assertIn("0 invalid", self.metrics["citations_valid"]["basis"])
        self.assertEqual(m["specs_passing_today"], (13, 124))
        self.assertEqual(m["specs_passing_after_owner_fix"], (93, 124))
        self.assertIn("80 SM-065 specs from 7 distinct request texts", self.metrics["specs_passing_after_owner_fix"]["method"])
        self.assertEqual((m["estate_assets_today"][0], m["estate_assets_with_gate"][0], m["estate_assets_no_check"][0]), (360, 451, 510))
        for k in ("new_builds_avoided", "estate_assets_with_gate", "estate_assets_no_check", "specs_passing_after_owner_fix"):
            self.assertIn("ssum", self.metrics[k]["basis"], f"{k} says what it assumes")

    def test_without_a_key_the_judge_is_reported_as_not_run(self):
        judge = self.metrics["faithfulness_judge"]
        self.assertEqual((judge["value"], judge["n"]), (None, 0))
        self.assertIn("Not run", judge["caveat"])
        self.assertIn("data/judge_prompt.txt", judge["method"])
        self.assertTrue((ROOT / "data/judge_prompt.txt").read_text(encoding="utf-8").strip())

    def test_the_judge_runs_with_a_different_model_family_and_enough_explanations(self):
        self.assertTrue(all("gpt" not in j and "glm" not in j.lower() for j in eval_quality.JUDGES))

        class Gen:
            def explain(self, text, intent, decision):
                return [f"Decision: {decision['action'].replace('_', ' ')} for the request '{text}'."]

        class Judge:
            calls = 0

            def json_chat(self, messages, **kw):
                Judge.calls += 1
                return {"faithful": True, "unsupported_claims": []}

        with redirect_stderr(StringIO()):
            group = eval_quality.generation(self.est, Gen(), Judge(), "fake-judge")
        judge = next(m for m in group["metrics"] if m["id"] == "faithfulness_judge")
        self.assertEqual(judge["value"], 1.0)
        self.assertGreaterEqual(judge["n"], eval_quality.MIN_JUDGED)
        self.assertEqual(Judge.calls, judge["n"])

    def fresh(self):
        return json.loads(json.dumps(eval_quality.deterministic(self.out)))

    def test_committed_file_matches_a_fresh_offline_run(self):
        """Only the deterministic metrics: a committed file with generated explanations and judge scores must still pass."""
        saved = json.loads((ROOT / "data/evaluation.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["estate_snapshot"], self.out["estate_snapshot"])
        self.assertEqual(eval_quality.deterministic(saved), self.fresh())

    def test_the_comparison_covers_the_deterministic_metrics(self):
        view = self.fresh()
        self.assertEqual(list(view), ["impact", "retrieval", "intent and decisions", "data"])
        for mid in ("new_builds_avoided", "citations_valid", "context_precision", "context_recall", "citation_validity",
                    "intent_accuracy_after_loop", "referential_integrity", "ownerless_assets"):
            self.assertTrue(any(mid in g for g in view.values()), mid)
        self.assertFalse(any("judge" in mid or "faithfulness" in mid for g in view.values() for mid in g))

    def test_a_keyed_run_with_generated_explanations_and_a_judge_still_passes(self):
        keyed = copy.deepcopy(json.loads(json.dumps(self.out)))
        gen = next(g for g in keyed["groups"] if g["group"] == "generation")
        for m in gen["metrics"]:
            m.update(value=0.9, n=37, method=m["method"] + " Generated explanations by openai/gpt-oss-120b on Together AI.",
                     basis="AI explanations: 6 saved chip, 31 generated")
        keyed["groups"].append({"group": "extra", "metrics": [{"id": "x", "method": "LLM judge on Together AI", "value": 1}]})
        human = next(g for g in keyed["groups"] if g["group"] == "human-labelled")
        human["metrics"][0]["value"] = 0.8
        self.assertEqual(eval_quality.deterministic(keyed), self.fresh())

    def test_a_tampered_deterministic_metric_still_fails(self):
        for group, mid, field, value in (("impact", "new_builds_avoided", "value", 99), ("retrieval", "context_precision", "value", 1.0),
                                         ("intent and decisions", "citation_validity", "n", 1), ("data", "ownerless_assets", "value", 0),
                                         ("impact", "citations_valid", "method", "trust me")):
            with self.subTest(mid=mid, field=field):
                tampered = copy.deepcopy(json.loads(json.dumps(self.out)))
                metric = next(m for g in tampered["groups"] if g["group"] == group for m in g["metrics"] if m["id"] == mid)
                metric[field] = value
                self.assertNotEqual(eval_quality.deterministic(tampered), self.fresh())
        dropped = copy.deepcopy(json.loads(json.dumps(self.out)))
        next(g for g in dropped["groups"] if g["group"] == "retrieval")["metrics"].pop()
        self.assertNotEqual(eval_quality.deterministic(dropped), self.fresh(), "a removed metric fails too")


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class GoldTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = Estate(str(DB))

    def test_template_covers_the_actions_and_is_blank(self):
        rows = list(csv.DictReader(open(ROOT / "data/gold_labels_template.csv", encoding="utf-8")))
        self.assertEqual(len(rows), 20)
        requests = {r["request_id"]: r for r in self.est.requests}
        actions = {score_gold.system(self.est, requests[r["request_id"]])[1].action for r in rows}
        self.assertGreaterEqual(len(actions), 5)
        for r in rows:
            self.assertEqual([r[c] for c in ("expected_action", "expected_target", "expected_kpis", "relevant_cited_rows", "labeller")], [""] * 5)
            self.assertTrue(r["cited_rows"])
        with tempfile.TemporaryDirectory() as tmp:
            fresh = Path(tmp) / "t.csv"
            score_gold.template(self.est, fresh)
            self.assertEqual(fresh.read_text(encoding="utf-8"), (ROOT / "data/gold_labels_template.csv").read_text(encoding="utf-8"))

    def test_a_filled_file_is_scored_as_human_labelled(self):
        rows = list(csv.DictReader(open(ROOT / "data/gold_labels_template.csv", encoding="utf-8")))
        requests = {r["request_id"]: r for r in self.est.requests}
        for n, r in enumerate(rows[:4]):
            intent, rec = score_gold.system(self.est, requests[r["request_id"]])
            r.update(expected_action=rec.action if n else "reuse", expected_target=rec.target or "none", expected_kpis="; ".join(intent.kpis),
                     relevant_cited_rows=r["cited_rows"].split("; ")[0], labeller="Tester")
        rows[4]["expected_action"] = "build_everything"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gold.csv"
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=score_gold.COLUMNS)
                w.writeheader()
                w.writerows(rows)
            group = score_gold.group(self.est, path)
        self.assertEqual(group["group"], "human-labelled")
        m = {x["id"]: x for x in group["metrics"]}
        self.assertEqual((m["gold_action_accuracy"]["value"], m["gold_action_accuracy"]["n"]), (0.75, 4))
        self.assertEqual((m["gold_target_accuracy"]["value"], m["gold_kpi_precision"]["value"], m["gold_kpi_recall"]["value"]), (1.0, 1.0, 1.0))
        self.assertGreater(m["gold_context_precision"]["n"], 4)
        self.assertIn("1 cells skipped", m["gold_action_accuracy"]["basis"])

    def test_unlabelled_file_gives_no_values(self):
        group = score_gold.group(self.est, ROOT / "data/gold_labels_template.csv")
        self.assertTrue(all(m["value"] is None and m["n"] == 0 for m in group["metrics"]))
        self.assertIn("not labelled yet", group["metrics"][0]["basis"])


@unittest.skipUnless(DB.exists(), "run load_estate.py first")
class EvaluationApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patcher = patch.multiple(server, EST=Estate(str(DB)), LLM_CLIENT=NoLLM())
        cls.patcher.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patcher.stop()

    def get(self):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.httpd.server_port}/evaluation", timeout=30) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    def test_serves_the_file_and_the_mock_has_it(self):
        code, body = self.get()
        saved = json.loads((ROOT / "data/evaluation.json").read_text(encoding="utf-8"))
        self.assertEqual((code, body), (200, saved))
        self.assertEqual(json.loads((ROOT / "data/mock_api.json").read_text(encoding="utf-8"))["evaluation"], saved)

    def test_missing_file_is_a_clear_404(self):
        with patch.object(server, "EVALUATION", Path("/nonexistent/evaluation.json")):
            code, body = self.get()
        self.assertEqual(code, 404)
        self.assertIn("eval_quality", body["error"])


class EvaluationGateTest(unittest.TestCase):
    """scripts/check_evaluation.py: deterministic metrics gate the pipeline, the LLM judge is reported but never gates."""

    def evaluation(self, **values):
        base = {"faithfulness_deterministic": 1.0, "guard_replacement_rate": 0.0, "citation_validity": 1.0,
                "context_precision": 0.95, "context_recall": 0.99, "faithfulness_judge": 0.2}
        base.update(values)
        return {"groups": [{"group": "g", "metrics": [{"id": k, "value": v} for k, v in base.items()]}]}

    def test_a_low_judge_score_does_not_fail_the_gate(self):
        rows = load("check_evaluation").check(self.evaluation())
        self.assertTrue(all(r[3] for r in rows))
        self.assertNotIn("faithfulness_judge", [r[0] for r in rows])

    def test_deterministic_faithfulness_and_guard_rate_stay_hard_gates(self):
        gate = load("check_evaluation")
        for bad in ({"faithfulness_deterministic": 0.97}, {"guard_replacement_rate": 0.2}, {"faithfulness_deterministic": None}):
            failed = [r[0] for r in gate.check(self.evaluation(**bad)) if not r[3]]
            self.assertEqual(failed, list(bad), bad)


if __name__ == "__main__":
    unittest.main()
