import unittest

from reuse_gate.spec import build_spec


class DashboardSpecTest(unittest.TestCase):
    def setUp(self):
        self.intent = {
            "products": ["Nubeqa"],
            "market": "Global",
            "kpis": ["Net Sales Growth"],
        }

    def test_build_spec_for_new_build(self):
        result = build_spec(self.intent, {"action": "new_build", "build_on": "SM-001"})
        self.assertEqual(result["semantic_model"], "SM-001")
        self.assertEqual(result["source_action"], "new_build")
        self.assertIn("canonical KPI", result["governance"][0])

    def test_rejects_non_build_action(self):
        with self.assertRaises(ValueError):
            build_spec(self.intent, {"action": "reuse", "build_on": "SM-001"})


if __name__ == "__main__":
    unittest.main()
