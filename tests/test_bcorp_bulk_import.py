import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BcorpBulkImportTest(unittest.TestCase):
    def test_csv_is_sharded_rejected_and_resumable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "companies.csv"
            output = root / "snapshots"
            with source.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["company_name", "profile_url", "status", "overall_score", "industry"])
                writer.writeheader()
                writer.writerow({"company_name": "Tribe Breweries Pty Ltd", "profile_url": "https://www.bcorporation.net/en-us/find-a-b-corp/company/tribe-breweries-pty-ltd/", "status": "listed active", "overall_score": "91.2", "industry": "Beverages"})
                writer.writerow({"company_name": "Missing Link", "profile_url": "", "status": "listed active", "overall_score": "80"})
                writer.writerow({"company_name": "Example B Corp", "profile_url": "https://www.bcorporation.net/en-us/find-a-b-corp/company/example-b-corp/", "status": "listed active", "overall_score": "88"})
            command = [sys.executable, str(ROOT / "scripts/import_bcorp_bulk.py"), str(source), str(output), "--batch-size", "1", "--captured-at", "2026-08-03"]
            subprocess.run(command, check=True)
            shards = sorted(output.glob("b-lab-*.json"))
            self.assertEqual(2, len(shards))
            tribe = json.loads(shards[0].read_text())["records"][0]
            self.assertEqual("Tribe Breweries Pty Ltd", tribe["brand"])
            self.assertEqual("bcorp-tribe-breweries-pty-ltd", tribe["id"])
            self.assertEqual(91.2, tribe["score"])
            self.assertEqual("Beverages", tribe["companyFacts"]["industry"])
            self.assertEqual(tribe["sourceUrl"], tribe["officialProfileUrl"])
            self.assertEqual(1, len(output.joinpath("rejected.jsonl").read_text().splitlines()))
            subprocess.run(command, check=True)
            self.assertEqual(2, len(list(output.glob("b-lab-*.json"))), "resume must not duplicate completed rows")


if __name__ == "__main__":
    unittest.main()
