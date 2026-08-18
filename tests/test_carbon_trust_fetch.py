import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_carbon_trust", ROOT / "scripts" / "fetch_carbon_trust.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CarbonTrustFetchTests(unittest.TestCase):
    def test_listing_paginates_until_short_page(self):
        pages = [[{"id": str(i)} for i in range(50)], [{"id": "last"}]]
        requested = []

        def getter(url):
            requested.append(url)
            return pages[len(requested) - 1]

        records = MODULE.fetch_listing(getter)
        self.assertEqual(len(records), 51)
        self.assertIn("offset=50", requested[1])

    def test_normalizes_product_claim_and_variants(self):
        detail = {
            "id": "claim_123", "product_name": "Example One", "license_holders_name": "Example Co",
            "claim_type": "Carbon emissions reductions achieved", "license_number": "CERT-1",
            "verified_since": "2025-01-01T00:00:00.000Z", "expiration_date": "2027-01-01",
            "product_variants": [{"name": "Example One XL", "countries": ["UK"], "regions": ["Europe"]}],
        }
        record = MODULE.normalize_record({}, detail, "2026-08-20")
        self.assertEqual(record["scope"], "product")
        self.assertEqual(record["expiresAt"], "2027-01-01T23:59:59Z")
        self.assertEqual(record["productNames"], ["Example One", "Example One XL"])
        self.assertEqual(record["claimType"], "Carbon emissions reductions achieved")
        self.assertIn("UK", record["availableIn"])


if __name__ == "__main__":
    unittest.main()
