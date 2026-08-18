#!/usr/bin/env python3
"""Import the official Regenerative Organic Certified brand/product directory."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = "https://regenorganic.org/product-directory/"


def clean(value):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value or "")).split())


def slug(value):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", " and ")))


def parse_directory(page):
    entries = []
    chunks = re.split(r'<div class="wpex-card-modal-title[^>]*">', page)[1:]
    for chunk in chunks:
        brand_match = re.match(r"(.*?)</div>", chunk, re.DOTALL)
        products = [clean(value) for value in re.findall(r'<span class="product-name">(.*?)</span>', chunk, re.DOTALL)]
        profile_match = re.search(r'href="(https://regenorganic\.org/roc_brands_products/[^"]+/)"', chunk)
        website_match = re.search(r'<p><a href="(https?://(?!regenorganic\.org)[^"]+)"', chunk)
        brand = clean(brand_match.group(1)) if brand_match else ""
        if brand and products and profile_match:
            entries.append({"brand": brand, "products": list(dict.fromkeys(filter(None, products))),
                "profile": profile_match.group(1), "website": website_match.group(1) if website_match else None})
    return entries


def normalize(entry, captured_at):
    return {
        "id": f"regenerative-organic-{slug(entry['profile'].rstrip('/').rsplit('/', 1)[-1])}",
        "brand": entry["brand"],
        "aliases": [entry["brand"]],
        "status": "listed certified",
        "scope": "product",
        "productNames": entry["products"],
        "matchTerms": entry["products"],
        "certificationName": "Regenerative Organic Certified",
        "scopeNote": "Only products explicitly listed in the Regenerative Organic Alliance directory are in scope; other products from the brand are not implied to be certified.",
        "sourceUrl": SOURCE_URL,
        "officialProfileUrl": entry["profile"],
        "verifiedAt": captured_at,
        "confidence": 0.93,
        "companyFacts": {"company_website": entry["website"]} if entry.get("website") else {},
    }


def snapshot(records, captured_at):
    return {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured_at,
        "source": {"id": "regenerative_organic_product_directory", "certificationName": "Regenerative Organic Certified", "defaultScope": "product", "recordIdPrefix": "regenerative-organic"},
        "records": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--raw", type=Path)
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()
    request = Request(SOURCE_URL, headers={"User-Agent": "EthicalGrade/0.1 certification-directory-import"})
    with urlopen(request, timeout=45) as response:
        page = response.read().decode("utf-8")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_path = args.raw or args.output_dir / "directory.html"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(page)
    records = [normalize(entry, args.captured_at) for entry in parse_directory(page)]
    if not records:
        raise RuntimeError("Regenerative Organic directory returned no scoped records")
    for old in args.output_dir.glob("regenerative-organic-*.json"):
        old.unlink()
    for index in range(0, len(records), args.batch_size):
        args.output_dir.joinpath(f"regenerative-organic-{index // args.batch_size + 1:05d}.json").write_text(
            json.dumps(snapshot(records[index:index + args.batch_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    print(f"Regenerative Organic complete: {len(records)} brands, {sum(len(r['productNames']) for r in records)} listed products")


if __name__ == "__main__":
    main()
