#!/usr/bin/env python3
"""Fetch The Change Climate Project's official certified-brand directory."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "https://explore.changeclimate.org/"
OUTPUT = ROOT / "sources" / "certifications" / "change-climate.json"


def embedded_brands(page):
    decoder = json.JSONDecoder()
    for encoded in re.findall(r'<script>self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', page, re.DOTALL):
        try:
            decoded = json.loads(f'"{encoded}"')
        except json.JSONDecodeError:
            continue
        marker = '"brands":'
        offset = decoded.find(marker)
        if offset < 0:
            continue
        brands, _ = decoder.raw_decode(decoded[offset + len(marker):])
        if isinstance(brands, list):
            return brands
    raise RuntimeError("Certified brand data was not found in the official directory page")


def main():
    request = urllib.request.Request(URL, headers={"Accept": "text/html", "User-Agent": "EthicalGrade/0.3"})
    with urllib.request.urlopen(request, timeout=90) as response:
        page = response.read().decode("utf-8", "replace")
    captured = date.today().isoformat()
    records = []
    for brand in embedded_brands(page):
        name = str(brand.get("name") or "").strip()
        slug = str(brand.get("slug") or "").strip()
        if not name or not slug or brand.get("isCertificationExpired"):
            continue
        records.append({
            "id": f"climate-label-{slug}", "brand": name, "aliases": [name],
            "status": "certified active", "scope": "brand",
            "scopeNote": "Brand-level certification under The Climate Label; it does not establish that an individual retail item has zero emissions.",
            "confidence": 0.92, "certifiedSince": brand.get("firstCertifiedYear"),
            "sourceUrl": f"{URL}brand/{slug}", "officialProfileUrl": f"{URL}brand/{slug}",
            "verifiedAt": captured, "geography": brand.get("region"),
            "companyFacts": {
                "industry": brand.get("industry"), "website": brand.get("websiteUrl"),
                "parent_brand": brand.get("parentName"), "first_certified_year": brand.get("firstCertifiedYear"),
                "last_certified_year": brand.get("lastCertifiedYear"),
                "active_reduction_plans": brand.get("activeReductionPlans"),
                "completed_reduction_plans": brand.get("completedReductionPlans"),
                "science_aligned_reduction_targets": brand.get("activeSbtis"),
                "footprint_tco2e": brand.get("assuredFootprintTotalMarket"),
                "climate_solution_funding_usd": brand.get("totalFunding"),
                "is_child_brand": bool(brand.get("isChildBrand")),
                "is_supporting_brand": bool(brand.get("isSupportingBrand")),
            },
        })
    payload = {
        "schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured,
        "source": {"id": "change_climate_certified_brand_directory", "certificationName": "The Climate Label", "defaultScope": "brand", "recordIdPrefix": "climate-label"},
        "records": records,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} active Climate Label brands")


if __name__ == "__main__":
    main()
