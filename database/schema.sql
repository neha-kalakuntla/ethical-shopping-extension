PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  issuer TEXT NOT NULL,
  source_type TEXT NOT NULL,
  homepage_url TEXT,
  dimensions_json TEXT NOT NULL DEFAULT '[]',
  access_method TEXT,
  license_url TEXT,
  attribution TEXT,
  default_confidence REAL NOT NULL DEFAULT 0.5 CHECK (default_confidence >= 0 AND default_confidence <= 1),
  grading_eligible INTEGER NOT NULL DEFAULT 0 CHECK (grading_eligible IN (0, 1)),
  refresh_interval_hours INTEGER NOT NULL DEFAULT 168,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_success_at TEXT,
  next_refresh_at TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_changed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'application/json',
  raw_content TEXT NOT NULL,
  UNIQUE(source_id, external_id, content_hash)
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'brand', 'product', 'facility', 'certifier')),
  canonical_name TEXT NOT NULL,
  parent_entity_id TEXT REFERENCES entities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source_document_id INTEGER REFERENCES source_documents(id),
  PRIMARY KEY(entity_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS entity_alias_lookup ON entity_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS entity_identifiers (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  source_document_id INTEGER REFERENCES source_documents(id),
  PRIMARY KEY(scheme, value)
);

CREATE TABLE IF NOT EXISTS certifications (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  official_profile_url TEXT,
  verified_at TEXT NOT NULL,
  certified_since TEXT,
  expires_at TEXT,
  score REAL,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  grade_eligible INTEGER NOT NULL DEFAULT 0 CHECK (grade_eligible IN (0, 1)),
  scope_note TEXT,
  geography TEXT,
  scope_details_json TEXT NOT NULL DEFAULT '{}',
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL,
  unit TEXT,
  dimension TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  valid_from TEXT,
  valid_until TEXT,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id),
  observed_at TEXT NOT NULL,
  UNIQUE(entity_id, predicate, value_json, source_document_id)
);

CREATE TABLE IF NOT EXISTS product_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL,
  label TEXT NOT NULL,
  exact_text TEXT NOT NULL,
  normalized_claim TEXT NOT NULL,
  source_field TEXT NOT NULL,
  source_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'contradicted')),
  grade_eligible INTEGER NOT NULL DEFAULT 0 CHECK (grade_eligible IN (0, 1)),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  UNIQUE(entity_id, claim_type, exact_text, source_field, source_url)
);

CREATE INDEX IF NOT EXISTS product_claims_entity ON product_claims(entity_id);
CREATE INDEX IF NOT EXISTS product_claims_status ON product_claims(verification_status, grade_eligible);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  UNIQUE(source_document_id, chunk_index, content_hash)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
  content,
  content='knowledge_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(chunk_id, model)
);
