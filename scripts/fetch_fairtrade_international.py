#!/usr/bin/env python3
"""Collect licensed and certified operators from the official Fairtrade International Finder."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

FINDER_URL = "https://www.fairtrade.net/en/fairtrade-finder.html"
USER_AGENT = "EthicalGrade/0.3 certification-directory-import"


def clean(value):
    return " ".join(html.unescape(str(value or "")).split())


def finder_config(page):
    values = {}
    for key, pattern in {
        "endpoint": r'data-api-endpoint="([^"]+)",?',
        "api_key": r'data-api-key="([^"]+)",?',
        "index": r'data-index-name="([^"]+)",?',
    }.items():
        match = re.search(pattern, page)
        if not match:
            raise ValueError(f"Fairtrade Finder is missing {key}")
        values[key] = html.unescape(match.group(1))
    return values


def useful_values(values):
    return [clean(value) for value in values or [] if clean(value) and clean(value) != "(Not Specified)"]


def aliases(value):
    value = clean(value)
    if not value:
        return []
    parts = [clean(item).strip(" ,") for item in re.split(r"\s*;\s*", value)]
    return list(dict.fromkeys(item for item in [value, *parts] if len(item) >= 3))


def normalize_operator(operator, captured_at):
    name = clean(operator.get("op_name"))
    licensed = clean(operator.get("lic_status")).lower() == "licensed"
    certified = clean(operator.get("cert_status")).lower() == "certified"
    if not name or not (licensed or certified):
        raise ValueError("operator is neither a named licensee nor certified operator")
    products = useful_values(operator.get("cert_product"))
    flo_id = str(operator.get("op_floId") or "").strip()
    operator_key = str(operator.get("op_key") or flo_id).strip()
    if not operator_key:
        raise ValueError("operator is missing an identifier")
    scoped = bool(products)
    retail_eligible = licensed and scoped
    if licensed and certified:
        status = "licensed and certified"
    elif licensed:
        status = "licensed"
    else:
        status = "certified but not licensed"
    return {
        "id": f"fairtrade-international-{operator_key}",
        "brand": name,
        "aliases": aliases(operator.get("op_altname")),
        "certificationName": "Fairtrade licensed operator" if licensed else "Fairtrade certified supply-chain operator",
        "issuer": "Fairtrade International",
        "status": status,
        "scope": "product" if retail_eligible else "operation",
        "productNames": products,
        "matchTerms": products,
        "gradingEligible": retail_eligible,
        "extensionEligible": retail_eligible,
        "scopeNote": (
            "The operator is licensed to use FAIRTRADE Marks only for qualifying products. Product categories reflect the Finder's published certification scope; an operator listing does not certify every product it sells."
            if licensed else
            "The operator is certified to trade the listed Fairtrade commodities upstream but is not licensed to place the FAIRTRADE Mark on finished consumer products. This record is supply-chain/RAG evidence only."
        ),
        "sourceUrl": FINDER_URL,
        "officialProfileUrl": FINDER_URL,
        "verifiedAt": captured_at,
        "confidence": 0.9 if retail_eligible else 0.78 if certified else 0.72,
        "geography": clean(operator.get("op_country")),
        "companyFacts": {
            "flo_id": flo_id,
            "licensing_body": clean(operator.get("lic_body")),
            "certification_body": clean(operator.get("cert_body")),
            "fairtrade_standards": useful_values(operator.get("cert_standard")),
            "fairtrade_products": products,
            "licensing_status": clean(operator.get("lic_status")),
            "certification_status": clean(operator.get("cert_status")),
        },
    }


def snapshot(records, captured_at):
    return {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured_at,
        "source": {
            "id": "fairtrade_product_directory",
            "certificationName": "Fairtrade licensed operator",
            "defaultScope": "product",
            "recordIdPrefix": "fairtrade-international",
        },
        "records": records,
    }


def fetch_json(url, api_key):
    request = Request(url, headers={"User-Agent": USER_AGENT, "api-key": api_key, "Accept": "application/json"})
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--max-pages", type=int)
    args = parser.parse_args()
    with urlopen(Request(FINDER_URL, headers={"User-Agent": USER_AGENT}), timeout=45) as response:
        page = response.read().decode("utf-8")
    config = finder_config(page)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    args.raw_dir.joinpath("finder.html").write_text(page)
    accepted, rejected, offset, page_number = [], [], 0, 0
    while args.max_pages is None or page_number < args.max_pages:
        query = urlencode({
            "api-version": "2015-02-28", "$count": "true", "$top": args.page_size, "$skip": offset,
            "$orderby": "op_name asc", "$filter": "cert_status eq 'Certified' or lic_status eq 'Licensed'",
        })
        url = f"{config['endpoint'].rstrip('/')}/indexes/{config['index']}/docs?{query}"
        payload = fetch_json(url, config["api_key"])
        rows = payload.get("value", [])
        if not rows:
            break
        args.raw_dir.joinpath(f"page-{page_number + 1:05d}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        for row in rows:
            try:
                accepted.append(normalize_operator(row, args.captured_at))
            except ValueError as error:
                rejected.append({"operatorKey": row.get("op_key"), "name": row.get("op_name"), "error": str(error)})
        offset += len(rows)
        page_number += 1
        if len(rows) < args.page_size:
            break
    for index in range(0, len(accepted), args.page_size):
        path = args.output_dir / f"fairtrade-international-{index // args.page_size + 1:05d}.json"
        path.write_text(json.dumps(snapshot(accepted[index:index + args.page_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    args.output_dir.joinpath("rejected.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in rejected))
    print(f"Fairtrade International complete: {len(accepted)} accepted, {len(rejected)} rejected across {page_number} pages")


if __name__ == "__main__":
    main()
