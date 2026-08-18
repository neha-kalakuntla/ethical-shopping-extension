#!/usr/bin/env python3
"""Import an extension page-claim export as non-grading SQLite/RAG evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from update_database import DEFAULT_DB, connect, initialize, now

SOURCE_ID = "amazon_merchant_page_claims"


def import_claims(db, path: Path) -> tuple[int, int]:
    payload = json.loads(path.read_text())
    if payload.get("kind") != "merchant_page_claims" or payload.get("schemaVersion") != 1:
        raise ValueError("expected an Ethical Grade merchant_page_claims schemaVersion 1 export")
    db.execute("""INSERT INTO sources(id,label,issuer,source_type,homepage_url,dimensions_json,access_method,
        attribution,default_confidence,grading_eligible,refresh_interval_hours)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING""",
        (SOURCE_ID, "Amazon merchant page claims", "Amazon merchant/product listing", "merchant_page_claim",
         "https://www.amazon.com", '["claims","dietary","transparency"]', "extension_page_extraction",
         "Claims captured verbatim from Amazon product listings", 0.55, 0, 8760))
    products_seen = claims_seen = 0
    for product in payload.get("products", []):
        claims = [claim for claim in product.get("claims", []) if claim.get("exactText")]
        if not claims:
            continue
        asin = str(product.get("asin", "")).upper()
        gtin = str(product.get("gtin", ""))
        if len(asin) != 10 and not gtin:
            continue
        entity_id = f"asin:{asin}" if len(asin) == 10 else f"gtin:{gtin}"
        source_url = product.get("url") or claims[0].get("sourceUrl") or "https://www.amazon.com"
        captured_at = product.get("updatedAt") or payload.get("exportedAt") or now()
        raw = json.dumps(product, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(raw.encode()).hexdigest()
        db.execute("""INSERT OR IGNORE INTO source_documents(source_id,external_id,source_url,captured_at,content_hash,raw_content)
            VALUES(?,?,?,?,?,?)""", (SOURCE_ID, entity_id, source_url, captured_at, digest, raw))
        document_id = db.execute("SELECT id FROM source_documents WHERE source_id=? AND external_id=? AND content_hash=?",
                                 (SOURCE_ID, entity_id, digest)).fetchone()["id"]
        stamp = now()
        title = product.get("title") or entity_id
        db.execute("""INSERT INTO entities(id,entity_type,canonical_name,created_at,updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,updated_at=excluded.updated_at""",
            (entity_id, "product", title, stamp, stamp))
        for scheme, value in (("asin", asin), ("gtin", gtin)):
            if value:
                db.execute("INSERT OR IGNORE INTO entity_identifiers(entity_id,scheme,value,source_document_id) VALUES(?,?,?,?)",
                           (entity_id, scheme, value, document_id))
        for index, claim in enumerate(claims):
            exact_text = str(claim["exactText"])[:500]
            claim_type = str(claim.get("claimType") or "merchant_claim")
            label = str(claim.get("label") or claim_type)
            claim_url = str(claim.get("sourceUrl") or source_url)
            source_field = str(claim.get("sourceField") or "page_text")
            observed_at = str(claim.get("capturedAt") or captured_at)
            confidence = min(0.55, float(claim.get("confidence", 0.55)))
            db.execute("""INSERT OR IGNORE INTO product_claims(entity_id,claim_type,label,exact_text,normalized_claim,
                source_field,source_url,captured_at,verification_status,grade_eligible,confidence,source_document_id)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""", (entity_id, claim_type, label, exact_text,
                str(claim.get("normalizedClaim") or label.lower()), source_field, claim_url, observed_at,
                "unverified", 0, confidence, document_id))
            chunk = f'Amazon\'s product listing for "{title}" claims: {exact_text} This claim has not been verified against an official source and was not included in the grade.'
            chunk_hash = hashlib.sha256(chunk.encode()).hexdigest()
            metadata = {"kind": "merchant_page_claim", "claim_type": claim_type, "source_url": claim_url,
                        "source_field": source_field, "verification_status": "unverified", "grade_eligible": False,
                        "confidence": confidence, "captured_at": observed_at}
            db.execute("INSERT OR IGNORE INTO knowledge_chunks(entity_id,source_document_id,chunk_index,content,metadata_json,content_hash) VALUES(?,?,?,?,?,?)",
                       (entity_id, document_id, index, chunk, json.dumps(metadata, ensure_ascii=False), chunk_hash))
            claims_seen += 1
        products_seen += 1
    db.commit()
    return products_seen, claims_seen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("export", type=Path)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    with connect(args.db) as db:
        initialize(db)
        products, claims = import_claims(db, args.export)
    print(f"imported {claims} page claims for {products} products; all remain grading-ineligible")


if __name__ == "__main__":
    main()
