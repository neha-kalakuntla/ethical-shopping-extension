#!/usr/bin/env python3
"""Convert USDA Organic INTEGRITY's official monthly workbook into source snapshots."""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path

DATA_HISTORY_URL = "https://organic.ams.usda.gov/integrity/Reports/DataHistory"
PROFILE_URL = "https://organic.ams.usda.gov/Integrity/CP/OPP?nopid={}"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
USER_AGENT = "EthicalGrade/0.3 USDA-organic-import"


def clean(value):
    return " ".join(str(value or "").split())


def column_index(reference):
    letters = re.match(r"[A-Z]+", reference or "A").group(0)
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - 64
    return value - 1


def workbook_rows(path, sheet_name):
    with zipfile.ZipFile(path) as archive, archive.open(f"xl/worksheets/{sheet_name}.xml") as stream:
        for _, element in ET.iterparse(stream, events=("end",)):
            if element.tag != NS + "row":
                continue
            values = {}
            for cell in element.findall(NS + "c"):
                value = "".join(cell.itertext())
                values[column_index(cell.get("r"))] = clean(value)
            width = max(values, default=-1) + 1
            yield [values.get(index, "") for index in range(width)]
            element.clear()


def dict_rows(path, sheet_name):
    rows = workbook_rows(path, sheet_name)
    headers = next(rows)
    next(rows, None)  # Friendly column names.
    next(rows, None)  # USDA field descriptions.
    for values in rows:
        yield {header: values[index] if index < len(values) else "" for index, header in enumerate(headers)}


def yes(value):
    return clean(value).lower() in {"yes", "true", "1", "y"}


def split_terms(*values):
    terms = []
    for value in values:
        for part in re.split(r"\s*[,;|]\s*", clean(value)):
            part = clean(part).strip(" .")
            if len(part) >= 3 and part.lower() not in {"other", "processed items", "handling"}:
                terms.append(part)
    return list(dict.fromkeys(terms))


def aliases(value):
    values = []
    for part in re.split(r"\s*[;|\n]\s*", clean(value)):
        part = clean(part).strip(" .")
        if len(part) >= 3:
            values.append(part)
    return list(dict.fromkeys(values))


def operation_aliases(name, other_names):
    values = aliases(other_names)
    match = re.search(r"\b(?:d\s*/?\s*b\s*/?\s*a|doing business as)\b\s*[:\-]?\s*(.+)$", clean(name), re.I)
    if match:
        trade_name = clean(match.group(1)).strip(" ,.;")
        if len(trade_name) >= 3:
            values.append(trade_name)
    return list(dict.fromkeys(values))


def load_operations(path):
    operations = {}
    for row in dict_rows(path, "sheet1"):
        operation_id = clean(row.get("op_nopOpID"))
        if not operation_id or clean(row.get("op_status")).lower() != "certified":
            continue
        scopes = [name for name, key in (("Crops", "opSC_CR"), ("Livestock", "opSC_LS"),
                  ("Wild Crops", "opSC_WC"), ("Handling", "opSC_HANDLING")) if clean(row.get(key)).lower() == "certified"]
        consumer_facing = "Handling" in scopes and any(yes(row.get(key)) for key in
            ("opEx_privateLabeler", "opEx_retailer", "opEx_marketerTrader"))
        operations[operation_id] = {
            "row": row, "scopes": scopes, "consumer_facing": consumer_facing,
            "terms": [], "item_status_dates": [], "labeling": set(),
        }
    return operations


def attach_items(path, operations):
    for row in dict_rows(path, "sheet2"):
        operation = operations.get(clean(row.get("ci_nopOpID")))
        if not operation or clean(row.get("ci_status")).lower() != "certified":
            continue
        terms = split_terms(row.get("ci_nopCatName"), row.get("ci_itemList"), row.get("ci_varieties"))
        operation["terms"].extend(terms)
        if row.get("ci_statusEffectiveDate"):
            operation["item_status_dates"].append(clean(row["ci_statusEffectiveDate"]))
        for label, key in (("100% Organic", "ci_organic100"), ("Organic", "ci_organic"), ("Made with Organic", "ci_madeWithOrganic")):
            if yes(row.get(key)):
                operation["labeling"].add(label)


