#!/usr/bin/env python3
"""Collect the authorized public B Lab directory feed into JSONL for bulk import."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

DEFAULT_ENDPOINT = "https://94eo8lmsqa0nd3j5p.a1.typesense.net/multi_search"
DEFAULT_COLLECTION = "companies-production-en-us"
DEFAULT_PUBLIC_SEARCH_KEY = "eoWf8NTNsTFdaxcxNSuyaKAjLeV4T3F0"
QUERY_BY = "name,description,websiteKeywords,countries,industry,sector,hqCountry,hqProvince,hqCity,hqPostalCode,provinces,cities,size,demographicsList"


def iso_date(timestamp):
    if timestamp in (None, ""):
        return None
    return datetime.fromtimestamp(float(timestamp) / 1000, timezone.utc).date().isoformat()


def transform(document: dict, captured_at: str) -> dict:
    slug = document.get("slug") or document.get("id")
    if not slug or not document.get("name"):
        raise ValueError("directory record is missing name or slug")
    profile = f"https://www.bcorporation.net/en-us/find-a-b-corp/company/{slug}/"
    country = document.get("hqCountry") or ", ".join(document.get("countries") or [])
    geography = ", ".join(part for part in (document.get("hqCity"), document.get("hqProvince"), country) if part)
    record = {
        "company_name": document["name"],
        "profile_url": profile,
        "status": "listed active" if document.get("isCertified") else "listed inactive",
        "verified_at": captured_at,
        "certified_since": iso_date(document.get("initialCertificationDateTimestamp")),
        "overall_score": document.get("latestVerifiedScore"),
        "geography": geography or None,
        "industry": document.get("industry"),
        "sector": document.get("sector"),
        "company_size": document.get("size"),
        "description": document.get("description"),
        "countries": document.get("countries") or [],
        "directory_record_id": document.get("id"),
    }
    return {key: value for key, value in record.items() if value not in (None, "", [])}


def fetch_page(endpoint, api_key, collection, page, per_page, timeout):
    body = json.dumps({"searches": [{
        "collection": collection,
        "q": "*",
        "query_by": QUERY_BY,
        "page": page,
        "per_page": per_page,
    }]}).encode()
    request = Request(
        f"{endpoint}?x-typesense-api-key={api_key}",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "EthicalGrade/0.1 authorized-directory-import"},
        method="POST",
    )
    last_error = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())
        except OSError as error:
            last_error = error
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise last_error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Destination JSONL file")
    parser.add_argument("--raw-dir", type=Path, help="Directory for immutable raw page responses")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--api-key", default=os.environ.get("BCORP_TYPESENSE_API_KEY", DEFAULT_PUBLIC_SEARCH_KEY))
    parser.add_argument("--per-page", type=int, default=250)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--captured-at", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.per_page <= 250:
        parser.error("--per-page must be between 1 and 250")
    raw_dir = args.raw_dir or args.output.with_suffix(".raw")
    raw_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = args.output.with_suffix(args.output.suffix + ".state")
    state = {"nextPage": 1, "records": 0, "complete": False, "collection": args.collection}
    if checkpoint.exists() and not args.restart:
        state = json.loads(checkpoint.read_text())
        if state["collection"] != args.collection:
            raise SystemExit("collection changed; use --restart or another output path")
    mode = "w" if args.restart or not args.output.exists() else "a"
    pages_this_run = 0
    with args.output.open(mode, encoding="utf-8") as output:
        while not state.get("complete"):
            page = state["nextPage"]
            payload = fetch_page(args.endpoint, args.api_key, args.collection, page, args.per_page, args.timeout)
            raw_dir.joinpath(f"page-{page:05d}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
            result = payload["results"][0]
            hits = result.get("hits", [])
            for hit in hits:
                output.write(json.dumps(transform(hit["document"], args.captured_at), ensure_ascii=False) + "\n")
            output.flush()
            state["records"] += len(hits)
            state["nextPage"] = page + 1
            state["reportedTotal"] = result.get("found")
            state["complete"] = not hits or state["records"] >= int(result.get("found", state["records"]))
            checkpoint.write_text(json.dumps(state, indent=2) + "\n")
            pages_this_run += 1
            print(f"page {page}: {len(hits)} records ({state['records']}/{state.get('reportedTotal', '?')})")
            if args.max_pages and pages_this_run >= args.max_pages:
                break
            if not state["complete"] and args.delay:
                time.sleep(args.delay)
    print(f"collection {'complete' if state['complete'] else 'paused'}: {state['records']} records")


if __name__ == "__main__":
    main()
