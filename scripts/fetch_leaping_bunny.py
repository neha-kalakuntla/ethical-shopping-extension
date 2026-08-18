#!/usr/bin/env python3
"""Collect certified brands from the official Leaping Bunny shopping guide."""

from __future__ import annotations

import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

SOURCE_URL = "https://www.leapingbunny.org/shopping-guide"


def clean(value):
    return " ".join(html.unescape(value or "").split())


class BrandParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current_href = None
        self.current_text = []
        self.brands = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href", "")
        if tag == "a" and re.fullmatch(r"/brand/[a-z0-9-]+", href):
            self.current_href = href
            self.current_text = []

    def handle_data(self, data):
        if self.current_href:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.current_href:
            name = clean("".join(self.current_text))
            if name:
                self.brands.append((name, urljoin(SOURCE_URL, self.current_href)))
            self.current_href = None
            self.current_text = []


def parse_brands(page):
    parser = BrandParser()
    parser.feed(page)
    return list(dict.fromkeys(parser.brands))


def slug(value):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", " and ")))


def brand_aliases(name):
    """Derive conservative retail-name variants from a listed public brand."""
    aliases = [clean(name)]
    without_marks = clean(re.sub(r"[®™]", "", name))
    without_legal = clean(re.sub(
        r"(?:,?\s+(?:incorporated|inc|llc|ltd|limited|corp(?:oration)?|company|co))\.?$",
        "", without_marks, flags=re.IGNORECASE,
    ))
    for candidate in (without_marks, without_legal):
        if candidate and candidate not in aliases:
            aliases.append(candidate)
    # Directories sometimes append the industry to a public brand before a legal suffix.
    # Amazon commonly exposes only the public-facing portion (e.g. e.l.f.).
    without_descriptor = clean(re.sub(r"\s+cosmetics$", "", without_legal, flags=re.IGNORECASE))
    if len(re.sub(r"[^a-z0-9]", "", without_descriptor.lower())) >= 3 and without_descriptor not in aliases:
        aliases.append(without_descriptor)
    return aliases


def normalize_brand(name, profile_url, captured_at):
    return {
        "id": f"leaping-bunny-{slug(profile_url.rsplit('/', 1)[-1])}",
        "brand": name,
        "aliases": brand_aliases(name),
        "status": "certified",
        "scope": "brand",
        "certificationName": "Leaping Bunny Certified",
        "scopeNote": "Certification applies to this listed brand. It must not be transferred to a parent company, sibling brand, retailer, or unrelated product brand.",
        "sourceUrl": profile_url,
        "officialProfileUrl": profile_url,
        "verifiedAt": captured_at,
        "confidence": 0.92,
    }


def snapshot(records, captured_at):
    return {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured_at,
        "source": {
            "id": "leaping_bunny_shopping_guide",
            "certificationName": "Leaping Bunny Certified",
            "defaultScope": "brand",
            "recordIdPrefix": "leaping-bunny",
        },
        "records": records,
    }


def fetch_page(page_number):
    url = SOURCE_URL if page_number == 0 else f"{SOURCE_URL}?page={page_number}"
    request = Request(url, headers={"User-Agent": "EthicalGrade/0.1 certification-directory-import"})
    with urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8"), url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--raw-dir", type=Path)
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--max-pages", type=int, default=100)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = args.raw_dir or args.output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    records_by_url = {}
    for page_number in range(args.max_pages):
        page, url = fetch_page(page_number)
        raw_dir.joinpath(f"page-{page_number:03d}.html").write_text(page)
        brands = parse_brands(page)
        if not brands:
            break
        for name, profile_url in brands:
            records_by_url[profile_url] = normalize_brand(name, profile_url, args.captured_at)
    else:
        raise RuntimeError(f"directory still returned brands at --max-pages={args.max_pages}")

    records = sorted(records_by_url.values(), key=lambda item: item["brand"].casefold())
    if not records:
        raise RuntimeError("Leaping Bunny directory returned no brands")
    for old in args.output_dir.glob("leaping-bunny-*.json"):
        old.unlink()
    for index in range(0, len(records), args.batch_size):
        path = args.output_dir / f"leaping-bunny-{index // args.batch_size + 1:05d}.json"
        path.write_text(json.dumps(snapshot(records[index:index + args.batch_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    print(f"Leaping Bunny complete: {len(records)} certified brands from {page_number} populated pages")


if __name__ == "__main__":
    main()
