#!/usr/bin/env python3
"""Fetch PETA's official PETA-Approved Vegan company directory."""

from __future__ import annotations

import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY_URL = "https://petaapprovedvegan.peta.org/search-peta-approved-vegan/?_vegan_compliance=100-vegan-company"
ENDPOINT = DIRECTORY_URL
OUTPUT = ROOT / "sources" / "certifications" / "peta-approved-vegan.json"
RAW_DIR = ROOT / "data" / "raw" / "peta-approved-vegan" / date.today().isoformat()
USER_AGENT = "EthicalGrade/0.3 (certification directory importer)"


class CompanyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.companies: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        values = dict(attrs)
        if values.get("data-compliance") != "100-vegan-company":
            return
        name = html.unescape(values.get("title") or "").strip()
        website = html.unescape(values.get("href") or "").strip()
        if name:
            self.companies.append({"name": name, "website": website})


def request_payload(page: int) -> bytes:
    return json.dumps({
        "action": "facetwp_refresh",
        "data": {
            "facets": {
                "search": [], "vegan_compliance": ["100-vegan-company"],
                "categories": [], "country": [], "pagination": []
            },
            "frozen_facets": {},
            "http_params": {
                "get": {"_vegan_compliance": "100-vegan-company"},
                "uri": "search-peta-approved-vegan",
                "url_vars": {"vegan_compliance": ["100-vegan-company"]}
            },
            "template": "wp", "extras": {}, "soft_refresh": 1,
            "is_bfcache": 0, "first_load": 0, "paged": page
        }
    }).encode()


def fetch_page(page: int) -> dict:
    cache_path = RAW_DIR / f"page-{page:03d}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())
    request = urllib.request.Request(
        ENDPOINT, data=request_payload(page), method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT}
    )
    for attempt in range(7):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = json.load(response)
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(payload, ensure_ascii=False))
            return payload
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 6:
                raise
            delay = min(60, 4 * (2 ** attempt))
            print(f"rate limited on page {page}; retrying in {delay}s", flush=True)
            time.sleep(delay)
    raise RuntimeError(f"unable to fetch directory page {page}")


def slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", " and ")))


def main() -> None:
    companies: dict[tuple[str, str], dict] = {}
    total_pages = 1
    page = 1
    while page <= total_pages:
        payload = fetch_page(page)
        total_pages = int(payload.get("settings", {}).get("pager", {}).get("total_pages") or total_pages)
        parser = CompanyParser()
        parser.feed(payload.get("template") or "")
        for company in parser.companies:
            companies[(company["name"].casefold(), company["website"])] = company
        print(f"parsed page {page}/{total_pages}: {len(parser.companies)} companies ({len(companies)} total)")
        page += 1
        if page <= total_pages:
            time.sleep(0.5)

    captured = date.today().isoformat()
    records = []
    for company in sorted(companies.values(), key=lambda item: item["name"].casefold()):
        website_hash = hashlib.sha1(company["website"].encode()).hexdigest()[:8]
        records.append({
            "id": f"peta-vegan-{slug(company['name'])}-{website_hash}",
            "brand": company["name"],
            "aliases": [company["name"]],
            "certificationName": "PETA-Approved Vegan (Certified)",
            "status": "certified active",
            "scope": "company",
            "certificationLevel": "100% Vegan Company",
            "confidence": 0.94,
            "sourceUrl": DIRECTORY_URL,
            "officialProfileUrl": DIRECTORY_URL,
            "verifiedAt": captured,
            "scopeNote": "PETA lists this company as a 100% Vegan Company in its PETA-Approved Vegan program. This is a company-level designation for vegan materials, not evidence about labor or environmental performance.",
            "companyFacts": {"website": company["website"], "vegan_compliance": "100-vegan-company"}
        })

    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "peta_approved_vegan_directory",
            "certificationName": "PETA-Approved Vegan (Certified)",
            "defaultScope": "company",
            "recordIdPrefix": "peta-vegan"
        },
        "records": records
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} PETA-Approved Vegan company records")


if __name__ == "__main__":
    main()
