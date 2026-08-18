import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_leaping_bunny", ROOT / "scripts/fetch_leaping_bunny.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LeapingBunnyFetchTests(unittest.TestCase):
    def test_parses_only_brand_profile_links(self):
        page = '''
        <a href="/brand/acme-beauty" hreflang="en">Acme &amp; Beauty</a>
        <a href="/shopping-guide?page=1">Next</a>
        <a href="https://elsewhere.test/brand/wrong">Wrong</a>
        '''
        self.assertEqual(MODULE.parse_brands(page), [
            ("Acme & Beauty", "https://www.leapingbunny.org/brand/acme-beauty")
        ])

    def test_brand_scope_preserves_official_profile(self):
        record = MODULE.normalize_brand(
            "Acme Beauty", "https://www.leapingbunny.org/brand/acme-beauty", "2026-08-05"
        )
        self.assertEqual(record["scope"], "brand")
        self.assertEqual(record["aliases"], ["Acme Beauty"])
        self.assertEqual(record["officialProfileUrl"], record["sourceUrl"])
        self.assertNotIn("Acme", record["aliases"])

    def test_retail_alias_removes_legal_and_cosmetics_suffixes(self):
        self.assertEqual(
            MODULE.brand_aliases("e.l.f. Cosmetics, Inc."),
            ["e.l.f. Cosmetics, Inc.", "e.l.f. Cosmetics", "e.l.f."],
        )


if __name__ == "__main__":
    unittest.main()
