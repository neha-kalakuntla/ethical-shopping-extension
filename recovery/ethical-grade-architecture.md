# Ethical Grade Extension Architecture

## Current Stable Extension

Loaded Chrome extension folder:

`/Users/nehakalakuntla/Documents/ethical-grade-extension`

Do not load the older broken output folder:

`outputs/ethical-grade-extension`

The current extension is intentionally scoped to Amazon. It detects products on cleaner Amazon pages and avoids noisy pages where false labels would confuse users.

## Current Product Detection Rules

### Amazon Detail Pages

Supported URL patterns:

- `/dp/ASIN`
- `/gp/product/ASIN`

Detection uses the ASIN from the URL plus the main product image area. This is the highest-confidence current case.

### Amazon Search Pages

Supported URL patterns:

- `/s`
- `/s/...`

Detection only scans the main search results area, especially `.s-main-slot`.

Each card must have a reliable product identity signal:

- a valid `[data-asin]`, or
- a valid product link containing `/dp/ASIN` or `/gp/product/ASIN`

Each card must also have a useful visible image:

- large enough on screen
- visible, not `display:none` or `visibility:hidden`
- not pinned at the browser origin
- not an Amazon logo, icon, tracker, decorative graphic, or layout artifact

The shopping-cart/sidebar column is intentionally excluded because it produced buggy and confusing grades.

### Category And Browse Pages

Category/browse pages are currently skipped. They are too noisy and inconsistent for the current detector. This is a deliberate trust choice: missing a product is better than grading the wrong thing.

## Current Facts

The extension currently extracts facts from the page itself.

Common facts:

- ASIN
- title
- price
- image URL
- current page URL
- page type

Search-card facts:

- search card text
- visible title
- visible price
- ASIN/product URL

Detail-page facts can also include:

- brand
- seller
- category
- bullet points
- visible certification or ethics keywords found on the page

Important limitation: certification and ethics signals are currently keyword-based. They are not verified against official databases yet.

## Current Grading

The grade calculation is deterministic. The extension uses the user's saved preferences:

- category weights
- strictness
- missing-data penalty
- dealbreakers
- preset/profile settings

Right now, the facts themselves are still mock/page-derived. The scoring logic should stay deterministic even after better data sources are added.

The code already has an evidence adapter called `getProductEvidence(product)`. It creates structured evidence records, but the visible product matcher currently still relies on the older raw product fields to avoid grade regressions in the UI.

## Evidence Rules

Evidence records should include:

- `field`
- `label`
- `value`
- `text`
- `source`
- `confidence`
- `searchable`

Identity-only fields should not influence ethical keyword scoring:

- ASIN
- URL
- image URL

Those fields help identify the product, but they are not ethical evidence.

## Trust Rules

The extension should prefer no label over a wrong label.

The extension should not:

- grade decorative images
- grade Amazon navigation/sidebar images
- infer a company controversy without a source
- use an LLM to calculate final scores
- use image recognition alone as enough evidence for an ethical grade

The extension can eventually use AI for summarizing source material, but not for the final grade math.

## Future Data Providers

The clean future shape is a provider pipeline:

- `pageFactsProvider`: current Amazon page extraction
- `certificationProvider`: currently stubbed; later B Corp, Fair Trade, Rainforest Alliance, and similar verified lists
- `openFoodFactsProvider`: barcode, ingredients, allergens, packaging
- `imageIdentityProvider`: fallback brand/product recognition when ASIN or page metadata is missing
- `controversyProvider`: grounded summaries from trusted search/news/source snippets

Each provider should return structured facts with source and confidence. The deterministic grader should consume those facts.

The current certification provider reads explicitly supplied `verifiedCertifications` fields and a tiny bundled local certification database. Verified certifications now participate in deterministic scoring as a trusted source for relevant categories. It does not scrape live certification websites from shopping pages.

## RAG And AI Usage

RAG can be useful for a short controversy summary, but it should be source-bound.

Allowed AI use:

- summarize provided snippets
- explain why a product received a grade
- help normalize messy text into structured fields when source text is retained

Disallowed AI use:

- invent missing facts
- calculate the weighted score
- decide whether a company has a certification without a verified source
- treat image recognition as proof of product identity without another signal

## Steps

1. Done: keep the permanent extension folder loaded in Chrome.
2. Done: add a "Sources" section to the grade popup so users can see which facts affected the grade.
3. Done: create a provider interface so page facts, APIs, certification databases, and image identity can plug into the same structure.
4. Done: add local test fixtures for Amazon detail pages and search cards.
5. Done: add a certification provider stub for explicitly supplied verified certification facts.
6. Started: add a tiny bundled local certification database.
7. Done: let verified certifications influence deterministic scoring.
8. Started: generate the local database from source snapshots.
9. Next: add more official source snapshots and automate refresh.
10. Later: add image recognition only as a fallback identity helper.
11. Later: add purchase-history footprint tracking.
