#!/usr/bin/env python3
"""Fetch PETA's official companies-that-test directory as adverse evidence."""

from __future__ import annotations

import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://crueltyfree.peta.org/companies-do-test/"
OUTPUT = ROOT / "sources" / "certifications" / "peta-companies-that-test.json"
RAW_DIR = ROOT / "data" / "raw" / "peta-companies-that-test" / date.today().isoformat()
USER_AGENT = "EthicalGrade/0.3 (official evidence directory importer)"


class DirectoryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_results = False
        self.depth = 0
        self.entries: list[dict] = []
        self.next_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if tag == "ul" and "search-results" in classes:
            self.in_results = True
            self.depth = 1
        elif self.in_results and tag in {"ul", "ol"}:
            self.depth += 1
        if self.in_results and tag == "a" and "/company/" in (values.get("href") or "") and "link" in classes:
            name = html.unescape(values.get("title") or "").strip()
            if name:
                self.entries.append({"name": name, "profile": urljoin(BASE_URL, values.get("href") or "")})
        if tag == "a" and "next" in classes:
            self.next_url = urljoin(BASE_URL, values.get("href") or "")

    def handle_endtag(self, tag: str) -> None:
        if self.in_results and tag in {"ul", "ol"}:
            self.depth -= 1
            if self.depth <= 0:
                self.in_results = False


def fetch(url: str, page: int) -> str:
    cache_path = RAW_DIR / f"page-{page:03d}.html"
    if cache_path.exists():
        return cache_path.read_text(errors="replace")
    request = urllib.request.Request(url, headers={"Accept": "text/html", "User-Agent": USER_AGENT})
    for attempt in range(7):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read().decode("utf-8", "replace")
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(body)
            return body
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 6:
                raise
            delay = min(60, 4 * (2 ** attempt))
            print(f"rate limited on page {page}; retrying in {delay}s", flush=True)
            time.sleep(delay)
    raise RuntimeError(f"unable to fetch {url}")


def slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", " and ")))


def main() -> None:
    page_url = BASE_URL
    seen_pages: set[str] = set()
    companies: dict[str, dict] = {}
    while page_url and page_url not in seen_pages:
        seen_pages.add(page_url)
        parser = DirectoryParser()
        parser.feed(fetch(page_url, len(seen_pages)))
        for entry in parser.entries:
            companies[entry["profile"]] = entry
        print(f"parsed page {len(seen_pages)}: {len(parser.entries)} companies ({len(companies)} total)")
        page_url = parser.next_url
        if page_url:
            time.sleep(0.5)

    captured = date.today().isoformat()
    records = []
    for entry in sorted(companies.values(), key=lambda item: item["name"].casefold()):
        profile_slug = urlparse(entry["profile"]).path.rstrip("/").split("/")[-1]
        simple_name = re.sub(r"\s*\([^)]*\)\s*$", "", entry["name"]).strip()
        aliases = [entry["name"]]
        if simple_name and simple_name != entry["name"]:
            aliases.append(simple_name)
        records.append({
            "id": f"peta-tests-{slug(profile_slug or entry['name'])}",
            "brand": entry["name"],
            "aliases": aliases,
            "certificationName": "PETA Companies That Test Listing",
            "status": "listed active",
            "scope": "company",
            "confidence": 0.9,
            "gradingEligible": False,
            "adverse": True,
            "adverseType": "animal_testing",
            "sourceUrl": entry["profile"],
            "officialProfileUrl": entry["profile"],
            "verifiedAt": captured,
            "scopeNote": "PETA places this company or brand in its Companies That Do Test on Animals directory. This is adverse company-level evidence and does not establish that every individual product was itself tested on animals."
        })

    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "peta_companies_that_test",
            "certificationName": "PETA Companies That Test Listing",
            "defaultScope": "company",
            "recordIdPrefix": "peta-tests"
        },
        "records": records
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} PETA animal-testing concern records")


if __name__ == "__main__":
    main()
