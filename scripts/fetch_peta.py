#!/usr/bin/env python3
"""Fetch PETA's official Beauty Without Bunnies company directory."""

from __future__ import annotations

import html
import json
import re
import time
import urllib.request
import urllib.error
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://crueltyfree.peta.org/companies-dont-test/"
OUTPUT = ROOT / "sources" / "certifications" / "peta-beauty-without-bunnies.json"
RAW_DIR = ROOT / "data" / "raw" / "peta" / date.today().isoformat()
USER_AGENT = "EthicalGrade/0.3 (certification directory importer)"


class DirectoryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_results = False
        self.list_depth = 0
        self.current: dict | None = None
        self.entries: list[dict] = []
        self.next_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if tag == "ul" and "search-results" in classes:
            self.in_results = True
            self.list_depth = 1
        elif self.in_results and tag in {"ul", "ol"}:
            self.list_depth += 1
        if self.in_results and tag == "li" and self.current is None:
            self.current = {"name": "", "profile": "", "vegan": False, "logoLicensed": False}
        if self.current is not None:
            title = html.unescape(values.get("title") or "")
            href = values.get("href") or ""
            if tag == "a" and "/company/" in href and "link" in classes:
                self.current["name"] = title
                self.current["profile"] = urljoin(BASE_URL, href)
            if title == "All products are vegan":
                self.current["vegan"] = True
            if title == "Features PETA Logo":
                self.current["logoLicensed"] = True
        if tag == "a" and "next" in classes:
            self.next_url = urljoin(BASE_URL, values.get("href") or "")

    def handle_endtag(self, tag: str) -> None:
        if self.in_results and tag == "li" and self.current is not None:
            if self.current["name"] and self.current["profile"]:
                self.entries.append(self.current)
            self.current = None
        if self.in_results and tag in {"ul", "ol"}:
            self.list_depth -= 1
            if self.list_depth <= 0:
                self.in_results = False


def fetch(url: str, page_number: int) -> str:
    cache_path = RAW_DIR / f"page-{page_number:03d}.html"
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
            print(f"rate limited on page {page_number}; retrying in {delay}s", flush=True)
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
        print(f"fetched page {len(seen_pages)}: {len(parser.entries)} entries ({len(companies)} total)")
        page_url = parser.next_url
        if page_url:
            time.sleep(0.5)

    captured = date.today().isoformat()
    records = []
    for entry in sorted(companies.values(), key=lambda item: item["name"].casefold()):
        profile_slug = urlparse(entry["profile"]).path.rstrip("/").split("/")[-1]
        entity_id = f"peta-{slug(profile_slug or entry['name'])}"
        simple_name = re.sub(r"\s*\([^)]*\)\s*$", "", entry["name"]).strip()
        aliases = [entry["name"]]
        if simple_name and simple_name != entry["name"]:
            aliases.append(simple_name)
        common = {
            "id": entity_id,
            "brand": entry["name"],
            "aliases": aliases,
            "status": "listed active",
            "scope": "company",
            "confidence": 0.94,
            "sourceUrl": entry["profile"],
            "officialProfileUrl": entry["profile"],
            "verifiedAt": captured,
            "companyFacts": {"peta_logo_licensed": entry["logoLicensed"]},
        }
        records.append({
            **common,
            "certificationName": "PETA Animal Test-Free and Vegan (Certified)" if entry["vegan"] else "PETA Animal Test-Free (Certified)",
            "certificationLevel": "all products vegan" if entry["vegan"] else "animal test-free",
            "scopeNote": (
                "PETA marks this company as animal test-free and states that all of its products are vegan. This is a company-level designation."
                if entry["vegan"] else
                "PETA lists this company or brand as animal test-free. This is a company-level designation, not an individual-product certification."
            ),
        })

    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "peta_beauty_without_bunnies",
            "certificationName": "PETA Animal Test-Free",
            "defaultScope": "company",
            "recordIdPrefix": "peta",
        },
        "records": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    vegan_count = sum(1 for entry in companies.values() if entry["vegan"])
    logo_count = sum(1 for entry in companies.values() if entry["logoLicensed"])
    print(f"wrote {len(records)} company designations ({vegan_count} all-vegan, {logo_count} logo-licensed)")


if __name__ == "__main__":
    main()
