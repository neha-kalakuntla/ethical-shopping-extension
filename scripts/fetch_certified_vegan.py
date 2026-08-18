#!/usr/bin/env python3
"""Import Vegan Action's official product-level Certified Vegan directory."""

from __future__ import annotations

import argparse
import html
import json
import re
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

API_URL = "https://vegan.org/wp-json/wp/v2/vegan_products"
DIRECTORY_URL = "https://vegan.org/certified-products"
COMPANIES_URL = "https://vegan.org/certification/companies-using-our-logo"


def clean(value):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value or "")).split())


def normalized(value):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", clean(value).lower().replace("&", " and ")).split())


def hostname(value):
    return urlparse(value or "").netloc.lower().removeprefix("www.")


class CompanyParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_entry = False
        self.name_parts = []
        self.link = None
        self.companies = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "p" and "wp-block-paragraph" in attrs.get("class", ""):
            self.in_entry, self.name_parts, self.link = True, [], None
        elif self.in_entry and tag == "a":
            self.link = attrs.get("href")

    def handle_data(self, data):
        if self.in_entry and not self.link:
            self.name_parts.append(data)

    def handle_endtag(self, tag):
        if tag == "p" and self.in_entry:
            name = clean("".join(self.name_parts))
            if name and self.link and hostname(self.link):
                self.companies.append((name, self.link))
            self.in_entry = False


def parse_companies(page):
    parser = CompanyParser()
    parser.feed(page)
    return parser.companies


def product_terms(title, brand):
    terms = [clean(title)]
    title_norm, brand_norm = normalized(title), normalized(brand)
    if brand_norm and title_norm.startswith(f"{brand_norm} "):
        words = clean(title).split()
        brand_words = len(clean(brand).split())
        remainder = clean(" ".join(words[brand_words:]))
        if len(normalized(remainder)) >= 8 and len(normalized(remainder).split()) >= 2:
            terms.append(remainder)
    return list(dict.fromkeys(terms))


def fetch_json(page):
    url = f"{API_URL}?per_page=100&page={page}&orderby=id&order=asc"
    request = Request(url, headers={"User-Agent": "EthicalGrade/0.1 certification-directory-import"})
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read()), int(response.headers.get("X-WP-TotalPages", "1"))


def fetch_text(url):
    request = Request(url, headers={"User-Agent": "EthicalGrade/0.1 certification-directory-import"})
    with urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8")


def slug(value):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", " and ")))


def build_records(products, companies, captured_at):
    by_host = defaultdict(list)
    for name, website in companies:
        by_host[hostname(website)].append(name)
    company_names = list(dict.fromkeys(name for name, _ in companies))
    grouped = {}
    rejected = []
    for product in products:
        title = clean(product.get("title", {}).get("rendered"))
        website = product.get("acf", {}).get("vp_company_website", {}).get("value") or ""
        host = hostname(website)
        candidates = by_host.get(host, [])
        if not title or not host:
            rejected.append({"id": product.get("id"), "title": title, "website": website, "reason": "company mapping unavailable"})
            continue
        title_norm = normalized(title)
        prefix = [name for name in candidates if title_norm == normalized(name) or title_norm.startswith(f"{normalized(name)} ")]
        if not prefix:
            prefix = [name for name in company_names if title_norm == normalized(name) or title_norm.startswith(f"{normalized(name)} ")]
        if prefix:
            brand = max(prefix, key=lambda value: len(normalized(value)))
        elif not candidates:
            domain_brand = host.split(".")[0].replace("-", " ")
            if title_norm != normalized(domain_brand) and not title_norm.startswith(f"{normalized(domain_brand)} "):
                rejected.append({"id": product.get("id"), "title": title, "website": website, "reason": "company mapping unavailable"})
                continue
            brand = clean(title[:len(domain_brand)])
        else:
            brand = max(candidates, key=lambda value: len(normalized(value)))
        key = (normalized(brand), host)
        entry = grouped.setdefault(key, {"brand": brand, "website": website, "terms": [], "profiles": []})
        entry["terms"].extend(product_terms(title, brand))
        entry["profiles"].append(product.get("link"))

    records = []
    for (_, host), entry in grouped.items():
        terms = list(dict.fromkeys(filter(None, entry["terms"])))
        records.append({
            "id": f"certified-vegan-{slug(entry['brand'])}-{slug(host)}",
            "brand": entry["brand"],
            "aliases": [entry["brand"]],
            "status": "certified",
            "scope": "product",
            "productNames": terms,
            "matchTerms": terms,
            "certificationName": "Certified Vegan",
            "scopeNote": "Vegan Action certifies only the products listed in its database, not the company's entire product line.",
            "sourceUrl": DIRECTORY_URL,
            "officialProfileUrl": DIRECTORY_URL,
            "verifiedAt": captured_at,
            "confidence": 0.92,
            "companyFacts": {"company_website": entry["website"], "certified_product_profiles": list(dict.fromkeys(filter(None, entry["profiles"])))},
        })
    return sorted(records, key=lambda item: item["brand"].casefold()), rejected


def snapshot(records, captured_at):
    return {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured_at,
        "source": {"id": "vegan_action_certified_products", "certificationName": "Certified Vegan", "defaultScope": "product", "recordIdPrefix": "certified-vegan"},
        "records": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--raw-dir", type=Path)
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = args.raw_dir or args.output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    companies_page = fetch_text(COMPANIES_URL)
    raw_dir.joinpath("companies.html").write_text(companies_page)
    products, page, total_pages = [], 1, 1
    while page <= total_pages:
        batch, total_pages = fetch_json(page)
        raw_dir.joinpath(f"products-{page:03d}.json").write_text(json.dumps(batch, ensure_ascii=False) + "\n")
        products.extend(batch)
        page += 1
    records, rejected = build_records(products, parse_companies(companies_page), args.captured_at)
    for old in args.output_dir.glob("certified-vegan-*.json"):
        old.unlink()
    for index in range(0, len(records), args.batch_size):
        args.output_dir.joinpath(f"certified-vegan-{index // args.batch_size + 1:05d}.json").write_text(
            json.dumps(snapshot(records[index:index + args.batch_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    args.output_dir.joinpath("rejected.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in rejected))
    print(f"Certified Vegan complete: {len(products)} products grouped into {len(records)} brand records; {len(rejected)} rejected")


if __name__ == "__main__":
    main()
