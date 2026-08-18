#!/usr/bin/env python3
"""Collect Rainforest Alliance Find the Frog listings into scoped snapshots."""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen

BASE_URL = "https://www.rainforest-alliance.org"
DIRECTORY_URL = f"{BASE_URL}/find-certified/"
PROFILE_PATTERN = re.compile(r'href="(https://www\.rainforest-alliance\.org/find-certified/([a-z0-9-]+)/)"')
DATA_PATTERN = re.compile(r"var dataLayer_content = (\{.*?\});")


def fetch(url, timeout=30):
    request = Request(url, headers={"User-Agent": "EthicalGrade/0.1 certification-directory-import", "Accept": "text/html"})
    last_error = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except OSError as error:
            last_error = error
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise last_error


def directory_links(html):
    excluded = {"page", "feed", "guidelines"}
    return list(dict.fromkeys(url for url, slug in PROFILE_PATTERN.findall(html) if slug not in excluded))


def profile_record(html, source_url):
    match = DATA_PATTERN.search(html)
    if not match:
        raise ValueError(f"missing structured listing metadata: {source_url}")
    data = json.loads(match.group(1))
    terms = data.get("pagePostTerms", {})
    brand = str(data.get("pageTitle", "")).removesuffix(" | Find the Frog").strip()
    slug = source_url.rstrip("/").split("/")[-1]
    products = terms.get("product-type", [])
    ingredients = terms.get("commodity", [])
    countries = terms.get("consumer-location", [])
    if not brand or not products or not ingredients:
        raise ValueError(f"listing lacks brand, product, or certified ingredient: {source_url}")
    verified_at = str(data.get("pagePostDateIso") or "")[:10]
    return {
        "id": f"rainforest-alliance-{slug}",
        "brand": brand,
        "aliases": [brand],
        "status": "listed certified",
        "scope": "brand",
        "productNames": products,
        "matchTerms": list(dict.fromkeys([*products, *ingredients])),
        "certifiedIngredients": ingredients,
        "availableIn": countries,
        "scopeNote": f"The directory lists {brand} products in these categories with certified ingredient(s): {', '.join(ingredients)}. It does not certify unrelated products from the brand.",
        "sourceUrl": source_url,
        "officialProfileUrl": source_url,
        "verifiedAt": verified_at,
        "confidence": 0.88,
        "companyFacts": {key: value for key, value in {
            "company_website": terms.get("meta", {}).get("product_company_url"),
            "purchase_url": terms.get("meta", {}).get("product_purchase_url"),
        }.items() if value},
    }


def snapshot(records, captured_at):
    return {
        "schemaVersion": 1,
        "kind": "certification_directory",
        "capturedAt": captured_at,
        "source": {
            "id": "rainforest_alliance_find_certified",
            "certificationName": "Rainforest Alliance Certified seal listing",
            "defaultScope": "brand",
            "recordIdPrefix": "rainforest-alliance",
        },
        "records": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--raw-dir", type=Path)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--captured-at", required=True)
    parser.add_argument("--max-profiles", type=int)
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = args.raw_dir or args.output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = args.output_dir / "checkpoint.state"
    state = {"nextProfile": 0, "nextShard": 1, "urls": [], "complete": False, "rejected": 0}
    if checkpoint.exists() and not args.restart:
        state = json.loads(checkpoint.read_text())
    if not state["urls"]:
        urls = []
        first_html = fetch(DIRECTORY_URL, args.timeout)
        raw_dir.joinpath("directory-page-00001.html").write_text(first_html)
        total_pages_match = re.search(r'"total_pages":(\d+)', first_html)
        total_pages = int(total_pages_match.group(1)) if total_pages_match else 1
        urls.extend(directory_links(first_html))
        for page in range(2, total_pages + 1):
            html = fetch(f"{DIRECTORY_URL}page/{page}/", args.timeout)
            raw_dir.joinpath(f"directory-page-{page:05d}.html").write_text(html)
            urls.extend(directory_links(html))
            if args.delay:
                time.sleep(args.delay)
        state["urls"] = list(dict.fromkeys(urls))
        checkpoint.write_text(json.dumps(state, indent=2) + "\n")
    batch = []
    processed = 0

    def flush():
        nonlocal batch
        if not batch:
            return
        path = args.output_dir / f"rainforest-alliance-{state['nextShard']:05d}.json"
        path.write_text(json.dumps(snapshot(batch, args.captured_at), indent=2, ensure_ascii=False) + "\n")
        state["nextShard"] += 1
        batch = []

    for index in range(state["nextProfile"], len(state["urls"])):
        url = state["urls"][index]
        slug = url.rstrip("/").split("/")[-1]
        html = fetch(url, args.timeout)
        raw_dir.joinpath(f"profile-{slug}.html").write_text(html)
        try:
            batch.append(profile_record(html, url))
        except ValueError as error:
            with args.output_dir.joinpath("rejected.jsonl").open("a", encoding="utf-8") as rejected:
                rejected.write(json.dumps({"url": url, "error": str(error)}, ensure_ascii=False) + "\n")
            state["rejected"] = state.get("rejected", 0) + 1
        state["nextProfile"] = index + 1
        processed += 1
        if len(batch) >= args.batch_size:
            flush()
            checkpoint.write_text(json.dumps(state, indent=2) + "\n")
        if args.max_profiles and processed >= args.max_profiles:
            break
        if args.delay:
            time.sleep(args.delay)
    flush()
    state["complete"] = state["nextProfile"] >= len(state["urls"])
    checkpoint.write_text(json.dumps(state, indent=2) + "\n")
    print(f"Rainforest Alliance {'complete' if state['complete'] else 'paused'}: {state['nextProfile']}/{len(state['urls'])} profiles, {state.get('rejected', 0)} rejected, {state['nextShard'] - 1} shards")


if __name__ == "__main__":
    main()
