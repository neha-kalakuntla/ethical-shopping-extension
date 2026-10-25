# Ethical Grade

Ethical Grade is a Manifest V3 Chrome extension that helps shoppers evaluate products using personalized ethical, environmental, dietary, and budget criteria. It places a letter-grade badge on supported shopping pages and explains the evidence, uncertainty, and calculation behind each result.

## Features

- Personalized category weights and dealbreakers
- Deterministic, versioned letter-grade calculation
- Evidence coverage and confidence indicators
- Certification matching against structured source directories
- Clear separation between verified certifications and unverified packaging claims
- Informational food-category comparisons for climate, land use, freshwater use, and eutrophication
- Barcode, package-text, nutrition, and product-identity tools for image-based product research
- Local SQLite source-of-truth database with compact read-only browser indexes
- Source links and provenance retained throughout the evidence pipeline

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's root folder, which contains `manifest.json`.

After changing extension files, select **Reload** on the extension card and refresh any open shopping pages.

## How grading works

Users can prioritize categories such as labor and human rights, animal welfare, environmental impact, health and nutrition, price, small business, and transparency. Dealbreakers can flag concerns such as animal products, allergens, political alignment, blocked brands or terms, and above-average prices.

Grades are deterministic and evidence-aware. Missing evidence is shown explicitly instead of being treated as proof of good or bad performance. The complete formula, coverage rules, dealbreaker effects, and grade bands are documented in [docs/grading-model.md](docs/grading-model.md).

Environmental category estimates are displayed separately as informational context. They describe global food-category averages, not measurements of a specific branded product, and they never affect the grade. The interface includes dataset attribution, update date, license, metric-specific source links, and compatible category-to-category comparisons.

## Data architecture

SQLite is the local source of truth. Source snapshots are normalized into entities, certifications, facts, environmental measurements, provenance records, and retrieval-ready knowledge chunks. The extension consumes generated JSON indexes from `data/`; it does not open the SQLite database directly.

Key components:

- `shared.js` — grading, evidence normalization, certification matching, and environmental comparison logic
- `content.js` / `content.css` — shopping-page badges, popovers, explanations, and image tools
- `options.html` / `options.js` — preference and dealbreaker setup
- `database/schema.sql` — normalized database schema
- `database/source_registry.json` — provider policies, attribution, confidence, and grading eligibility
- `scripts/update_database.py` — source ingestion and browser-index generation
- `sources/` — structured source snapshots
- `tests/` — grading, matching, ingestion, and source-adapter regression tests

More database details are available in [database/README.md](database/README.md).

## Data integrity principles

- Company-level certification does not imply that every product is certified.
- Packaging text and logos remain unverified until matched to an authoritative source.
- Category estimates are never represented as exact product measurements.
- Comparisons require compatible metrics, units, functional units, and lifecycle boundaries.
- Missing data is reported rather than silently inferred.
- Every scoring signal must retain its evidence source.

## Run tests

Run the shared JavaScript regression suite:

```bash
node tests/test_shared.js
```

Run the Python test suite:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

Check the primary browser scripts for syntax errors:

```bash
node --check shared.js
node --check content.js
node --check background.js
```

## Current scope

Amazon product and search pages have the most complete automatic grading experience. The image context-menu workflow can be used on other websites, but product identification depends on the quality and visibility of package text or barcodes. Source coverage varies by product category, so results should be treated as decision support rather than a definitive judgment about a product or company.
