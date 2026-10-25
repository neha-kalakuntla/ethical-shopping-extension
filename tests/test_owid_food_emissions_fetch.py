import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_owid_food_emissions", ROOT / "scripts" / "fetch_owid_food_emissions.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OwidFoodEmissionsTests(unittest.TestCase):
    def test_builds_category_estimates_with_fixed_comparison_context(self):
        csv_data = b"Entity,Year,Greenhouse gas emissions per kilogram\nApples,2010,0.43\nBananas,2010,0.86\n"
        metadata = json.dumps({"chart": {"title": "GHG", "citation": "Poore and Nemecek (2018)"}}).encode()
        snapshot = MODULE.build_snapshot(csv_data, metadata, "2026-09-27")
        self.assertEqual("environmental_measurements", snapshot["kind"])
        self.assertEqual(2, len(snapshot["records"]))
        apple = snapshot["records"][0]
        self.assertEqual("category_estimate", apple["measurementScope"])
        self.assertEqual("1 kg food product", apple["functionalUnit"])
        self.assertEqual("full_supply_chain_to_retail", apple["lifecycleBoundary"])
        self.assertFalse(apple["gradingEligible"])
        self.assertEqual(0.43, apple["value"])

    def test_combines_distinct_metrics_without_mixing_units(self):
        climate = b"Entity,Year,Greenhouse gas emissions per kilogram\nApples,2010,0.43\n"
        water = b"Entity,Year,Freshwater withdrawals per kilogram\nApples,2010,180.1\n"
        metadata = json.dumps({"chart": {"citation": "Poore and Nemecek (2018)"}}).encode()
        snapshot = MODULE.build_combined_snapshot({
            "climate": (climate, metadata),
            "water": (water, metadata),
        }, "2026-09-27")
        self.assertEqual(2, len(snapshot["records"]))
        self.assertEqual({"climate_change", "freshwater_use"}, {record["metric"] for record in snapshot["records"]})
        self.assertEqual({"kg_co2e", "l"}, {record["unit"] for record in snapshot["records"]})
        self.assertTrue(all(record["gradingEligible"] is False for record in snapshot["records"]))


if __name__ == "__main__":
    unittest.main()
