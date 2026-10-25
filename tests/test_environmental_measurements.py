import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("update_database", ROOT / "scripts" / "update_database.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

COMPARE_SPEC = importlib.util.spec_from_file_location(
    "compare_environmental_measurements", ROOT / "scripts" / "compare_environmental_measurements.py"
)
COMPARE = importlib.util.module_from_spec(COMPARE_SPEC)
COMPARE_SPEC.loader.exec_module(COMPARE)


class EnvironmentalMeasurementTests(unittest.TestCase):
    def setUp(self):
        MODULE.SOURCE_REGISTRY = MODULE.load_source_registry()

    def snapshot(self, scope="category_estimate"):
        return {
            "schemaVersion": 1,
            "kind": "environmental_measurements",
            "capturedAt": "2026-09-26T00:00:00Z",
            "source": {"id": "environmental_measurement_manual_research"},
            "records": [{
                "externalId": "example-apple-carbon",
                "brand": "Example Farm",
                "productName": "Fresh Apple",
                "gtin": "0012345678905",
                "metric": "climate_change",
                "value": 0.43,
                "unit": "kg_co2e",
                "functionalUnit": "1 kg edible product",
                "measurementScope": scope,
                "lifecycleBoundary": "cradle_to_retail",
                "geography": "United States",
                "methodology": "ISO 14040/14044 life-cycle assessment",
                "lowerBound": 0.3,
                "upperBound": 0.7,
                "confidence": 0.72,
                "sourceUrl": "https://example.org/apple-lca"
            }]
        }

    def test_measurement_preserves_comparison_context_and_is_not_grade_eligible(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "measurement.json"
            path.write_text(json.dumps(self.snapshot()), encoding="utf-8")
            with MODULE.connect(Path(directory) / "test.sqlite3") as db:
                MODULE.initialize(db)
                MODULE.validate_snapshot(self.snapshot(), path)
                self.assertEqual((1, 1), MODULE.ingest_environmental_snapshot(db, path))
                row = db.execute("SELECT * FROM environmental_measurements").fetchone()
                self.assertEqual("kg_co2e", row["unit"])
                self.assertEqual("1 kg edible product", row["functional_unit"])
                self.assertEqual("category_estimate", row["measurement_scope"])
                self.assertEqual("cradle_to_retail", row["lifecycle_boundary"])
                self.assertEqual(0, row["grade_eligible"])
                chunk = db.execute("SELECT content,metadata_json FROM knowledge_chunks").fetchone()
                self.assertIn("Environmental metric: climate_change", chunk["content"])
                self.assertEqual("environmental_measurement", json.loads(chunk["metadata_json"])["kind"])

    def test_invalid_bounds_are_rejected(self):
        snapshot = self.snapshot()
        snapshot["records"][0]["lowerBound"] = 0.8
        with self.assertRaisesRegex(ValueError, "bounds do not contain"):
            MODULE.validate_snapshot(snapshot, Path("invalid.json"))

    def test_comparison_safely_normalizes_convertible_units(self):
        left = {
            "metric": "climate_change", "value": 430, "unit": "g CO2e",
            "functional_unit": "1 kg edible product", "lifecycle_boundary": "cradle_to_retail",
            "measurement_scope": "category_estimate", "lower_bound": 300, "upper_bound": 700,
        }
        right = {
            "metric": "climate_change", "value": 0.8, "unit": "kg_co2e",
            "functional_unit": "1 kg edible product", "lifecycle_boundary": "cradle-to-retail",
            "measurement_scope": "exact_product", "lower_bound": 0.7, "upper_bound": 0.9,
        }
        result = COMPARE.compare_measurements(left, right)
        self.assertTrue(result["comparable"])
        self.assertAlmostEqual(0.43, result["left"]["value"])
        self.assertEqual("left", result["lowerImpact"])
        self.assertTrue(result["uncertaintyRangesOverlap"])
        self.assertTrue(result["informationalOnly"])
        self.assertFalse(result["gradeEligible"])

    def test_comparison_rejects_different_functional_units(self):
        left = {
            "metric": "water_use", "value": 100, "unit": "l",
            "functional_unit": "1 kg product", "lifecycle_boundary": "cradle_to_farm_gate",
        }
        right = {
            "metric": "water_use", "value": 80, "unit": "l",
            "functional_unit": "one serving", "lifecycle_boundary": "cradle_to_farm_gate",
        }
        result = COMPARE.compare_measurements(left, right)
        self.assertFalse(result["comparable"])
        self.assertIn("different functional unit", result["reasons"])

    def test_comparison_rejects_different_lifecycle_boundaries(self):
        left = {
            "metric": "climate_change", "value": 1, "unit": "kg_co2e",
            "functional_unit": "1 kg product", "lifecycle_boundary": "cradle_to_farm_gate",
        }
        right = {
            "metric": "climate_change", "value": 1, "unit": "kg_co2e",
            "functional_unit": "1 kg product", "lifecycle_boundary": "cradle_to_grave",
        }
        result = COMPARE.compare_measurements(left, right)
        self.assertFalse(result["comparable"])
        self.assertIn("different lifecycle boundary", result["reasons"])

    def test_compact_environmental_export_remains_informational(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "measurement.json"
            path.write_text(json.dumps(self.snapshot()), encoding="utf-8")
            output = Path(directory) / "environmental-index.json"
            with MODULE.connect(Path(directory) / "test.sqlite3") as db:
                MODULE.initialize(db)
                MODULE.ingest_environmental_snapshot(db, path)
                self.assertEqual(1, MODULE.export_environmental_index(db, output))
            payload = json.loads(output.read_text())
            record = dict(zip(payload["fields"], payload["records"][0]))
            self.assertEqual("category_estimate", record["measurementScope"])
            self.assertEqual(0, record["gradeEligible"])
            self.assertEqual("environmental_measurement_manual_research", record["sourceId"])
            provider = payload["providers"][record["sourceId"]]
            self.assertEqual("Reviewed Environmental Measurement Research", provider["label"])
            self.assertIn("attribution", provider)
            benchmark = payload["benchmarks"]["climate_change"]
            self.assertEqual(0.43, benchmark["median"])
            self.assertEqual(1, benchmark["categoryCount"])
            self.assertEqual("1 kg edible product", benchmark["functionalUnit"])


if __name__ == "__main__":
    unittest.main()
