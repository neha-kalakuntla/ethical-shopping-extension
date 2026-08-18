#!/usr/bin/env python3
"""Collect the official Certified Humane company/product directory."""

from __future__ import annotations

import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = "https://certifiedhumane.org/whos-certified/"


def clean(value):
    return " ".join(html.unescape(value or "").split())


class DirectoryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = self.in_row = self.in_cell = False
        self.cell = []
        self.row = []
        self.rows = []
        self.link = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table" and attrs.get("id") == "tablepress-4": self.in_table = True
        elif self.in_table and tag == "tr": self.in_row, self.row = True, []
        elif self.in_row and tag in {"td", "th"}: self.in_cell, self.cell, self.link = True, [], None
        elif self.in_cell and tag == "a": self.link = attrs.get("href")
        elif self.in_cell and tag == "br": self.cell.append(" ; ")

    def handle_data(self, data):
        if self.in_cell: self.cell.append(data)

    def handle_endtag(self, tag):
        if self.in_cell and tag in {"td", "th"}:
            self.row.append({"text": clean("".join(self.cell)), "link": self.link})
            self.in_cell = False
        elif self.in_row and tag == "tr":
            if self.row: self.rows.append(self.row)
            self.in_row = False
        elif self.in_table and tag == "table": self.in_table = False


def parse_rows(page):
    parser = DirectoryParser()
    parser.feed(page)
    return [row for row in parser.rows if len(row) >= 2 and row[0]["text"] != "COMPANY"]


def split_terms(value):
    values = re.split(r"\s*(?:,|\s+&\s+|\s+and\s+)\s*", value, flags=re.IGNORECASE)
    return [clean(item).strip(" .") for item in values if len(clean(item).strip(" .")) >= 4]


def product_term_variants(value):
    variants = [value]
    simplified = clean(re.sub(r"\b(?:uncured|italian)\b", " ", value, flags=re.IGNORECASE))
    if simplified != value and len(simplified.split()) >= 2:
        variants.append(simplified)
    return variants


def brand_variants(value):
    variants = [clean(value)]
    simplified = clean(re.sub(r"[®™]", "", value))
    simplified = clean(re.sub(r"\b(?:fine meats)\b$", "", simplified, flags=re.IGNORECASE))
    if simplified and simplified not in variants:
        variants.append(simplified)
    return variants


PRODUCT_MARKER = re.compile(
    r"\b(?:cage[- ]?free|free[- ]?range|pasture[- ]?raised|organic|non[- ]?gmo|"
    r"eggs?|chickens?|beef|pork|turkeys?|lamb|milk|cheese|yogurt|sausages?|"
    r"hot dogs?|meat|seafood|goats?)\b",
    re.IGNORECASE,
)


def is_safe_brand_heading(value):
    value = clean(value).strip(" ,-.")
    return bool(value and len(value) <= 80 and len(value.split()) <= 8 and not PRODUCT_MARKER.search(value))


def parse_product_segment(company, segment):
    """Return a brand/product pair only when the row makes the pairing unambiguous."""
    if ":" in segment:
        heading, details = segment.split(":", 1)
        # Some directory cells contain another retailer heading after a stray colon.
        # Skipping that ambiguous fragment is safer than transferring products between brands.
        if ":" in details or not is_safe_brand_heading(heading):
            return None
        brands = [variant for brand in (split_terms(heading) or [clean(heading)]) for variant in brand_variants(brand)]
        return brands, details

    marker = PRODUCT_MARKER.search(segment)
    if marker and marker.start() > 0:
        heading = segment[:marker.start()].strip(" ,-.")
        if is_safe_brand_heading(heading):
            return [heading], segment[marker.start():]
    return [company], segment


def product_rules(company, products):
    rules = []
    for segment in re.split(r"\s*;\s*", products):
        segment = clean(segment)
        if not segment: continue
        parsed = parse_product_segment(company, segment)
        if not parsed: continue
        brands, details = parsed
        terms = list(dict.fromkeys(variant for term in split_terms(details) for variant in product_term_variants(term)))
        if terms:
            rules.append({"brands": brands, "terms": terms})
    return rules


def normalize_row(row, captured_at):
    company = row[0]["text"]
    products = row[1]["text"]
    website = row[2].get("link") if len(row) > 2 else None
    if not company or not products:
        raise ValueError("missing company or certified products")
    rules = product_rules(company, products)
    if not rules:
        raise ValueError("could not derive safe product rules")
    aliases = list(dict.fromkeys([company, *(brand for rule in rules for brand in rule["brands"])]))
    terms = list(dict.fromkeys(term for rule in rules for term in rule["terms"]))
    slug = re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", company.lower().replace("&", " and ")))
    return {
        "id": f"certified-humane-{slug}",
        "brand": company,
        "aliases": aliases,
        "status": "listed certified",
        "scope": "product",
        "productNames": terms,
        "matchTerms": terms,
        "productRules": rules,
        "certifiedProductText": products,
        "scopeNote": "Only the products explicitly listed in the Certified Humane directory and carrying its logo are certified; other products from the company may be uncertified.",
        "sourceUrl": SOURCE_URL,
        "officialProfileUrl": SOURCE_URL,
        "verifiedAt": captured_at,
        "confidence": 0.86,
        "companyFacts": {"company_website": website} if website else {},
    }


def snapshot(records, captured_at):
    return {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured_at,
        "source": {"id": "certified_humane_directory", "certificationName": "Certified Humane Raised and Handled", "defaultScope": "product", "recordIdPrefix": "certified-humane"},
        "records": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--raw", type=Path)
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()
    request = Request(SOURCE_URL, headers={"User-Agent": "EthicalGrade/0.1 certification-directory-import"})
    with urlopen(request, timeout=30) as response: page = response.read().decode("utf-8")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_path = args.raw or args.output_dir / "directory.html"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(page)
    accepted, rejected = [], []
    for row in parse_rows(page):
        try: accepted.append(normalize_row(row, args.captured_at))
        except ValueError as error: rejected.append({"company": row[0]["text"] if row else "", "error": str(error)})
    for index in range(0, len(accepted), args.batch_size):
        path = args.output_dir / f"certified-humane-{index // args.batch_size + 1:05d}.json"
        path.write_text(json.dumps(snapshot(accepted[index:index + args.batch_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    args.output_dir.joinpath("rejected.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in rejected))
    print(f"Certified Humane complete: {len(accepted)} accepted, {len(rejected)} rejected")


if __name__ == "__main__": main()
