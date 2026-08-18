#!/usr/bin/env python3
"""Convert an authorized B Corp CSV/JSON/JSONL export into ingestible snapshots."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


def first(record: dict, *keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, "", []):
            return value
    return None


def rows(path: Path):
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as handle:
            yield from csv.DictReader(handle)
    elif suffix in {".jsonl", ".ndjson"}:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)
    elif suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        records = payload if isinstance(payload, list) else payload.get("records", payload.get("companies", []))
        yield from records
    else:
        raise ValueError("input must be CSV, JSON, JSONL, or NDJSON")


def aliases(record: dict, brand: str) -> list[str]:
    value = first(record, "aliases", "brand_aliases", "alternate_names") or []
    if isinstance(value, str):
        value = [part.strip() for part in value.replace(";", "|").split("|") if part.strip()]
    return list(dict.fromkeys([brand, *value]))


def normalize(record: dict, captured_at: str) -> dict:
    brand = str(first(record, "brand", "company_name", "companyName", "name") or "").strip()
    profile = str(first(record, "officialProfileUrl", "profile_url", "profileUrl", "bcorp_profile_url", "url") or "").strip()
    status = str(first(record, "certification_status", "certificationStatus", "status") or "").strip()
    parsed = urlparse(profile)
    if not brand:
        raise ValueError("missing company name")
    if parsed.scheme != "https" or not parsed.netloc.endswith("bcorporation.net") or "/find-a-b-corp/company/" not in parsed.path:
        raise ValueError("missing or invalid official B Corp profile URL")
    if not status:
        raise ValueError("missing certification status")
    profile_slug = parsed.path.rstrip("/").split("/")[-1]
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", profile_slug):
        raise ValueError("official B Corp profile URL has an invalid company slug")
    output = {
        "id": f"bcorp-{profile_slug}",
        "brand": brand,
        "aliases": aliases(record, brand),
        "status": status,
        "scope": "company",
        "scopeNote": "Company-level certification; it does not certify every individual product.",
        "confidence": 0.92,
        "sourceUrl": profile,
        "officialProfileUrl": profile,
        "verifiedAt": str(first(record, "verified_at", "verifiedAt", "updated_at", "updatedAt") or captured_at),
    }
    optional = {
        "certifiedSince": first(record, "certified_since", "certifiedSince", "certification_date", "certificationDate"),
        "expiresAt": first(record, "expires_at", "expiresAt", "reverification_date", "reverificationDate"),
        "score": first(record, "score", "overall_score", "overallScore", "b_impact_score"),
        "geography": first(record, "geography", "country", "location"),
    }
    for key, value in optional.items():
        if value not in (None, ""):
            output[key] = float(value) if key == "score" else value
    company_facts = {key: record[key] for key in ("description", "industry", "sector", "company_size", "countries", "directory_record_id") if record.get(key) not in (None, "", [])}
    if company_facts:
        output["companyFacts"] = company_facts
    return output


def snapshot(records: list[dict], captured_at: str) -> dict:
    return {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured_at,
        "source": {
            "id": "b_lab_find_a_b_corp",
            "certificationName": "Certified B Corporation",
            "defaultScope": "company",
            "recordIdPrefix": "bcorp",
        },
        "records": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--captured-at", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--restart", action="store_true", help="Ignore the existing checkpoint")
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(args.input.read_bytes()).hexdigest()
    checkpoint_path = args.output_dir / "checkpoint.state"
    rejected_path = args.output_dir / "rejected.jsonl"
    state = {"inputSha256": digest, "nextRow": 0, "nextShard": 1, "seenProfileUrls": []}
    if checkpoint_path.exists() and not args.restart:
        state = json.loads(checkpoint_path.read_text())
        if state["inputSha256"] != digest:
            raise SystemExit("input changed; use --restart or choose a new output directory")
    seen = set(state.get("seenProfileUrls", []))
    batch = []
    accepted = rejected = 0

    def flush():
        nonlocal batch
        if not batch:
            return
        path = args.output_dir / f"b-lab-{state['nextShard']:05d}.json"
        path.write_text(json.dumps(snapshot(batch, args.captured_at), indent=2, ensure_ascii=False) + "\n")
        state["nextShard"] += 1
        batch = []

    rejected_mode = "w" if args.restart or not rejected_path.exists() else "a"
    with rejected_path.open(rejected_mode, encoding="utf-8") as rejected_file:
        for index, raw in enumerate(rows(args.input)):
            if index < state["nextRow"]:
                continue
            try:
                record = normalize(raw, args.captured_at)
                if record["officialProfileUrl"] in seen:
                    raise ValueError("duplicate official profile URL")
                seen.add(record["officialProfileUrl"])
                batch.append(record)
                accepted += 1
            except (TypeError, ValueError) as error:
                rejected += 1
                rejected_file.write(json.dumps({"row": index + 1, "error": str(error), "record": raw}, ensure_ascii=False) + "\n")
            state["nextRow"] = index + 1
            if len(batch) >= args.batch_size:
                flush()
                state["seenProfileUrls"] = sorted(seen)
                checkpoint_path.write_text(json.dumps(state, indent=2) + "\n")
        flush()
    state["seenProfileUrls"] = sorted(seen)
    state["complete"] = True
    checkpoint_path.write_text(json.dumps(state, indent=2) + "\n")
    print(f"import complete: {accepted} accepted, {rejected} rejected, {state['nextShard'] - 1} total shards")


if __name__ == "__main__":
    main()
