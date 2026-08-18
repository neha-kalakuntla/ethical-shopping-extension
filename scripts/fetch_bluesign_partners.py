#!/usr/bin/env python3
"""Import bluesign's official brand-partner PDF as non-product provenance."""

from __future__ import annotations

import io
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS_URL = "https://www.bluesign.com/bluesign-downloads"
OUTPUT = ROOT / "sources" / "certifications" / "bluesign-system-partners.json"
USER_AGENT = "EthicalGrade/0.3 (certification directory importer)"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def brand_pdf_url(page: str) -> str:
    links = re.findall(r'href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\']', page, re.I)
    candidates = [urllib.parse.urljoin(DOWNLOADS_URL, link) for link in links
                  if "partner" in link.lower() and "brand" in link.lower()]
    if not candidates:
        raise RuntimeError("Could not find the official bluesign brand-partner PDF")
    return candidates[0]


def parse_rows(pdf: bytes) -> list[tuple[str, str]]:
    text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
    rows: list[tuple[str, str]] = []
    countries = re.compile(
        r"\b(USA|Canada|Germany|Switzerland|Austria|Norway|Sweden|Finland|Denmark|France|Italy|Spain|Portugal|"
        r"United Kingdom|Netherlands|Belgium|Australia|New Zealand|Japan|China|Hong Kong|Taiwan|India|South Korea)\s*$",
        re.I,
    )
    for raw in text.splitlines():
        line = " ".join(raw.split())
        match = countries.search(line)
        if not match:
            continue
        name = line[:match.start()].strip(" |-")
        if not name or name.lower() in {"company name", "company"}:
            continue
        rows.append((name, match.group(1)))
    # PDF extraction can repeat headers/rows; preserve first occurrence.
    return list(dict.fromkeys(rows))


def main() -> None:
    page = fetch(DOWNLOADS_URL).decode("utf-8", "replace")
    pdf_url = brand_pdf_url(page)
    rows = parse_rows(fetch(pdf_url))
    if len(rows) < 25:
        raise RuntimeError(f"Only parsed {len(rows)} partner brands; refusing to replace the snapshot")
    captured = date.today().isoformat()
    records = []
    for index, (brand, country) in enumerate(rows, 1):
        slug = re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", brand.lower()))
        records.append({
            "id": f"bluesign-partner-{slug or index}",
            "brand": brand,
            "aliases": [brand],
            "status": "active system partner",
            "scope": "brand",
            "gradingEligible": False,
            "geography": country,
            "confidence": 0.9,
            "sourceUrl": pdf_url,
            "officialProfileUrl": DOWNLOADS_URL,
            "verifiedAt": captured,
            "scopeNote": "bluesign lists this brand as a System Partner. This is company-level supply-chain evidence, not proof that a particular retail product is bluepass certified.",
        })
    payload = {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured,
        "source": {
            "id": "bluesign_system_partner_brands",
            "certificationName": "bluesign System Partner",
            "defaultScope": "brand",
            "recordIdPrefix": "bluesign-partner",
        },
        "records": records,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(records)} non-grading bluesign partner brands from {pdf_url}")


if __name__ == "__main__":
    main()
