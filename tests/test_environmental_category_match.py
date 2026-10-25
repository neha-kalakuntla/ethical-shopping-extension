import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "match_environmental_category", ROOT / "scripts" / "match_environmental_category.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CATEGORIES = MODULE.load_category_names(ROOT / "sources" / "environmental" / "owid-poore-nemecek-food-impacts.json")


class EnvironmentalCategoryMatchTests(unittest.TestCase):
    def test_matches_simple_fresh_product_title(self):
        result = MODULE.match_category("Fresh organic apples, 3 lb", CATEGORIES)
        self.assertTrue(result["matched"])
        self.assertEqual("Apples", result["category"])
        self.assertEqual("category_estimate", result["measurementScope"])
        self.assertFalse(result["gradeEligible"])

    def test_matches_one_produce_variety_prefix(self):
        result = MODULE.match_category("Honeycrisp Apple", CATEGORIES)
        self.assertTrue(result["matched"])
        self.assertEqual("Apples", result["category"])

    def test_matches_fresh_produce_packaging_descriptor(self):
        result = MODULE.match_category("Banana Bunch (4-5 Count)", CATEGORIES)
        self.assertTrue(result["matched"])
        self.assertEqual("Bananas", result["category"])

    def test_rejects_processed_pet_treat(self):
        result = MODULE.match_category("Milk-Bone Spooky Biscuits Halloween Dog Treats", CATEGORIES)
        self.assertFalse(result["matched"])
        self.assertIn("processed", result["reason"])

    def test_rejects_processed_product_with_category_word(self):
        result = MODULE.match_category("Organic apple cinnamon breakfast cereal", CATEGORIES)
        self.assertFalse(result["matched"])
        self.assertIn("processed", result["reason"])

    def test_does_not_use_ingredient_mentions(self):
        result = MODULE.match_category(
            "Morning breakfast bites",
            CATEGORIES,
            ingredients="oats, apples, cane sugar",
        )
        self.assertFalse(result["matched"])

    def test_matches_exact_structured_category_despite_brand_title(self):
        result = MODULE.match_category(
            "Example Farms Sweet Green Peas",
            CATEGORIES,
            structured_categories=["Peas"],
        )
        self.assertTrue(result["matched"])
        self.assertEqual("Peas", result["category"])
        self.assertEqual("structured product category", result["evidence"])

    def test_rejects_ambiguous_beef_category(self):
        result = MODULE.match_category("Ground beef", CATEGORIES)
        self.assertFalse(result["matched"])
        self.assertEqual("no high-confidence category match", result["reason"])

    def test_keeps_category_estimate_informational(self):
        result = MODULE.match_category("Banana", CATEGORIES)
        self.assertTrue(result["informationalOnly"])
        self.assertFalse(result["gradeEligible"])


if __name__ == "__main__":
    unittest.main()
