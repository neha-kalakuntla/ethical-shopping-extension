#!/usr/bin/env python3
"""Build the source-of-truth SQLite database and extension cache."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "ethical-grade.sqlite3"
DEFAULT_SOURCES = ROOT / "sources"
DEFAULT_CACHE = ROOT / "data" / "certifications.json"
SOURCE_REGISTRY_PATH = ROOT / "database" / "source_registry.json"
ENTITY_ALIAS_OVERRIDES_PATH = ROOT / "database" / "entity_alias_overrides.json"
SOURCE_REGISTRY: dict[str, dict] = {}
ENTITY_ALIAS_OVERRIDES: dict[str, dict] = {}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", " and ")))


def normalized(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower().replace("&", " and ")).split())


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize(db: sqlite3.Connection) -> None:
    db.executescript((ROOT / "database" / "schema.sql").read_text())
    migrations = {
        "sources": {
            "dimensions_json": "TEXT NOT NULL DEFAULT '[]'", "access_method": "TEXT", "license_url": "TEXT",
            "attribution": "TEXT", "default_confidence": "REAL NOT NULL DEFAULT 0.5", "grading_eligible": "INTEGER NOT NULL DEFAULT 0",
        },
        "certifications": {
            "confidence": "REAL NOT NULL DEFAULT 0.5", "is_current": "INTEGER NOT NULL DEFAULT 0",
            "grade_eligible": "INTEGER NOT NULL DEFAULT 0", "scope_note": "TEXT", "geography": "TEXT",
            "scope_details_json": "TEXT NOT NULL DEFAULT '{}'",
            "official_profile_url": "TEXT",
        },
    }
    for table, columns in migrations.items():
        existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
        for column, definition in columns.items():
            if column not in existing:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    db.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)", (now(),))
    db.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)", (now(),))
    db.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)", (now(),))
    db.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)", (now(),))
    db.commit()


def load_source_registry() -> dict[str, dict]:
    payload = json.loads(SOURCE_REGISTRY_PATH.read_text())
    records = payload.get("sources", [])
    registry = {record["id"]: record for record in records}
    if len(registry) != len(records):
        raise ValueError("source registry contains duplicate IDs")
    return registry


def load_entity_alias_overrides() -> dict[str, dict]:
    if not ENTITY_ALIAS_OVERRIDES_PATH.exists():
        return {}
    return json.loads(ENTITY_ALIAS_OVERRIDES_PATH.read_text()).get("overrides", {})


def source_metadata(source: dict) -> dict:
    registered = SOURCE_REGISTRY.get(source["id"])
    if not registered:
        raise ValueError(f"unregistered source: {source['id']}")
    return {**registered, **source}


def validate_snapshot(snapshot: dict, path: Path) -> None:
    if not snapshot.get("capturedAt") or not snapshot.get("source", {}).get("id"):
        raise ValueError(f"{path}: missing capturedAt or source.id")
    source = source_metadata(snapshot["source"])
    if snapshot.get("kind") == "open_food_facts_product":
        for record in snapshot.get("records", []):
            if not str(record.get("code", "")).isdigit():
                raise ValueError(f"{path}: food product requires a numeric barcode")
        return
    for index, record in enumerate(snapshot.get("records", [])):
        missing = [field for field in ("brand", "status", "sourceUrl") if not record.get(field)]
        if missing:
            raise ValueError(f"{path}: record {index} missing {', '.join(missing)}")
        scope = record.get("scope", source.get("defaultScope", "company"))
        if scope not in {"company", "brand", "product", "product_category", "facility", "commodity", "operation"}:
            raise ValueError(f"{path}: record {index} has unsupported scope {scope}")


def certification_state(source: dict, record: dict, observed_at: str) -> tuple[bool, bool]:
    status = str(record.get("status", "")).lower()
    inactive = any(term in status for term in ("expired", "suspended", "revoked", "cancelled", "canceled", "inactive", "withdrawn"))
    active = any(term in status for term in ("active", "certified", "valid", "licensed", "verified")) and not inactive
    expires_at = record.get("expiresAt")
    if expires_at:
        try:
            expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            active = active and expiry >= datetime.now(timezone.utc)
        except ValueError as error:
            raise ValueError(f"invalid expiresAt {expires_at}") from error
    grade_eligible = bool(source.get("gradingEligible", False) and record.get("gradingEligible", True) and active)
    return active, grade_eligible


def ingest_snapshot(db: sqlite3.Connection, path: Path) -> tuple[int, int]:
    raw = path.read_text()
    snapshot = json.loads(raw)
    source = source_metadata(snapshot["source"])
    source_id = source["id"]
    started = now()
    run = db.execute(
        "INSERT INTO ingestion_runs(source_id, started_at, status) VALUES (?, ?, 'running')",
        (source_id, started),
    ) if db.execute("SELECT 1 FROM sources WHERE id=?", (source_id,)).fetchone() else None
    next_refresh = (datetime.now(timezone.utc) + timedelta(hours=source.get("refreshIntervalHours", 168))).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    db.execute("""INSERT INTO sources(id,label,issuer,source_type,homepage_url,dimensions_json,access_method,license_url,
        attribution,default_confidence,grading_eligible,refresh_interval_hours,last_success_at,next_refresh_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, issuer=excluded.issuer,
        source_type=excluded.source_type, homepage_url=excluded.homepage_url,dimensions_json=excluded.dimensions_json,
        access_method=excluded.access_method,license_url=excluded.license_url,attribution=excluded.attribution,
        default_confidence=excluded.default_confidence,grading_eligible=excluded.grading_eligible,
        refresh_interval_hours=excluded.refresh_interval_hours""",
        (source_id, source.get("label", source_id), source["issuer"], source["sourceType"], source.get("homepageUrl"),
         json.dumps(source.get("dimensions", [])), source.get("accessMethod"), source.get("licenseUrl"), source.get("attribution"),
         source.get("defaultConfidence", 0.5), int(bool(source.get("gradingEligible"))), source.get("refreshIntervalHours", 168), None, next_refresh))
    if run is None:
        run = db.execute("INSERT INTO ingestion_runs(source_id, started_at, status) VALUES (?, ?, 'running')", (source_id, started))
    run_id = run.lastrowid
    seen = changed = 0
    for record in snapshot.get("records", []):
        seen += 1
        entity_id = record.get("id") or f"{source.get('recordIdPrefix', source_id)}-{slug(record['brand'])}"
        external_id = entity_id
        record_raw = json.dumps(record, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(record_raw.encode()).hexdigest()
        before = db.total_changes
        doc = db.execute("""INSERT OR IGNORE INTO source_documents
            (source_id,external_id,source_url,captured_at,content_hash,raw_content)
            VALUES(?,?,?,?,?,?)""", (source_id, external_id, record["sourceUrl"], record.get("verifiedAt", snapshot["capturedAt"]), digest, record_raw))
        doc_row = db.execute("SELECT id FROM source_documents WHERE source_id=? AND external_id=? AND content_hash=?", (source_id, external_id, digest)).fetchone()
        doc_id = doc_row["id"]
        stamp = now()
        db.execute("""INSERT INTO entities(id,entity_type,canonical_name,created_at,updated_at)
            VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name, updated_at=excluded.updated_at""",
            (entity_id, "company", record["brand"], stamp, stamp))
        db.execute("DELETE FROM entity_aliases WHERE entity_id=?", (entity_id,))
        reviewed_aliases = ENTITY_ALIAS_OVERRIDES.get(entity_id, {}).get("aliases", [])
        for alias in dict.fromkeys([record["brand"], *record.get("aliases", []), *reviewed_aliases]):
            db.execute("INSERT OR REPLACE INTO entity_aliases(entity_id,alias,normalized_alias,source_document_id) VALUES(?,?,?,?)", (entity_id, alias, normalized(alias), doc_id))
        cert_id = f"{entity_id}:{slug(record.get('certificationName', source['certificationName']))}"
        current, grade_eligible = certification_state(source, record, record.get("verifiedAt", snapshot["capturedAt"]))
        confidence = float(record.get("confidence", source.get("defaultConfidence", 0.5)))
        scope_details = {key: record[key] for key in ("productNames", "matchTerms", "gtins", "certifiedIngredients", "availableIn", "productRules", "certifiedProductText", "extensionEligible", "certificationLevel", "standardVersion", "certificationNumber", "categoryAchievements", "productDescription", "gotsSystemId", "productCategories", "adverse", "adverseType") if record.get(key) is not None}
        reviewed_extension_eligibility = ENTITY_ALIAS_OVERRIDES.get(entity_id, {}).get("extensionEligible")
        if reviewed_extension_eligibility is not None:
            scope_details["extensionEligible"] = bool(reviewed_extension_eligibility)
        official_profile_url = record.get("officialProfileUrl")
        db.execute("""INSERT INTO certifications(id,entity_id,name,issuer,status,scope,source_type,source_url,official_profile_url,
            verified_at,certified_since,expires_at,score,confidence,is_current,grade_eligible,scope_note,geography,scope_details_json,source_document_id,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,
            source_url=excluded.source_url,official_profile_url=excluded.official_profile_url,verified_at=excluded.verified_at,expires_at=excluded.expires_at,
            score=excluded.score,confidence=excluded.confidence,is_current=excluded.is_current,grade_eligible=excluded.grade_eligible,
            scope_note=excluded.scope_note,geography=excluded.geography,scope_details_json=excluded.scope_details_json,source_document_id=excluded.source_document_id,updated_at=excluded.updated_at""",
            (cert_id, entity_id, record.get("certificationName", source["certificationName"]),
             record.get("issuer", source["issuer"]), record["status"], record.get("scope", source.get("defaultScope", "company")),
             record.get("sourceType", source["sourceType"]), record["sourceUrl"], official_profile_url, record.get("verifiedAt", snapshot["capturedAt"]),
             record.get("certifiedSince"), record.get("expiresAt"), record.get("score"), confidence, int(current), int(grade_eligible),
             record.get("scopeNote"), record.get("geography"), json.dumps(scope_details), doc_id, stamp))
        company_facts = record.get("companyFacts", {})
        for predicate, value in company_facts.items():
            dimension = "ethics" if predicate in {"description", "industry", "sector", "company_size"} else "identity"
            db.execute("""INSERT OR IGNORE INTO facts(entity_id,predicate,value_json,dimension,confidence,source_document_id,observed_at)
                VALUES(?,?,?,?,?,?,?)""", (entity_id, predicate, json.dumps(value, sort_keys=True, ensure_ascii=False), dimension, confidence, doc_id,
                record.get("verifiedAt", snapshot["capturedAt"])))
        chunk = f"{record['brand']} is listed as {record['status']} for {record.get('certificationName', source['certificationName'])} by {record.get('issuer', source['issuer'])}."
        if record.get("score") is not None:
            chunk += f" Overall B Impact score: {record['score']}."
        if record.get("geography"):
            chunk += f" Location: {record['geography']}."
        for label, key in (("Industry", "industry"), ("Sector", "sector"), ("Size", "company_size"), ("Description", "description")):
            if company_facts.get(key):
                chunk += f" {label}: {company_facts[key]}."
        chunk_hash = hashlib.sha256(chunk.encode()).hexdigest()
        db.execute("INSERT OR IGNORE INTO knowledge_chunks(entity_id,source_document_id,chunk_index,content,metadata_json,content_hash) VALUES(?,?,?,?,?,?)",
                   (entity_id, doc_id, 0, chunk, json.dumps({"kind": "certification", "source_url": record["sourceUrl"],
                    "dimensions": source.get("dimensions", []), "scope": record.get("scope", source.get("defaultScope", "company")),
                    "confidence": confidence, "is_current": current, "grade_eligible": grade_eligible,
                    "scope_details": scope_details, "official_profile_url": official_profile_url}), chunk_hash))
        changed += int(db.total_changes > before)
    finished = now()
    db.execute("UPDATE ingestion_runs SET finished_at=?,status='succeeded',records_seen=?,records_changed=? WHERE id=?", (finished, seen, changed, run_id))
    db.execute("UPDATE sources SET last_success_at=?,next_refresh_at=? WHERE id=?", (finished, next_refresh, source_id))
    db.commit()
    return seen, changed


def upsert_source(db, source, captured_at):
    source = source_metadata(source)
    next_refresh = (datetime.now(timezone.utc) + timedelta(hours=source.get("refreshIntervalHours", 168))).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    db.execute("""INSERT INTO sources(id,label,issuer,source_type,homepage_url,dimensions_json,access_method,license_url,
        attribution,default_confidence,grading_eligible,refresh_interval_hours,next_refresh_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,issuer=excluded.issuer,
        source_type=excluded.source_type,homepage_url=excluded.homepage_url,dimensions_json=excluded.dimensions_json,
        access_method=excluded.access_method,license_url=excluded.license_url,attribution=excluded.attribution,
        default_confidence=excluded.default_confidence,grading_eligible=excluded.grading_eligible,
        refresh_interval_hours=excluded.refresh_interval_hours""",
        (source["id"], source["label"], source["issuer"], source["sourceType"], source.get("homepageUrl"),
         json.dumps(source.get("dimensions", [])), source.get("accessMethod"), source.get("licenseUrl"), source.get("attribution"),
         source.get("defaultConfidence", 0.5), int(bool(source.get("gradingEligible"))), source.get("refreshIntervalHours", 168), next_refresh))
    run = db.execute("INSERT INTO ingestion_runs(source_id,started_at,status) VALUES(?,?,'running')", (source["id"], now()))
    return run.lastrowid, next_refresh


def ingest_food_snapshot(db, path):
    raw = path.read_text()
    snapshot = json.loads(raw)
    source = snapshot["source"]
    run_id, next_refresh = upsert_source(db, source, snapshot["capturedAt"])
    seen = changed = 0
    for product in snapshot.get("records", []):
        seen += 1
        code = str(product["code"])
        entity_id = f"gtin:{code}"
        source_url = f"https://world.openfoodfacts.org/product/{code}"
        record_raw = json.dumps(product, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = hashlib.sha256(record_raw.encode()).hexdigest()
        before = db.total_changes
        db.execute("""INSERT OR IGNORE INTO source_documents(source_id,external_id,source_url,captured_at,content_hash,raw_content)
            VALUES(?,?,?,?,?,?)""", (source["id"], code, source_url, snapshot["capturedAt"], digest, record_raw))
        doc_id = db.execute("SELECT id FROM source_documents WHERE source_id=? AND external_id=? AND content_hash=?", (source["id"], code, digest)).fetchone()["id"]
        stamp = now()
        name = product.get("product_name") or f"Product {code}"
        db.execute("""INSERT INTO entities(id,entity_type,canonical_name,created_at,updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,updated_at=excluded.updated_at""", (entity_id, "product", name, stamp, stamp))
        db.execute("INSERT OR REPLACE INTO entity_identifiers(entity_id,scheme,value,source_document_id) VALUES(?,?,?,?)", (entity_id, "gtin", code, doc_id))
        for alias in [name, *product.get("brands_tags", [])]:
            if alias:
                db.execute("INSERT OR REPLACE INTO entity_aliases(entity_id,alias,normalized_alias,source_document_id) VALUES(?,?,?,?)", (entity_id, alias, normalized(alias), doc_id))
        facts = {
            "brand": product.get("brands"), "ingredients_text": product.get("ingredients_text"),
            "allergens": product.get("allergens_tags", []), "traces": product.get("traces_tags", []),
            "labels": product.get("labels_tags", []), "categories": product.get("categories_tags", []),
            "nutriments": product.get("nutriments", {}), "nutriscore_grade": product.get("nutriscore_grade"),
            "nova_group": product.get("nova_group"),
            "environmental_score_grade": product.get("environmental_score_grade") or product.get("ecoscore_grade"),
            "packaging": product.get("packagings") or product.get("packaging"),
        }
        for predicate, value in facts.items():
            if value not in (None, "", [], {}):
                dimension = "health" if predicate in {"ingredients_text", "allergens", "traces", "nutriments", "nutriscore_grade", "nova_group"} else "environment" if predicate in {"environmental_score_grade", "packaging"} else "identity"
                db.execute("""INSERT OR IGNORE INTO facts(entity_id,predicate,value_json,dimension,confidence,source_document_id,observed_at)
                    VALUES(?,?,?,?,?,?,?)""", (entity_id, predicate, json.dumps(value, sort_keys=True, ensure_ascii=False), dimension, 0.75, doc_id, snapshot["capturedAt"]))
        summary_parts = [name, f"Barcode {code}."]
        if product.get("brands"): summary_parts.append(f"Brand: {product['brands']}.")
        if product.get("ingredients_text"): summary_parts.append(f"Ingredients: {product['ingredients_text']}")
        if product.get("allergens_tags"): summary_parts.append("Allergens: " + ", ".join(product["allergens_tags"]) + ".")
        if product.get("nutriscore_grade"): summary_parts.append(f"Nutri-Score: {product['nutriscore_grade']}.")
        chunk = " ".join(summary_parts)
        chunk_hash = hashlib.sha256(chunk.encode()).hexdigest()
        db.execute("INSERT OR IGNORE INTO knowledge_chunks(entity_id,source_document_id,chunk_index,content,metadata_json,content_hash) VALUES(?,?,?,?,?,?)",
                   (entity_id, doc_id, 0, chunk, json.dumps({"kind": "food_product", "barcode": code, "source_url": source_url}), chunk_hash))
        changed += int(db.total_changes > before)
    finished = now()
    db.execute("UPDATE ingestion_runs SET finished_at=?,status='succeeded',records_seen=?,records_changed=? WHERE id=?", (finished, seen, changed, run_id))
    db.execute("UPDATE sources SET last_success_at=?,next_refresh_at=? WHERE id=?", (finished, next_refresh, source["id"]))
    db.commit()
    return seen, changed


def export_cache(db: sqlite3.Connection, path: Path) -> int:
    rows = db.execute("""SELECT e.id,e.canonical_name,a.alias,c.*,s.id AS certification_source_id FROM entities e
        LEFT JOIN entity_aliases a ON a.entity_id=e.id JOIN certifications c ON c.entity_id=e.id
        JOIN source_documents d ON d.id=c.source_document_id JOIN sources s ON s.id=d.source_id
        ORDER BY e.canonical_name,a.alias""").fetchall()
    records: dict[str, dict] = {}
    for row in rows:
        item = records.setdefault(row["id"], {"id": row["id"], "brand": row["canonical_name"], "aliases": [], "parentCompany": "", "certifications": []})
        if row["alias"] and row["alias"] not in item["aliases"]:
            item["aliases"].append(row["alias"])
        cert = {"name": row["name"], "issuer": row["issuer"], "status": row["status"], "scope": row["scope"],
                "sourceUrl": row["source_url"], "sourceType": row["source_type"], "sourceId": row["certification_source_id"],
                "verifiedAt": row["verified_at"], "confidence": row["confidence"], "current": bool(row["is_current"]),
                "gradeEligible": bool(row["grade_eligible"])}
        if row["official_profile_url"]:
            cert["officialProfileUrl"] = row["official_profile_url"]
        for key, column in (("scopeNote", "scope_note"), ("geography", "geography")):
            if row[column]:
                cert[key] = row[column]
        cert.update(json.loads(row["scope_details_json"] or "{}"))
        for key, column in (("certifiedSince", "certified_since"), ("expiresAt", "expires_at"), ("score", "score")):
            if row[column] is not None:
                cert[key] = row[column]
        if cert not in item["certifications"]:
            item["certifications"].append(cert)
    payload = {"schemaVersion": 2, "updatedAt": now()[:10], "description": "Generated from the Ethical Grade source database. Do not hand-edit.", "records": list(records.values())}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return len(records)


def export_products(db, path):
    rows = db.execute("""SELECT e.id,e.canonical_name,i.value AS barcode,f.predicate,f.value_json,d.source_url,d.captured_at
        FROM entities e JOIN entity_identifiers i ON i.entity_id=e.id AND i.scheme='gtin'
        LEFT JOIN facts f ON f.entity_id=e.id LEFT JOIN source_documents d ON d.id=f.source_document_id
        WHERE e.entity_type='product' ORDER BY e.canonical_name""").fetchall()
    products = {}
    for row in rows:
        item = products.setdefault(row["id"], {"id": row["id"], "barcode": row["barcode"], "name": row["canonical_name"], "facts": {}, "sourceUrl": row["source_url"], "capturedAt": row["captured_at"]})
        if row["predicate"]:
            item["facts"][row["predicate"]] = json.loads(row["value_json"])
    path.write_text(json.dumps({"schemaVersion": 1, "updatedAt": now()[:10], "products": list(products.values())}, indent=2, ensure_ascii=False) + "\n")
    return len(products)


def export_lookup_index(db, path):
    rows = db.execute("""SELECT e.id,e.canonical_name,a.alias,c.*,c.id AS certification_id,s.id AS certification_source_id FROM entities e
        LEFT JOIN entity_aliases a ON a.entity_id=e.id JOIN certifications c ON c.entity_id=e.id
        JOIN source_documents d ON d.id=c.source_document_id JOIN sources s ON s.id=d.source_id
        WHERE COALESCE(json_extract(c.scope_details_json,'$.extensionEligible'),1) != 0
        ORDER BY e.canonical_name,a.alias""").fetchall()
    providers = {}
    records = {}
    seen_certifications = set()
    for row in rows:
        providers.setdefault(row["certification_source_id"], {
            "name": row["name"], "issuer": row["issuer"], "sourceType": row["source_type"]
        })
        item = records.setdefault(row["id"], [row["id"], row["canonical_name"], [], []])
        if row["alias"] and normalized(row["alias"]) != normalized(row["canonical_name"]) and row["alias"] not in item[2]:
            item[2].append(row["alias"])
        if row["certification_id"] in seen_certifications:
            continue
        details = json.loads(row["scope_details_json"] or "{}")
        compact_metadata = {key: value for key, value in details.items() if key not in {"productNames", "matchTerms", "productRules"}}
        item[3].append([
            row["certification_source_id"], row["status"], row["scope"],
            row["official_profile_url"] or row["source_url"], row["confidence"],
            int(row["is_current"]), int(row["grade_eligible"]),
            details.get("productNames", []), details.get("matchTerms", []), details.get("productRules", []), compact_metadata, row["name"]
        ])
        seen_certifications.add(row["certification_id"])
    payload = {"schemaVersion": 1, "updatedAt": now()[:10], "providers": providers, "records": list(records.values())}
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    return len(records)


def reconcile_certifications(db, imported_ids):
    """Remove certification rows no longer present in a complete directory snapshot."""
    db.execute("CREATE TEMP TABLE IF NOT EXISTS current_import_certifications(source_id TEXT, certification_id TEXT, PRIMARY KEY(source_id, certification_id))")
    db.execute("DELETE FROM current_import_certifications")
    db.executemany(
        "INSERT INTO current_import_certifications(source_id,certification_id) VALUES(?,?)",
        [(source_id, cert_id) for source_id, ids in imported_ids.items() for cert_id in ids],
    )
    for source_id in imported_ids:
        db.execute("""DELETE FROM certifications AS c
            WHERE EXISTS (SELECT 1 FROM source_documents d WHERE d.id=c.source_document_id AND d.source_id=?)
            AND NOT EXISTS (SELECT 1 FROM current_import_certifications i WHERE i.source_id=? AND i.certification_id=c.id)""",
            (source_id, source_id))
    db.commit()


def main() -> None:
    global SOURCE_REGISTRY, ENTITY_ALIAS_OVERRIDES
    SOURCE_REGISTRY = load_source_registry()
    ENTITY_ALIAS_OVERRIDES = load_entity_alias_overrides()
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("init", "update", "stats"), nargs="?", default="update")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()
    with connect(args.db) as db:
        initialize(db)
        if args.command == "update":
            total = changed = 0
            imported_ids = {}
            for path in sorted(args.sources.rglob("*.json")):
                snapshot = json.loads(path.read_text())
                validate_snapshot(snapshot, path)
                if snapshot.get("kind") != "open_food_facts_product":
                    source = source_metadata(snapshot["source"])
                    ids = imported_ids.setdefault(source["id"], set())
                    for record in snapshot.get("records", []):
                        entity_id = record.get("id") or f"{source.get('recordIdPrefix', source['id'])}-{slug(record['brand'])}"
                        ids.add(f"{entity_id}:{slug(record.get('certificationName', source['certificationName']))}")
                handler = ingest_food_snapshot if snapshot.get("kind") == "open_food_facts_product" else ingest_snapshot
                a, b = handler(db, path); total += a; changed += b
            reconcile_certifications(db, imported_ids)
            exported = export_cache(db, args.cache)
            export_lookup_index(db, args.cache.with_name("certification-index.json"))
            products = export_products(db, args.cache.with_name("products.json"))
            print(f"updated database: {total} records read, {changed} processed, {exported} certifications and {products} products exported")
        elif args.command == "stats":
            for table in ("sources", "source_documents", "entities", "certifications", "facts", "product_claims", "knowledge_chunks"):
                print(f"{table}: {db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]}")


if __name__ == "__main__":
    main()
