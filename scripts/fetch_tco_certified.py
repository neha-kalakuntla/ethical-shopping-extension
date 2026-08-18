#!/usr/bin/env python3
"""Fetch and compact TCO Certified's public Product Finder dataset."""

from __future__ import annotations

import json
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "https://industry.tcocertified.com/product-finder-app/items-get.php"
OUTPUT = ROOT / "sources" / "certifications" / "tco-certified.json"


def main() -> None:
    request = urllib.request.Request(URL, headers={"Accept": "application/json", "User-Agent": "EthicalGrade/0.3"})
    with urllib.request.urlopen(request, timeout=90) as response:
        products = json.load(response)
    captured = date.today().isoformat()
    records = []
    for product in products:
        brand = str(product.get("brand") or "").strip()
        name = str(product.get("name") or "").strip()
        expiry = str(product.get("cert_expiry_date") or "").strip()
        if not brand or not name or str(product.get("search", "1")) != "1":
            continue
        idkey = str(product.get("idkey") or product.get("id") or "").strip()
        records.append({
            "id": f"tco-{idkey.lower()}",
            "brand": brand,
            "aliases": [brand],
            "certificationName": "TCO Certified",
            "status": "certified active",
            "scope": "product",
            "productNames": [name],
            "matchTerms": [name],
            "confidence": 0.96,
            "certifiedSince": product.get("cert_date"),
            "expiresAt": f"{expiry}T23:59:59Z" if expiry else None,
            "certificationNumber": product.get("cert_no"),
            "standardVersion": product.get("generation"),
            "productCategories": [product.get("category")] if product.get("category") else [],
            "sourceUrl": "https://industry.tcocertified.com/product-finder/",
            "officialProfileUrl": f"https://industry.tcocertified.com/product-finder/?product={idkey}",
            "verifiedAt": captured,
            "scopeNote": "Certification applies to the listed product model, not every product from the brand."
        })
    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "tco_certified_product_finder",
            "certificationName": "TCO Certified",
            "defaultScope": "product",
            "recordIdPrefix": "tco"
        },
        "records": records
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} TCO Certified product records to {OUTPUT}")


if __name__ == "__main__":
    main()
