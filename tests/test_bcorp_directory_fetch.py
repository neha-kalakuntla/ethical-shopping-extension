import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_bcorp_directory", ROOT / "scripts/fetch_bcorp_directory.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BcorpDirectoryFetchTest(unittest.TestCase):
    def test_transform_preserves_official_identity_and_directory_fields(self):
        record = MODULE.transform({
            "id": "tribe-breweries-pty-ltd",
            "slug": "tribe-breweries-pty-ltd",
            "name": "Tribe Breweries Pty Ltd",
            "isCertified": True,
            "latestVerifiedScore": "83.7",
            "initialCertificationDateTimestamp": 1784592000000,
            "hqCity": "Goulburn",
            "hqProvince": "New South Wales",
            "hqCountry": "Australia",
            "industry": "Beverages",
            "sector": "Manufacturing",
            "size": "50-249",
            "description": "Purpose-built brewery",
        }, "2026-08-04")
        self.assertEqual("listed active", record["status"])
        self.assertEqual("83.7", record["overall_score"])
        self.assertEqual("2026-07-21", record["certified_since"])
        self.assertEqual("Goulburn, New South Wales, Australia", record["geography"])
        self.assertTrue(record["profile_url"].endswith("/tribe-breweries-pty-ltd/"))


if __name__ == "__main__":
    unittest.main()
