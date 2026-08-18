import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from import_page_claims import import_claims
from update_database import connect, initialize


class PageClaimImportTest(unittest.TestCase):
    def test_imports_non_grading_claim_and_rag_chunk(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            export = root / "claims.json"
            export.write_text(json.dumps({
                "schemaVersion": 1, "kind": "merchant_page_claims", "exportedAt": "2026-08-05T12:00:00Z",
                "products": [{"asin": "B07YBTWGPM", "title": "Wholesome Allulose", "brand": "Wholesome",
                    "url": "https://www.amazon.com/dp/B07YBTWGPM", "updatedAt": "2026-08-05T12:00:00Z",
                    "claims": [{"claimType": "vegan", "label": "Vegan", "exactText": "Naturally Vegan",
                        "normalizedClaim": "vegan", "sourceField": "product_bullet",
                        "sourceUrl": "https://www.amazon.com/dp/B07YBTWGPM", "capturedAt": "2026-08-05T12:00:00Z",
                        "verificationStatus": "unverified", "gradeEligible": False, "confidence": 0.55}]}]
            }))
            with connect(root / "test.sqlite3") as db:
                initialize(db)
                self.assertEqual(import_claims(db, export), (1, 1))
                claim = db.execute("SELECT verification_status,grade_eligible FROM product_claims").fetchone()
                self.assertEqual(tuple(claim), ("unverified", 0))
                chunk = db.execute("SELECT content,metadata_json FROM knowledge_chunks").fetchone()
                self.assertIn("not been verified", chunk["content"])
                self.assertFalse(json.loads(chunk["metadata_json"])["grade_eligible"])


if __name__ == "__main__":
    unittest.main()
