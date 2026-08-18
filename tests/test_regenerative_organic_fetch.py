import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_regenerative_organic", ROOT / "scripts/fetch_regenerative_organic.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RegenerativeOrganicFetchTests(unittest.TestCase):
    def test_extracts_brand_profile_and_product_scope(self):
        page = '''<div class="wpex-card-modal-title x">Example Brand</div>
        <span href="https://regenorganic.org/roc_brands_products/example-brand/"></span>
        <p><a href="https://example.com">site</a></p>
        <span class="product-name">Cane Sugar</span><span class="product-name">Cocoa</span>'''
        entries = MODULE.parse_directory(page)
        self.assertEqual(entries[0]["brand"], "Example Brand")
        self.assertEqual(entries[0]["products"], ["Cane Sugar", "Cocoa"])
        record = MODULE.normalize(entries[0], "2026-08-05")
        self.assertEqual(record["scope"], "product")
        self.assertEqual(record["officialProfileUrl"], "https://regenorganic.org/roc_brands_products/example-brand/")


if __name__ == "__main__":
    unittest.main()
