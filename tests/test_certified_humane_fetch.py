import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_certified_humane", ROOT / "scripts/fetch_certified_humane.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CertifiedHumaneFetchTest(unittest.TestCase):
    def test_private_label_products_remain_paired_to_their_brand(self):
        row = [{"text": "Producer", "link": None}, {"text": "Cadia: Free-Range Brown Eggs, Organic Brown Eggs; Central Market: Pasture-Raised Brown Eggs", "link": None}, {"text": "producer.test", "link": "https://producer.test"}]
        record = MODULE.normalize_row(row, "2026-08-04")
        self.assertIn("Cadia", record["aliases"])
        self.assertIn("Central Market", record["aliases"])
        self.assertEqual(["Cadia"], record["productRules"][0]["brands"])
        self.assertIn("Free-Range Brown Eggs", record["productRules"][0]["terms"])
        self.assertEqual(["Central Market"], record["productRules"][1]["brands"])

    def test_brand_does_not_leak_across_complex_directory_segments(self):
        products = (
            "Cadia: Free-Range Brown Eggs; "
            "Central Market: Pasture-Raised Brown Eggs: Earth Fare: Cage-Free White Eggs; "
            "Gelson’s Pasture-Raised Brown Eggs; "
            "Kirkland Signature Cage-Free Eggs"
        )
        rules = MODULE.product_rules("Hidden Villa Ranch", products)
        self.assertEqual(["Cadia"], rules[0]["brands"])
        self.assertEqual(["Gelson’s"], rules[1]["brands"])
        self.assertEqual(["Kirkland Signature"], rules[2]["brands"])
        self.assertNotIn("Central Market", [brand for rule in rules for brand in rule["brands"]])

    def test_safe_retail_title_variants_are_generated(self):
        rules = MODULE.product_rules("Creminelli Operating LLC", "Creminelli Fine Meats®: Varzi Uncured Italian Salami")
        self.assertIn("Creminelli", rules[0]["brands"])
        self.assertIn("Varzi Salami", rules[0]["terms"])


if __name__ == "__main__": unittest.main()
