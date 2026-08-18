import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DatabasePipelineTest(unittest.TestCase):
    def test_update_is_idempotent_and_exports_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "test.sqlite3"
            cache = Path(directory) / "certifications.json"
            command = [sys.executable, str(ROOT / "scripts/update_database.py"), "update", "--db", str(db), "--sources", str(ROOT / "sources"), "--cache", str(cache)]
            subprocess.run(command, check=True)
            subprocess.run(command, check=True)
            payload = json.loads(cache.read_text())
            lookup = json.loads(cache.with_name("certification-index.json").read_text())
            self.assertEqual(2, payload["schemaVersion"])
            self.assertEqual(1, lookup["schemaVersion"])
            self.assertLessEqual(len(lookup["records"]), len(payload["records"]))
            self.assertIn("b_lab_find_a_b_corp", lookup["providers"])
            self.assertGreaterEqual(len(payload["records"]), 10716)
            certification = next(record for record in payload["records"] if record["id"].startswith("bcorp-"))["certifications"][0]
            self.assertTrue(certification["current"])
            self.assertTrue(certification["gradeEligible"])
            self.assertEqual(0.92, certification["confidence"])
            self.assertIn("Company-level", certification["scopeNote"])
            self.assertIn("/find-a-b-corp/company/", certification["officialProfileUrl"])
            products = json.loads(cache.with_name("products.json").read_text())
            self.assertEqual([], products["products"])
            with sqlite3.connect(db) as connection:
                certification_count = connection.execute("SELECT count(*) FROM certifications").fetchone()[0]
                document_count = connection.execute("SELECT count(*) FROM source_documents").fetchone()[0]
                snapshot_count = len(list((ROOT / "sources").rglob("*.json")))
                self.assertEqual(len(payload["records"]), certification_count)
                self.assertGreaterEqual(connection.execute("SELECT count(*) FROM entities").fetchone()[0], certification_count)
                self.assertGreaterEqual(document_count, certification_count)
                self.assertGreaterEqual(connection.execute("SELECT count(*) FROM facts").fetchone()[0], 9)
                self.assertEqual(document_count, connection.execute("SELECT count(*) FROM knowledge_chunks").fetchone()[0])
                self.assertEqual(snapshot_count * 2, connection.execute("SELECT count(*) FROM ingestion_runs WHERE status='succeeded'").fetchone()[0])
                self.assertGreaterEqual(connection.execute("SELECT count(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'certified OR licensed OR listed'").fetchone()[0], certification_count)
                self.assertEqual(0, connection.execute("SELECT count(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'Nutella'").fetchone()[0])
                source = connection.execute("SELECT dimensions_json,access_method,default_confidence,grading_eligible FROM sources WHERE id='b_lab_find_a_b_corp'").fetchone()
                self.assertEqual('["labor", "environment", "transparency"]', source[0])
                self.assertEqual("reviewed_official_directory_snapshot", source[1])
                self.assertEqual(0.92, source[2])
                self.assertEqual(1, source[3])
                profile = connection.execute("SELECT official_profile_url FROM certifications WHERE issuer='B Lab' LIMIT 1").fetchone()[0]
                self.assertIn("/find-a-b-corp/company/", profile)
                tribe = connection.execute("""SELECT e.canonical_name,c.score,c.official_profile_url FROM entities e
                    JOIN certifications c ON c.entity_id=e.id WHERE e.id='bcorp-tribe-breweries-pty-ltd'""").fetchone()
                self.assertEqual("Tribe Breweries Pty Ltd", tribe[0])
                self.assertEqual(83.7, tribe[1])
                self.assertTrue(tribe[2].endswith("/tribe-breweries-pty-ltd/"))

    def test_open_food_facts_fixture_ingests_as_a_targeted_product(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = root / "sources"
            sources.mkdir()
            fixture = ROOT / "tests" / "fixtures" / "open-food-facts" / "3017620422003.json"
            (sources / fixture.name).write_text(fixture.read_text())
            db = root / "test.sqlite3"
            cache = root / "certifications.json"
            subprocess.run([sys.executable, str(ROOT / "scripts/update_database.py"), "update", "--db", str(db), "--sources", str(sources), "--cache", str(cache)], check=True)
            products = json.loads(cache.with_name("products.json").read_text())
            self.assertEqual("3017620422003", products["products"][0]["barcode"])
            with sqlite3.connect(db) as connection:
                self.assertEqual(1, connection.execute("SELECT count(*) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'Nutella'").fetchone()[0])

    def test_expired_certification_is_retained_but_cannot_affect_grade(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = root / "sources"
            sources.mkdir()
            snapshot = {
                "schemaVersion": 1,
                "kind": "certification_directory",
                "capturedAt": "2026-08-03",
                "source": {
                    "id": "b_lab_find_a_b_corp", "label": "B Lab Find a B Corp", "issuer": "B Lab",
                    "sourceType": "official_directory", "certificationName": "Certified B Corporation",
                    "defaultScope": "company", "recordIdPrefix": "bcorp"
                },
                "records": [{
                    "brand": "Expired Example", "status": "listed active", "expiresAt": "2020-01-01T00:00:00Z",
                    "sourceUrl": "https://www.bcorporation.net/en-us/find-a-b-corp/", "verifiedAt": "2026-08-03"
                }]
            }
            (sources / "expired.json").write_text(json.dumps(snapshot))
            db = root / "test.sqlite3"
            cache = root / "certifications.json"
            command = [sys.executable, str(ROOT / "scripts/update_database.py"), "update", "--db", str(db), "--sources", str(sources), "--cache", str(cache)]
            subprocess.run(command, check=True)
            certification = json.loads(cache.read_text())["records"][0]["certifications"][0]
            self.assertFalse(certification["current"])
            self.assertFalse(certification["gradeEligible"])


if __name__ == "__main__":
    unittest.main()
