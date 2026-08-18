import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_fairtrade_international", ROOT / "scripts/fetch_fairtrade_international.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FairtradeInternationalFetchTest(unittest.TestCase):
    def test_config_is_read_from_official_finder_markup(self):
        config = MODULE.finder_config('<div data-api-endpoint="https://search.test" data-api-key="public-key" data-index-name="finder">')
        self.assertEqual("https://search.test", config["endpoint"])
        self.assertEqual("finder", config["index"])

    def test_licensed_operator_with_product_scope_can_grade(self):
        record = MODULE.normalize_operator({
            "op_key": "1001427", "op_floId": 3072, "op_name": "Traditional Medicinals", "op_altname": "Traditional Medicinals®",
            "op_country": "United States", "cert_status": "Certified", "cert_body": "FLOCERT", "cert_standard": ["Trader"],
            "cert_product": ["Herbs, herbal teas & spices", "Tea"], "lic_status": "Licensed", "lic_body": "Fairtrade Canada",
        }, "2026-08-04")
        self.assertEqual("product", record["scope"])
        self.assertTrue(record["gradingEligible"])
        self.assertIn("Tea", record["matchTerms"])

    def test_licensee_without_product_scope_is_provenance_only(self):
        record = MODULE.normalize_operator({
            "op_key": "x", "op_name": "Example Licensee", "cert_status": "Not Certified", "cert_product": ["(Not Specified)"],
            "lic_status": "Licensed",
        }, "2026-08-04")
        self.assertEqual("operation", record["scope"])
        self.assertFalse(record["gradingEligible"])
        self.assertFalse(record["extensionEligible"])

    def test_certified_unlicensed_trader_is_rag_only(self):
        record = MODULE.normalize_operator({
            "op_key": "x", "op_name": "Certified Trader", "cert_status": "Certified", "cert_product": ["Coffee"],
            "lic_status": "Not Licensed",
        }, "2026-08-04")
        self.assertEqual("operation", record["scope"])
        self.assertFalse(record["gradingEligible"])
        self.assertFalse(record["extensionEligible"])
        self.assertIn("RAG evidence only", record["scopeNote"])

    def test_unlicensed_uncertified_operator_is_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.normalize_operator({"op_key": "x", "op_name": "Trader", "cert_status": "Not Certified", "lic_status": "Not Licensed"}, "2026-08-04")


if __name__ == "__main__":
    unittest.main()
