import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_certified_vegan", ROOT / "scripts/fetch_certified_vegan.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CertifiedVeganFetchTests(unittest.TestCase):
    def test_company_directory_parser(self):
        page = '<p class="wp-block-paragraph">88 Acres <a href="https://88-acres.com/">88acres.com</a></p>'
        self.assertEqual(MODULE.parse_companies(page), [("88 Acres", "https://88-acres.com/")])

    def test_products_are_aggregated_but_remain_product_scoped(self):
        products = [{"id": 1, "title": {"rendered": "88 Acres Apple Ginger Bar"},
            "link": "https://vegan.org/vegan_products/apple-ginger-bar",
            "acf": {"vp_company_website": {"value": "https://88-acres.com/products"}}}]
        records, rejected = MODULE.build_records(products, [("88 Acres", "https://88-acres.com")], "2026-08-05")
        self.assertFalse(rejected)
        self.assertEqual(records[0]["scope"], "product")
        self.assertIn("Apple Ginger Bar", records[0]["productNames"])
        self.assertNotEqual(records[0]["scope"], "company")

    def test_brand_prefix_can_bridge_changed_company_domain(self):
        products = [{"id": 2, "title": {"rendered": "88 Acres Apple Ginger Bar"},
            "link": "https://vegan.org/vegan_products/apple-ginger-bar",
            "acf": {"vp_company_website": {"value": "https://88acres.com"}}}]
        records, rejected = MODULE.build_records(products, [("88 Acres", "https://88-acres.com")], "2026-08-05")
        self.assertFalse(rejected)
        self.assertEqual(records[0]["brand"], "88 Acres")


if __name__ == "__main__":
    unittest.main()
