#!/usr/bin/env python3
"""Fetch EPA's official WaterSense labeled-product CSV export."""

from __future__ import annotations

import csv
import io
import json
import re
import time
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://lookforwatersense.epa.gov"
ENVIRONMENT_URL = f"{SITE}/api/environment"
OUTPUT = ROOT / "sources" / "certifications" / "epa-watersense.json"


def get_json(url, headers=None):
    request = urllib.request.Request(url, headers={"Accept": "application/json", "Origin": SITE, "Referer": f"{SITE}/", "User-Agent": "EthicalGrade/0.3", **(headers or {})})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def split_codes(value):
    return sorted({code for code in re.findall(r"\d+", value or "") if 8 <= len(code) <= 14})


def clean(value):
    return " ".join(str(value or "").replace("\ufeff", "").split())


def main():
    environment = get_json(ENVIRONMENT_URL)
    api_headers = {"X-Api-Key": environment["API_KEY"]}
    download_url = get_json(f"{environment['API_BASE_URL']}/downloadLinks", api_headers)["products"]
    request = urllib.request.Request(download_url, headers={"User-Agent": "EthicalGrade/0.3"})
    with urllib.request.urlopen(request, timeout=180) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))

    captured = date.today().isoformat()
    records = []
    seen = set()
    for filename in sorted(archive.namelist()):
        if not filename.lower().endswith(".csv"):
            continue
        product_type = filename.removeprefix("WaterSense-Products-").removesuffix(".csv")
        rows = csv.DictReader(io.TextIOWrapper(archive.open(filename), encoding="utf-8-sig", newline=""))
        for row in rows:
            brand = clean(row.get("Brand Name"))
            model_name = clean(row.get("Model Name"))
            model_number = clean(row.get("Model Number"))
            if not brand or not model_number:
                continue
            key = (brand.casefold(), model_number.casefold(), product_type.casefold())
            if key in seen:
                continue
            seen.add(key)
            safe_id = re.sub(r"[^a-z0-9]+", "-", f"{brand}-{model_number}-{product_type}".casefold()).strip("-")
            efficiency = {clean(name): clean(value) for name, value in row.items() if name not in {"Brand Name", "Model Name", "Model Number", "Universal Product Code(s)"} and clean(value)}
            records.append({
                "id": f"watersense-{safe_id}",
                "brand": brand,
                "aliases": [brand],
                "certificationName": "WaterSense Labeled",
                "status": "certified active",
                "scope": "product",
                "productNames": [model_name] if model_name else [],
                "matchTerms": [model_number],
                "gtins": split_codes(row.get("Universal Product Code(s)")),
                "productCategories": [product_type],
                "confidence": 0.99,
                "sourceUrl": SITE,
                "officialProfileUrl": SITE,
                "verifiedAt": captured,
                "scopeNote": "WaterSense applies only to this exact listed model or UPC, not every product from the brand.",
                "companyFacts": {"watersense_efficiency": efficiency},
            })

    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {"id": "epa_watersense_products", "certificationName": "WaterSense Labeled", "defaultScope": "product", "recordIdPrefix": "watersense"},
        "records": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} EPA WaterSense labeled product models")


if __name__ == "__main__":
    main()
