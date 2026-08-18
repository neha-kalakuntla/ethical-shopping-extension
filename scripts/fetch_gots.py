#!/usr/bin/env python3
"""Import the official GOTS Certified Suppliers directory with retail-safe scope."""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE_URL = "https://global-standard.org/find-suppliers-shops-and-inputs/certifiedsuppliers"
API_URL = "https://www.global-trace-base.org/website-api/v2/certified-suppliers"
CATEGORY_TERMS = {
    "babies' apparel": ["baby", "babies", "infant", "bodysuit", "onesie"],
    "children's apparel": ["childrens", "children", "kids", "toddler"],
    "women's apparel": ["womens", "women", "dress", "skirt", "blouse", "bra"],
    "men's apparel": ["mens", "men", "shirt", "trousers"],
    "unisex apparel": ["unisex", "shirt", "t-shirt", "hoodie", "sweater"],
    "home textiles": ["towel", "bedding", "sheet", "blanket", "pillow", "cushion", "linen", "curtain"],
    "carried accessories": ["bag", "handbag", "tote", "pouch", "scarf", "accessory"],
}

def slug(value): return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", str(value).lower().replace("&", " and ")))
def split_values(value): return list(dict.fromkeys(part.strip() for part in re.split(r"[,;|]", value or "") if part.strip()))

def fetch_page(offset, limit=100):
    query = urlencode({"offset": offset, "limit": limit, "sort": "company_name", "direction": "ASC"})
    request = Request(f"{API_URL}?{query}", headers={"Accept": "application/json", "Origin": "https://global-standard.org",
        "Referer": "https://global-standard.org/", "User-Agent": "Mozilla/5.0 EthicalGrade/0.1"})
    with urlopen(request, timeout=90) as response: return json.load(response)

def fetch_all():
    first = fetch_page(0); items = list(first.get("items", [])); total = first.get("total", 0)
    for offset in range(len(items), total, 100): items.extend(fetch_page(offset).get("items", []))
    if len(items) != total: raise RuntimeError(f"GOTS API returned {len(items)} of {total} records")
    return items

def product_terms(categories):
    terms = []
    for category in split_values(categories):
        terms.append(category)
        terms.extend(CATEGORY_TERMS.get(category.lower(), []))
    return list(dict.fromkeys(terms))

def normalize(item, captured_at):
    system_id = item["system_id"]
    categories = split_values(item.get("product_category"))
    terms = product_terms(item.get("product_category"))
    brand_aliases = split_values(item.get("brand_names"))
    return {"id": f"gots-{slug(system_id)}", "brand": item["company_name"], "aliases": brand_aliases,
        "status": "listed certified", "scope": "product", "productNames": terms, "matchTerms": terms,
        "certificationName": "Global Organic Textile Standard (GOTS)", "gotsSystemId": system_id,
        "productCategories": categories, "extensionEligible": bool(brand_aliases), "geography": item.get("country"),
        "scopeNote": "A directory listing certifies only the supplier's listed textile scope. Retail matching additionally requires an explicit GOTS claim on the product page.",
        "sourceUrl": SOURCE_URL, "officialProfileUrl": f"{SOURCE_URL}?gtbid={system_id}", "verifiedAt": captured_at,
        "confidence": 0.93, "companyFacts": {"country": item.get("country"), "brand_names": split_values(item.get("brand_names"))}}

def snapshot(records, captured_at):
    return {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured_at,
        "source": {"id": "gots_certified_suppliers", "certificationName": "Global Organic Textile Standard (GOTS)", "defaultScope": "product", "recordIdPrefix": "gots"}, "records": records}

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("output_dir", type=Path)
    parser.add_argument("--captured-at", required=True); parser.add_argument("--batch-size", type=int, default=500); args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True); records = [normalize(item, args.captured_at) for item in fetch_all()]
    for old in args.output_dir.glob("gots-*.json"): old.unlink()
    for index in range(0, len(records), args.batch_size):
        (args.output_dir / f"gots-{index // args.batch_size + 1:05d}.json").write_text(json.dumps(snapshot(records[index:index + args.batch_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    print(f"GOTS complete: {len(records)} certified suppliers")

if __name__ == "__main__": main()
