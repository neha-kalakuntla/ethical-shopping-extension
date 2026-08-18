import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_change_climate", ROOT / "scripts" / "fetch_change_climate.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ChangeClimateFetchTests(unittest.TestCase):
    def test_extracts_next_embedded_brands(self):
        data = 'prefix "brands":[{"name":"Example","slug":"example"}] suffix'
        encoded = json.dumps(data)[1:-1]
        page = f'<script>self.__next_f.push([1,"{encoded}"])</script>'
        self.assertEqual(MODULE.embedded_brands(page)[0]["slug"], "example")

    def test_snapshot_excludes_expired_and_preserves_scope(self):
        snapshot = json.loads((ROOT / "sources" / "certifications" / "change-climate.json").read_text())
        self.assertGreater(len(snapshot["records"]), 100)
        self.assertTrue(all(record["scope"] == "brand" for record in snapshot["records"]))
        self.assertTrue(all("individual retail item" in record["scopeNote"] for record in snapshot["records"]))


if __name__ == "__main__":
    unittest.main()
