import importlib.util
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_gots", ROOT / "scripts/fetch_gots.py")
MODULE = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(MODULE)

class GotsFetchTests(unittest.TestCase):
    def test_preserves_brands_categories_and_product_scope(self):
        record = MODULE.normalize({"system_id": "SCO123", "company_name": "Example Textiles", "country": "India",
            "product_category": "Home textiles, Women's apparel", "brand_names": "Example Home, Example Wear"}, "2026-08-05")
        self.assertEqual(record["scope"], "product"); self.assertIn("Example Home", record["aliases"])
        self.assertIn("towel", record["productNames"]); self.assertIn("dress", record["matchTerms"])
        self.assertTrue(record["extensionEligible"])
        self.assertTrue(record["officialProfileUrl"].endswith("gtbid=SCO123"))

if __name__ == "__main__": unittest.main()
