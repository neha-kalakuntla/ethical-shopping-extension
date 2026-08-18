import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_bluesign_partners", ROOT / "scripts" / "fetch_bluesign_partners.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BluesignFetchTests(unittest.TestCase):
    def test_finds_official_brand_partner_pdf(self):
        page = '<a href="/files/general.pdf">x</a><a href="/files/System-Partner-list-Brands_2026.pdf">brands</a>'
        self.assertEqual(
            MODULE.brand_pdf_url(page),
            "https://www.bluesign.com/files/System-Partner-list-Brands_2026.pdf",
        )

    def test_snapshot_is_provenance_only(self):
        snapshot = json.loads((ROOT / "sources" / "certifications" / "bluesign-system-partners.json").read_text())
        self.assertGreater(len(snapshot["records"]), 25)
        self.assertTrue(all(record["scope"] == "brand" for record in snapshot["records"]))
        self.assertTrue(all(record["gradingEligible"] is False for record in snapshot["records"]))
        self.assertTrue(all("not proof" in record["scopeNote"] for record in snapshot["records"]))


if __name__ == "__main__":
    unittest.main()