def normalize_records(operations, captured_at):
    records = []
    for operation_id, operation in operations.items():
        row = operation["row"]
        name = clean(row.get("op_name"))
        terms = list(dict.fromkeys(operation["terms"]))[:500]
        if not name or not terms:
            continue
        extension_eligible = operation["consumer_facing"]
        country = clean(row.get("opPA_country") or row.get("opMA_country"))
        region = clean(row.get("opPA_state") or row.get("opMA_state"))
        records.append({
            "id": f"usda-organic-{operation_id}",
            "brand": name,
            "aliases": operation_aliases(name, row.get("op_otherNames")),
            "certificationName": "USDA Organic certified operation",
            "issuer": "USDA Agricultural Marketing Service, National Organic Program",
            "status": "certified",
            "scope": "product" if extension_eligible else "operation",
            "productNames": terms if extension_eligible else [],
            "matchTerms": terms if extension_eligible else [],
            "certifiedProductText": terms,
            "gradingEligible": extension_eligible,
            "extensionEligible": extension_eligible,
            "scopeNote": ("The operation is currently USDA-NOP certified for the listed products. Retail matching requires an exact operation/alias identity and a compatible certified product term; the listing does not certify every product sold by the operation."
                          if extension_eligible else "USDA-NOP certified operation and commodity evidence retained for supply-chain/RAG use. It is not connected to retail products without verified brand and product-scope identity."),
            "sourceUrl": DATA_HISTORY_URL,
            "officialProfileUrl": PROFILE_URL.format(operation_id),
            "verifiedAt": captured_at,
            "confidence": 0.9 if extension_eligible else 0.82,
            "geography": ", ".join(value for value in (region, country) if value),
            "companyFacts": {
                "nop_operation_id": operation_id,
                "certifier": clean(row.get("Cert_name")),
                "certified_scopes": operation["scopes"],
                "certified_products": terms,
                "organic_labeling_categories": sorted(operation["labeling"]),
                "operation_status_effective_date": clean(row.get("op_statusEffectiveDate")),
                "nop_anniversary_date": clean(row.get("op_nopAnniversaryDate")),
                "website": clean(row.get("op_url")),
            },
        })
    return records


def snapshot(records, captured_at):
    return {"schemaVersion": 1, "kind": "certification_directory", "capturedAt": captured_at,
            "source": {"id": "usda_organic_integrity", "certificationName": "USDA Organic certified operation",
                       "defaultScope": "operation", "recordIdPrefix": "usda-organic"}, "records": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--workbook", type=Path)
    parser.add_argument("--url", help="Official monthly INTEGRITY_Data_YYYYMMDD.xlsx URL")
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--shard-size", type=int, default=500)
    args = parser.parse_args()
    workbook = args.workbook or args.output_dir / "usda-organic-integrity.xlsx"
    if args.url:
        request = urllib.request.Request(args.url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=180) as response:
            workbook.parent.mkdir(parents=True, exist_ok=True)
            workbook.write_bytes(response.read())
    if not workbook.exists():
        parser.error("provide --workbook or --url")
    operations = load_operations(workbook)
    attach_items(workbook, operations)
    records = normalize_records(operations, args.captured_at)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for old in args.output_dir.glob("usda-organic-*.json"):
        old.unlink()
    for index in range(0, len(records), args.shard_size):
        path = args.output_dir / f"usda-organic-{index // args.shard_size + 1:05d}.json"
        path.write_text(json.dumps(snapshot(records[index:index + args.shard_size], args.captured_at), indent=2, ensure_ascii=False) + "\n")
    eligible = sum(bool(record["extensionEligible"]) for record in records)
    print(f"USDA Organic complete: {len(records)} operations, {eligible} consumer-facing product-scoped records")


if __name__ == "__main__":
    main()
