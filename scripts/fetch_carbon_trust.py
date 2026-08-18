#!/usr/bin/env python3
"""Fetch the Carbon Trust's public product-label directory."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://label.carbontrust.com"
PRODUCTS_URL = f"{BASE_URL}/api/v1/products"
OUTPUT = ROOT / "sources" / "certifications" / "carbon-trust.json"
PAGE_SIZE = 50


def get_json(url: str):
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "EthicalGrade/0.3"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def fetch_listing(getter=get_json) -> list[dict]:
    products = []
    offset = 0
    while True:
        query = urllib.parse.urlencode({"offset": offset, "limit": PAGE_SIZE})
        page = getter(f"{PRODUCTS_URL}?{query}")
        if not isinstance(page, list):
            raise RuntimeError("Carbon Trust product endpoint returned an unexpected payload")
        products.extend(page)
        if len(page) < PAGE_SIZE:
            return products
        offset += PAGE_SIZE


def normalize_record(summary: dict, detail: dict, captured: str) -> dict:
    external_id = str(detail.get("id") or summary.get("id") or "").strip()
    brand = str(detail.get("license_holders_name") or summary.get("license_holders_name") or "").strip()
    product = str(detail.get("product_name") or summary.get("product_name") or "").strip()
    if not external_id or not brand or not product:
        raise ValueError("Carbon Trust record lacks an id, license holder, or product name")

    variants = detail.get("product_variants") if isinstance(detail.get("product_variants"), list) else []
    variant_names = [str(item.get("name") or "").strip() for item in variants if isinstance(item, dict)]
    product_names = list(dict.fromkeys(name for name in [product, *variant_names] if name))
    countries = sorted({
        str(country).strip()
        for item in variants if isinstance(item, dict)
        for country in (item.get("countries") or []) if str(country).strip()
    })
    regions = sorted({
        str(region).strip()
        for item in variants if isinstance(item, dict)
        for region in (item.get("regions") or []) if str(region).strip()
    })
    claim_type = str(detail.get("claim_type") or "").strip()
    expires = str(detail.get("expiration_date") or "").strip()
    profile_url = f"{BASE_URL}/claims/{urllib.parse.quote(external_id, safe='')}"

    return {
        "id": f"carbon-trust-{external_id.lower()}",
        "brand": brand,
        "aliases": [brand],
        "certificationName": "Carbon Trust Product Carbon Footprint Label",
        "status": "verified active",
        "scope": "product",
        "productNames": product_names,
        "matchTerms": product_names,
        "confidence": 0.96,
        "certifiedSince": detail.get("verified_since"),
        "expiresAt": f"{expires}T23:59:59Z" if expires else None,
        "certificationNumber": detail.get("license_number"),
        "sourceUrl": profile_url,
        "officialProfileUrl": profile_url,
        "verifiedAt": captured,
        "geography": ", ".join(countries),
        "scopeNote": (
            f"Carbon Trust verified product-level claim: {claim_type}. "
            "It applies only to the listed product and variants in the listed markets."
        ),
        "claimType": claim_type,
        "productVariants": variants,
        "availableIn": countries,
        "regions": regions,
        "sector": detail.get("sector"),
        "licenseDocumentUrl": detail.get("license_document_url"),
        "moreInfoUrl": detail.get("more_info_link"),
        "productCarbonFootprintRange": detail.get("product_carbon_footprint_range"),
        "reductionRange": detail.get("range_of_reductions_per_product"),
        "percentLowerThanRange": detail.get("range_percent_lower_than"),
    }


def main() -> None:
    captured = date.today().isoformat()
    records = []
    for summary in fetch_listing():
        external_id = str(summary.get("id") or "").strip()
        if not external_id:
            continue
        detail = get_json(f"{PRODUCTS_URL}/{urllib.parse.quote(external_id, safe='')}")
        records.append(normalize_record(summary, detail, captured))

    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "carbon_trust_product_label_directory",
            "certificationName": "Carbon Trust Product Carbon Footprint Label",
            "defaultScope": "product",
            "recordIdPrefix": "carbon-trust",
        },
        "records": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} Carbon Trust product-label records to {OUTPUT}")


if __name__ == "__main__":
    main()
