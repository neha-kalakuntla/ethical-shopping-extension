# Ethical Grade Data Layer

SQLite is the local source of truth. The Chrome extension never opens the database; it consumes generated, read-only JSON caches from `data/`.

`data/certifications.json` is the detailed audit export. Amazon pages load the smaller `data/certification-index.json`, whose tuple-based representation deduplicates provider metadata while retaining aliases, scope constraints, current/grade-eligible state, confidence, and official profile links.

`database/source_registry.json` is the allowlist and policy record for every provider. A snapshot from an unregistered provider is rejected. Registry entries define dimensions, access method, attribution, refresh interval, default confidence, and whether that provider is currently allowed to affect grades.

Run the complete local refresh:

```bash
python3 scripts/update_database.py update
```

The updater initializes the schema, ingests every JSON snapshot under `sources/`, records provenance and refresh history, creates searchable RAG chunks, and regenerates `data/certifications.json`.

`source_documents` retains the exact captured record and hash. Normalized facts and certifications always point back to that evidence. `knowledge_chunks` is indexed with SQLite FTS5 for retrieval today; `embeddings` is reserved for vector retrieval later.

Official directory profile links are retained as `official_profile_url` in SQLite and `officialProfileUrl` in the generated cache. These links can be shown directly in the popup and are also copied into certification RAG chunk metadata.

Certification evidence has two separate states:

- `current`: the official status is active and any expiration date has not passed.
- `grade_eligible`: the record is current, the source is approved for grading, and the individual record has not been restricted.

Non-current or review-only evidence remains available for provenance and RAG explanations but is filtered out of deterministic scoring.

Certification scope is also enforced during product matching. Product-level records require a listed product name, while category- or ingredient-limited brand records require a matching term in the product title or page text. This prevents one certified product from making every product sold by its brand appear certified.

The first reviewed snapshots cover B Lab, Rainforest Alliance's Find the Frog directory, and a Fair Trade USA product guide. Fair Trade USA and Fairtrade International are separate providers in the registry and must not be merged.

## Bulk B Corp imports

With B Lab authorization, collect the structured public directory into JSONL, preserving each raw response page:

```bash
python3 scripts/fetch_bcorp_directory.py work/bcorps.jsonl --raw-dir work/bcorps-raw
```

The collector uses the same public Typesense search interface as B Lab's directory, runs in 250-record pages, saves a checkpoint, retries transient failures, and can resume after interruption. Use `--max-pages 1` for a smoke test. The public endpoint, collection, and search-only key are configurable because B Lab may rotate them.

Convert that JSONL—or another authorized CSV, JSON, or JSONL export—into resumable 500-record snapshots:

```bash
python3 scripts/import_bcorp_bulk.py work/bcorps.jsonl sources/certifications/b-lab-bulk
python3 scripts/update_database.py update
```

The importer accepts common names for company, profile URL, status, score, certification dates, and geography. It requires an official HTTPS B Corp company-profile URL, preserves that URL for popup and RAG citations, checkpoints after each shard, deduplicates profile URLs, and writes malformed input rows to `rejected.jsonl`. Its operational files use non-JSON extensions, so the database updater only sees completed snapshot shards.

## Rainforest Alliance directory

Collect the official Find the Frog directory into scoped snapshots:

```bash
python3 scripts/fetch_rainforest_alliance.py sources/certifications/rainforest-alliance-bulk \
  --raw-dir data/raw/rainforest-alliance/2026-08-04 --captured-at 2026-08-04
python3 scripts/update_database.py update
```

The adapter stores the directory's product categories, certified crops/ingredients, availability countries, official listing URL, and last-updated date. Matching requires a listed product category or ingredient term; the listing is never treated as certification of every item sold by the brand.

## Certified Humane

```bash
python3 scripts/fetch_certified_humane.py sources/certifications/certified-humane \
  --raw data/raw/certified-humane/2026-08-04/directory.html --captured-at 2026-08-04
python3 scripts/update_database.py update
```

The official table often lists several consumer labels under one producer. The adapter stores paired product rules so a product phrase certified for one private label cannot be transferred to another label or to every product sold by the producer.

## Fairtrade International

```bash
python3 scripts/fetch_fairtrade_international.py sources/certifications/fairtrade-international \
  --raw-dir data/raw/fairtrade-international/2026-08-04 --captured-at 2026-08-04

python3 scripts/fetch_leaping_bunny.py sources/certifications/leaping-bunny \
  --raw-dir data/raw/leaping-bunny/2026-08-05 --captured-at 2026-08-05

python3 scripts/fetch_certified_vegan.py sources/certifications/certified-vegan \
  --raw-dir data/raw/certified-vegan/2026-08-05 --captured-at 2026-08-05

python3 scripts/fetch_regenerative_organic.py sources/certifications/regenerative-organic \
  --raw data/raw/regenerative-organic/2026-08-05/directory.html --captured-at 2026-08-05

python3 scripts/fetch_cradle_to_cradle.py sources/certifications/cradle-to-cradle --captured-at 2026-08-05

python3 scripts/fetch_gots.py sources/certifications/gots --captured-at 2026-08-05
python3 scripts/update_database.py update
```

The GOTS importer uses the official Global Trace Base public API. It stores certified suppliers, consumer brand aliases, geography, and listed textile product categories. A supplier-directory match alone is never enough for retail verification: the matcher also requires explicit GOTS wording on the product listing and a matching certified product category.

The adapter reads the official Finder's public search configuration, imports licensed and certified operators, and preserves FLO-ID, licensing body, certification body, standards, geography, and product categories. A licensed operator with published product categories is matched only within those categories. Licensees without usable product scope remain provenance-only. Certified-but-unlicensed producers and traders are stored as supply-chain/RAG evidence but are excluded from both grading and the compact browser index.

## bluesign System Partners

bluesign's official downloadable brand-partner list is imported for company-level provenance and future RAG:

```bash
python3 scripts/fetch_bluesign_partners.py
python3 scripts/update_database.py update
```

Every imported partner record is explicitly grading-ineligible. A System Partner relationship describes a brand's participation in the bluesign system; it does not prove that an individual retail item is a bluepass consumer product. Product credit therefore requires the product's official bluepass QR/identifier verification.

Future provider fetchers should save immutable source snapshots before ingestion. A scheduler or CI job can run those fetchers and this updater on each provider's refresh interval.

## Open Food Facts

The browser extension does not bundle or bulk-import the Open Food Facts catalog. On Amazon
product pages, it queries the official API only when the page exposes a valid UPC/EAN/GTIN.
Successful responses are cached in `chrome.storage.local` for seven days; misses are cached for
one day. Merchant listings without a valid barcode are not sent to Open Food Facts.

For reproducible fixtures, database experiments, or future RAG ingestion, fetch one or more
targeted barcodes manually and then update the database:

```bash
python3 scripts/fetch_open_food_facts.py 3017620422003
python3 scripts/update_database.py update
```

The checked-in Nutella example lives under `tests/fixtures/open-food-facts/`; it is test-only and
is not discovered by production database updates.

Set `ETHICAL_GRADE_CONTACT` to a project URL or monitored email before production use so the API request has an identifying `User-Agent`. Targeted lookups use the current v3.6 endpoint and request only the fields the app stores. For catalogs larger than a few hundred products, use Open Food Facts' downloadable data exports rather than looping over this command.
