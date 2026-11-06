import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class N8nIntegrationTest(unittest.TestCase):
    def test_digest_requires_key(self):
        with patch.object(server, "N8N_API_KEY", "expected"):
            handler = type("Handler", (), {"headers": {"X-N8N-API-Key": "wrong"}})()
            self.assertFalse(server.n8n_authorized(handler))

    def test_digest_shape(self):
        class FakeEstate:
            assets = {"a": 1}

        with patch.object(server, "EST", FakeEstate()), patch.object(
            server, "radar", return_value={"totals": {"dead_or_unused": 2, "ownerless": 1, "high_reach_uncertified": 3},
                                            "dead_assets": [], "ownerless_assets": [], "high_reach_uncertified": []}
        ):
            digest = server.radar_digest()
        self.assertEqual(digest["totals"]["dead_or_unused"], 2)
        self.assertIn("retire or review", digest["summary"])

    def test_workflow_files_are_wired_and_hold_no_secrets(self):
        for path in Path(__file__).parent.glob("n8n/*_workflow.json"):
            with self.subTest(path.name):
                flow = json.loads(path.read_text(encoding="utf-8"))
                names = {n["name"] for n in flow["nodes"]}
                self.assertFalse(flow["active"], "imported workflows start inactive")
                for source, outputs in flow["connections"].items():
                    self.assertIn(source, names)
                    for link in outputs["main"][0]:
                        self.assertIn(link["node"], names)
                for node in flow["nodes"]:
                    params = json.dumps(node["parameters"])
                    self.assertNotIn("X-N8N-API-Key", params, "keys belong in n8n credentials")
                    for cred in node.get("credentials", {}).values():
                        self.assertEqual(set(cred), {"id", "name"})


if __name__ == "__main__":
    unittest.main()
