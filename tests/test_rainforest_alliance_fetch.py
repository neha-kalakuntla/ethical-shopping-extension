import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_rainforest_alliance", ROOT / "scripts/fetch_rainforest_alliance.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RainforestAllianceFetchTest(unittest.TestCase):
    def test_directory_and_profile_metadata_are_normalized(self):
        url = "https://www.rainforest-alliance.org/find-certified/chocolove/"
        directory = f'<a href="{url}">Chocolove</a><a href="{url}">Again</a>'
        self.assertEqual([url], MODULE.directory_links(directory))
        metadata = {
            "pageTitle": "Chocolove | Find the Frog",
            "pagePostDateIso": "2026-03-20T21:06:16+00:00",
            "pagePostTerms": {
                "commodity": ["Cocoa"], "consumer-location": ["Canada", "United States"],
                "product-type": ["Chocolate"], "meta": {"product_company_url": "https://www.chocolove.com/"}
            }
        }
        record = MODULE.profile_record(f"<script>var dataLayer_content = {__import__('json').dumps(metadata)};</script>", url)
        self.assertEqual("Chocolove", record["brand"])
        self.assertEqual(["Cocoa"], record["certifiedIngredients"])
        self.assertEqual(["Chocolate", "Cocoa"], record["matchTerms"])
        self.assertEqual("2026-03-20", record["verifiedAt"])


if __name__ == "__main__":
    unittest.main()
