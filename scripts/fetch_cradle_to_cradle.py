#!/usr/bin/env python3
"""Import active products from the official Cradle to Cradle Certified registry."""
from __future__ import annotations
import argparse, json, re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE_URL = "https://c2ccertified.org/certified-products"
SEARCH_URL = "https://XKGJ9S1JAX-dsn.algolia.net/1/indexes/certified_products_by_date_asc/query"
APP_ID = "XKGJ9S1JAX"
SEARCH_KEY = "d83992bb7266223bf3c8c47f2bd4f6f4"

def iso_date(value):
    return datetime.strptime(value, "%d %b %Y").date().isoformat() + "T23:59:59Z" if value else None

def fetch_page(page, hits_per_page=500):
    body = json.dumps({"params": urlencode({"hitsPerPage": hits_per_page, "page": page})}).encode()
    request = Request(SEARCH_URL, data=body, headers={"content-type": "application/json",
        "x-algolia-application-id": APP_ID, "x-algolia-api-key": SEARCH_KEY,
        "user-agent": "EthicalGrade/0.1 certification-directory-import"})
    with urlopen(request, timeout=45) as response:
        return json.load(response)

def fetch_all():
    first = fetch_page(0)
    hits = list(first.get("hits", []))
    for page in range(1, first.get("nbPages", 1)):
        hits.extend(fetch_page(page).get("hits", []))
    return hits

def certification_specs(hit):
    c = hit.get("certificate") or {}
    specs = []
    if hit.get("cradle_to_cradle_certified") and c.get("full_scope_level"):
        specs.append(("full-scope", "Cradle to Cradle Certified Full Scope", c.get("full_scope_level"), c.get("full_scope_version")))
    if hit.get("material_health_certified") and c.get("material_health_certified_level"):
        specs.append(("material-health", "Cradle to Cradle Certified Material Health", c.get("material_health_certified_level"), c.get("material_health_certified_version")))
    if c.get("certified_circularity_certificate") and c.get("certified_circularity_certificate_level"):
        specs.append(("circularity", "Cradle to Cradle Certified Circularity", c.get("certified_circularity_certificate_level"), c.get("certified_circularity_certificate_version")))
    return specs

def normalize(hit, captured_at):
    company = (hit.get("company") or {}).get("title", "").strip()
    product = str(hit.get("title") or "").strip()
    profile = "https://c2ccertified.org" + str(hit.get("url") or f"/certified-products/{hit.get('slug', '')}")
    c = hit.get("certificate") or {}
    achievements = {"materialHealth": c.get("material_health_level"), "productCircularity": c.get("material_reutilization_level"),
        "cleanAirClimateProtection": c.get("clean_air_climate_protection_level_or_renewable_energy_level"),
        "waterSoilStewardship": c.get("water_soil_stewardship_level_or_water_stewardship_level"), "socialFairness": c.get("social_fairness_level")}
    records = []
    for kind, name, level, version in certification_specs(hit):
        records.append({"id": f"cradle-to-cradle-{hit['id']}-{kind}", "brand": company, "aliases": [company],
            "status": "active certified", "scope": "product", "productNames": [product], "matchTerms": [product],
            "certificationName": name, "certificationLevel": level, "standardVersion": version,
            "certificationNumber": c.get("certification_number"),
            "categoryAchievements": {key: value for key, value in achievements.items() if value},
            "productDescription": hit.get("product_description"),
            "scopeNote": "Certification applies only to the product or product group named in this registry entry.",
            "sourceUrl": SOURCE_URL, "officialProfileUrl": profile, "verifiedAt": captured_at,
            "certifiedSince": iso_date(c.get("initial_certification_date")), "expiresAt": iso_date(c.get("valid_until")),
            "confidence": 0.95, "companyFacts": {"company_website": (hit.get("company") or {}).get("website")}})
    return records

def snapshot(records, captured_at):
    return {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured_at,
        "source": {"id": "cradle_to_cradle_product_registry", "certificationName": "Cradle to Cradle Certified", "defaultScope": "product", "recordIdPrefix": "cradle-to-cradle"}, "records": records}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path); parser.add_argument("--captured-at", required=True); parser.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args(); args.output_dir.mkdir(parents=True, exist_ok=True)
    hits = fetch_all(); records = [record for hit in hits for record in normalize(hit, args.captured_at)]
    if not records: raise RuntimeError("Cradle to Cradle registry returned no scoped certification records")
    for old in args.output_dir.glob("cradle-to-cradle-*.json"): old.unlink()
    for index in range(0, len(records), args.batch_size):
        (args.output_dir / f"cradle-to-cradle-{index // args.batch_size + 1:05d}.json").write_text(json.dumps(snapshot(records[index:index + args.batch_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    print(f"Cradle to Cradle complete: {len(hits)} products, {len(records)} certifications")

if __name__ == "__main__": main()
