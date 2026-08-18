import importlib.util
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_cradle_to_cradle", ROOT / "scripts/fetch_cradle_to_cradle.py")
MODULE = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(MODULE)

class CradleToCradleFetchTests(unittest.TestCase):
    def test_preserves_product_scope_and_each_certification_type(self):
        hit = {"id": 123, "title": "Example Chair", "slug": "example-chair", "url": "/certified-products/example-chair",
            "company": {"title": "Example Company", "website": "example.com"}, "cradle_to_cradle_certified": True,
            "material_health_certified": True, "certificate": {"full_scope_level": "Gold", "full_scope_version": "4.1",
            "material_health_certified_level": "Platinum", "material_health_certified_version": "4.1",
            "certified_circularity_certificate": False, "certification_number": 999, "valid_until": "03 Aug 2029"}}
        records = MODULE.normalize(hit, "2026-08-05")
        self.assertEqual(len(records), 2); self.assertEqual(records[0]["scope"], "product")
        self.assertEqual(records[0]["productNames"], ["Example Chair"]); self.assertEqual(records[0]["certificationLevel"], "Gold")
        self.assertEqual(records[0]["officialProfileUrl"], "https://c2ccertified.org/certified-products/example-chair")
        self.assertEqual(records[0]["expiresAt"], "2029-08-03T23:59:59Z")

if __name__ == "__main__": unittest.main()
