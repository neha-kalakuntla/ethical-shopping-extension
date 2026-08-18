#!/usr/bin/env python3
"""Fetch GoodWeave's official certified-products business directory."""

from __future__ import annotations

import html
import json
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://goodweave.org/find-certified-products/wp-json/wp/v2"
DIRECTORY_URL = "https://goodweave.org/find-certified-products/"
OUTPUT = ROOT / "sources" / "certifications" / "goodweave.json"
USER_AGENT = "EthicalGrade/0.3 (certification directory importer)"

CATEGORY_TERMS = {
    "Carpets/Rugs": ["rug", "rugs", "carpet", "carpets"],
    "Home Textiles": ["bedding", "bed linen", "blanket", "throw blanket", "pillow", "cushion", "towel", "sheets", "sheet set", "curtain", "table linen"]
}


def fetch_json(path: str, params: dict | None = None):
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def taxonomy(rest_base: str) -> dict[int, str]:
    rows = fetch_json(rest_base, {"per_page": 100, "_fields": "id,name"})
    return {int(row["id"]): html.unescape(row["name"]).strip() for row in rows}


def main() -> None:
    categories = taxonomy("business-category")
    countries = taxonomy("country-type")
    purchaser_types = taxonomy("business-type")
    businesses = []
    page = 1
    while True:
        rows = fetch_json("business", {
            "per_page": 100, "page": page,
            "_fields": "id,slug,link,title,business-category,country-type,business-type"
        })
        businesses.extend(rows)
        print(f"fetched page {page}: {len(rows)} businesses ({len(businesses)} total)")
        if len(rows) < 100:
            break
        page += 1

    captured = date.today().isoformat()
    records = []
    for business in businesses:
        brand = html.unescape(business.get("title", {}).get("rendered") or "").strip()
        product_categories = [categories[item] for item in business.get("business-category", []) if item in categories]
        match_terms = sorted({term for category in product_categories for term in CATEGORY_TERMS.get(category, [])})
        if not brand or not match_terms:
            continue
        records.append({
            "id": f"goodweave-{business['id']}",
            "brand": brand,
            "aliases": [brand],
            "certificationName": "GoodWeave Certified",
            "status": "certified active",
            "scope": "product_category",
            "matchTerms": match_terms,
            "productCategories": product_categories,
            "confidence": 0.94,
            "sourceUrl": business.get("link") or DIRECTORY_URL,
            "officialProfileUrl": business.get("link") or DIRECTORY_URL,
            "verifiedAt": captured,
            "availableIn": [countries[item] for item in business.get("country-type", []) if item in countries],
            "scopeNote": "GoodWeave lists this business as a source of certified products in the named product categories. Matching requires both the business identity and a listed category; unrelated products from the company are not treated as certified.",
            "companyFacts": {
                "purchaser_types": [purchaser_types[item] for item in business.get("business-type", []) if item in purchaser_types]
            }
        })

    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "goodweave_certified_products",
            "certificationName": "GoodWeave Certified",
            "defaultScope": "product_category",
            "recordIdPrefix": "goodweave"
        },
        "records": records
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} category-scoped GoodWeave records")


if __name__ == "__main__":
    main()
