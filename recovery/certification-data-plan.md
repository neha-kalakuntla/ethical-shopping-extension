# Certification Data Plan

## Current Local Database

Bundled extension file:

`/Users/nehakalakuntla/Documents/ethical-grade-extension/data/certifications.json`

Current purpose:

- prove that verified certification facts can flow into the popup Sources section
- keep certification evidence separate from page text keywords
- let verified certification facts influence deterministic scoring through trusted evidence fields
- avoid scraping or inference inside the browser extension

Current entries are intentionally tiny:

- Patagonia: B Lab Certified B Corporation
- Seventh Generation: B Lab Certified B Corporation
- Grove Collaborative: B Lab Certified B Corporation

These entries were manually checked against official B Lab directory pages on 2026-07-21.

The extension cache is now generated from:

`work/recovery-package/source-snapshots/certifications/b-lab.json`

Generation command:

```bash
node work/recovery-package/scripts/generate-certification-cache.js
```

## Real Database Strategy

The real system should be a generated cache, not hand-edited extension data.

The browser extension should receive a compact, read-only snapshot like:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-21",
  "records": [
    {
      "id": "bcorp-patagonia",
      "brand": "Patagonia",
      "aliases": ["Patagonia", "Patagonia, Inc."],
      "parentCompany": "",
      "certifications": [
        {
          "name": "Certified B Corporation",
          "issuer": "B Lab",
          "status": "listed active",
          "scope": "company",
          "sourceUrl": "https://www.bcorporation.net/en-us/find-a-b-corp/company/patagonia-inc/",
          "sourceType": "official_directory",
          "verifiedAt": "2026-07-21"
        }
      ]
    }
  ]
}
```

## Source Priority

Use official certifier sources first:

1. B Lab Find a B Corp directory  
   Source type: company certification.

2. Fairtrade Finder and FLOCERT Customer Search  
   Source type: operator, trader, producer, or licensee certification. Be careful because this may not always mean a finished retail product is Fairtrade-mark licensed.

3. Rainforest Alliance List of Certificate Holders  
   Source type: farm, group, or supply-chain certificate holder. Be careful about ingredient/product scope.

4. USDA Organic INTEGRITY Database  
   Source type: certified organic operation. Strong source for organic operations, but not always enough to prove a specific Amazon product is organic.

## Ingestion Pipeline

1. Fetch or export official source data outside the extension.
2. Store source snapshots in `work/recovery-package/source-snapshots/certifications`.
3. Normalize names, aliases, parent company names, certificate names, dates, and status fields.
4. Generate a compact extension cache with `work/recovery-package/scripts/generate-certification-cache.js`.
5. Run deterministic validation checks:
   - required source URL
   - required issuer
   - required status
   - known update timestamp
   - no duplicate brand IDs
   - no certification without source
6. Ship only the compact cache to the extension.

## Matching Rules

Start conservative:

- exact brand match is strong
- exact alias match in title is medium
- seller match is weak
- parent-company match should be shown separately from brand certification
- product-page keyword claims should never become verified certification evidence by themselves

When uncertain, show no verified certification.

## Conflict Rules

If sources disagree:

- active official certifier record beats old cached data
- revoked, suspended, cancelled, or expired statuses should be shown as warnings, not positives
- company-level certification should not automatically certify every product
- product-level certification should override generic company-level inference when available

## Extension Rule

The extension should not fetch live certification websites from Amazon pages.

Instead, it should use:

- bundled cache for prototype
- downloaded cache from your backend later
- source URL and timestamp in every record

This keeps the browser fast and keeps grading deterministic.
