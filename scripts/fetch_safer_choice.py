#!/usr/bin/env python3
"""Fetch EPA's official Safer Choice-certified product dataset."""

from __future__ import annotations
import html, json, re, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "https://www.epa.gov/saferchoice/products"
OUTPUT = ROOT / "sources" / "certifications" / "epa-safer-choice.json"

def split_codes(value):
    return sorted({code for code in re.findall(r"\d+", value or "") if 8 <= len(code) <= 14})

def main():
    request = urllib.request.Request(URL, headers={"Accept": "text/html", "User-Agent": "EthicalGrade/0.3"})
    with urllib.request.urlopen(request, timeout=90) as response:
        page = response.read().decode("utf-8", "replace")
    match = re.search(r"\bvar\s+dataSet\s*=\s*(\[.*?\])\s*;", page, re.DOTALL)
    if not match:
        raise RuntimeError("EPA Safer Choice dataSet was not found")
    rows = json.loads(match.group(1))
    products = {}
    for row in rows:
        product_id = str(row.get("Id") or "").strip()
        name = html.unescape(str(row.get("Name") or "")).strip()
        raw_partner = html.unescape(str(row.get("Partner") or "")).strip()
        overdue = raw_partner.startswith("‡")
        partner = raw_partner.lstrip("‡").strip()
        if not product_id or not name or not partner:
            continue
        item = products.setdefault(product_id, {"name": name, "partner": partner, "overdue": overdue, "since": str(row.get("PartnerSince") or "").strip(), "gtins": set(), "categories": set(), "sectors": set(), "fragranceFree": False, "outdoorUse": False})
        item["gtins"].update(split_codes(str(row.get("UPCs") or "")))
        if row.get("sectorType"): item["categories"].add(str(row["sectorType"]).strip())
        if row.get("sector"): item["sectors"].add(str(row["sector"]).strip())
        item["fragranceFree"] |= str(row.get("fragrance") or "").lower() == "yes"
        item["outdoorUse"] |= str(row.get("releases") or "").lower() == "yes"
        item["overdue"] |= overdue
    captured = date.today().isoformat()
    records = []
    for product_id, product in sorted(products.items(), key=lambda pair: (pair[1]["partner"].casefold(), pair[1]["name"].casefold())):
        records.append({"id": f"safer-choice-{product_id.lower()}", "brand": product["partner"], "aliases": [product["partner"]], "certificationName": "EPA Safer Choice Certified", "status": "certified review overdue" if product["overdue"] else "certified active", "scope": "product", "productNames": [product["name"]], "matchTerms": [product["name"]], "gtins": sorted(product["gtins"]), "productCategories": sorted(product["categories"]), "confidence": 0.88 if product["overdue"] else 0.96, "certifiedSince": product["since"] or None, "sourceUrl": URL, "officialProfileUrl": f"{URL}#search={product_id}", "verifiedAt": captured, "scopeNote": "EPA Safer Choice certification applies to this listed product, not every product made or sold by the partner company.", "companyFacts": {"sectors": sorted(product["sectors"]), "fragrance_free_verified": product["fragranceFree"], "outdoor_use_criteria": product["outdoorUse"], "partnership_review_overdue": product["overdue"]}})
    payload = {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured, "source": {"id": "epa_safer_choice_products", "certificationName": "EPA Safer Choice Certified", "defaultScope": "product", "recordIdPrefix": "safer-choice"}, "records": records}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} unique EPA Safer Choice products from {len(rows)} directory rows")

if __name__ == "__main__": main()
