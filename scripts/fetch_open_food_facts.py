#!/usr/bin/env python3
"""Fetch targeted barcode records from the official Open Food Facts API."""

import argparse
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ",".join((
    "code", "product_name", "brands", "brands_tags", "categories", "categories_tags",
    "ingredients_text", "ingredients", "allergens", "allergens_tags", "traces", "traces_tags",
    "labels", "labels_tags", "nutriments", "nutriscore_grade", "nova_group",
    "ecoscore_grade", "environmental_score_grade", "packaging", "packagings",
    "countries_tags", "image_front_url", "last_modified_t",
))


def timestamp():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("barcodes", nargs="+")
    parser.add_argument("--output", type=Path, default=ROOT / "sources" / "products" / "open-food-facts")
    parser.add_argument("--base-url", default="https://world.openfoodfacts.org")
    args = parser.parse_args()
    contact = os.environ.get("ETHICAL_GRADE_CONTACT", "https://github.com/neha-purple/ethical-shopping-extension")
    user_agent = f"EthicalGrade/0.1 ({contact})"
    args.output.mkdir(parents=True, exist_ok=True)
    for raw_code in args.barcodes:
        code = re.sub(r"\D", "", raw_code)
        if not 8 <= len(code) <= 14:
            raise SystemExit(f"Invalid barcode: {raw_code}")
        query = urllib.parse.urlencode({"product_type": "food", "cc": "us", "lc": "en", "tags_lc": "en", "fields": FIELDS})
        request = urllib.request.Request(f"{args.base_url}/api/v3.6/product/{code}?{query}", headers={"User-Agent": user_agent, "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        product = payload.get("product")
        if not product:
            print(f"not found: {code}")
            continue
        snapshot = {
            "schemaVersion": 1,
            "kind": "open_food_facts_product",
            "capturedAt": timestamp(),
            "source": {
                "id": "open_food_facts",
                "label": "Open Food Facts",
                "issuer": "Open Food Facts",
                "sourceType": "community_product_database",
                "homepageUrl": "https://world.openfoodfacts.org",
            },
            "records": [product],
        }
        path = args.output / f"{code}.json"
        path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n")
        print(f"saved {code}: {product.get('product_name') or 'unnamed product'} -> {path}")


if __name__ == "__main__":
    main()
