#!/usr/bin/env python3
"""Convert OWID's Poore & Nemecek food-impact CSVs into one source snapshot."""

from __future__ import annotations

import argparse
import csv
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


DATASETS = {
    "climate": {
        "slug": "ghg-per-kg-poore", "column": "Greenhouse gas emissions per kilogram",
        "metric": "climate_change", "unit": "kg_co2e",
    },
    "land": {
        "slug": "land-use-per-kg-poore", "column": "Land use per kilogram",
        "metric": "land_use", "unit": "m2_year",
    },
    "water": {
        "slug": "water-withdrawals-per-kg-poore", "column": "Freshwater withdrawals per kilogram",
        "metric": "freshwater_use", "unit": "l",
    },
    "eutrophication": {
        "slug": "eutrophying-emissions-per-kg-poore", "column": "Eutrophying emissions per kilogram",
        "metric": "eutrophication", "unit": "g_po4e",
    },
}


def utc_date() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def read_bytes(url: str, local_path: Optional[Path]) -> bytes:
    if local_path:
        return local_path.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "EthicalGrade/1.0 (environmental data importer)"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def dataset_urls(config: dict) -> tuple[str, str, str]:
    chart_url = f"https://ourworldindata.org/grapher/{config['slug']}"
    return f"{chart_url}.csv", f"{chart_url}.metadata.json", chart_url


def records_for_dataset(csv_bytes: bytes, config: dict, captured_at: str) -> list[dict]:
    _, _, chart_url = dataset_urls(config)
    rows = csv.DictReader(csv_bytes.decode("utf-8-sig").splitlines())
    records = []
    for row in rows:
        name = (row.get("Entity") or "").strip()
        raw_value = row.get(config["column"])
        if not name or raw_value in (None, ""):
            continue
        records.append({
            "externalId": f"poore-nemecek-2018:{config['metric']}:{name.lower().replace(' ', '-')}",
            "productName": name,
            "metric": config["metric"],
            "value": float(raw_value),
            "unit": config["unit"],
            "functionalUnit": "1 kg food product",
            "measurementScope": "category_estimate",
            "lifecycleBoundary": "full_supply_chain_to_retail",
            "geography": "Global",
            "methodology": "Poore and Nemecek (2018) global meta-analysis; processed by Our World in Data",
            "confidence": 0.8,
            "gradingEligible": False,
            "validFrom": row.get("Year") or None,
            "observedAt": captured_at,
            "sourceUrl": chart_url,
        })
    return records


def build_snapshot(csv_bytes: bytes, metadata_bytes: bytes, captured_at: str) -> dict:
    """Backward-compatible single climate dataset builder used by older callers."""
    return build_combined_snapshot({"climate": (csv_bytes, metadata_bytes)}, captured_at)


def build_combined_snapshot(payloads: dict[str, tuple[bytes, bytes]], captured_at: str) -> dict:
    records = []
    metadata_records = []
    for key, (csv_bytes, metadata_bytes) in payloads.items():
        config = DATASETS[key]
        _, _, chart_url = dataset_urls(config)
        metadata = json.loads(metadata_bytes)
        records.extend(records_for_dataset(csv_bytes, config, captured_at))
        metadata_records.append({
            "metric": config["metric"],
            "title": metadata.get("chart", {}).get("title"),
            "citation": metadata.get("chart", {}).get("citation"),
            "originalChartUrl": metadata.get("chart", {}).get("originalChartUrl", chart_url),
            "dateDownloaded": metadata.get("dateDownloaded", captured_at),
        })
    return {
        "schemaVersion": 1,
        "kind": "environmental_measurements",
        "capturedAt": f"{captured_at}T00:00:00Z",
        "source": {"id": "owid_poore_nemecek_food_impacts"},
        "datasetMetadata": metadata_records,
        "records": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--csv", type=Path, help="Use an already-downloaded climate CSV")
    parser.add_argument("--metadata", type=Path, help="Use already-downloaded climate metadata JSON")
    for key in ("land", "water", "eutrophication"):
        parser.add_argument(f"--{key}-csv", type=Path)
        parser.add_argument(f"--{key}-metadata", type=Path)
    parser.add_argument("--captured-at", default=utc_date())
    args = parser.parse_args()
    payloads = {}
    for key, config in DATASETS.items():
        csv_url, metadata_url, _ = dataset_urls(config)
        csv_path = args.csv if key == "climate" else getattr(args, f"{key}_csv")
        metadata_path = args.metadata if key == "climate" else getattr(args, f"{key}_metadata")
        payloads[key] = (read_bytes(csv_url, csv_path), read_bytes(metadata_url, metadata_path))
    snapshot = build_combined_snapshot(payloads, args.captured_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(snapshot['records'])} category estimates to {args.output}")


if __name__ == "__main__":
    main()
