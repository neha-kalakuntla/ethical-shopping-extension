# Ethical Grade scoring model

Model version: **1**

The grade is deterministic. Product identity and evidence retrieval happen before scoring; no language model chooses the score or letter grade.

## 1. Category scores

Every enabled category begins at a neutral score of 70. Sourced positive and concern signals adjust that category, and the result is clamped to 0–100. A category with no positive or concern evidence is unavailable: it receives no score and contributes no points.

Unverified merchant certification claims are retained as possible future evidence but do not create certification credit. Verified certification records may contribute only to categories supported by that certification's defined scope.

## 2. Weighted score and missing evidence

Only available categories are combined. Their configured user weights are renormalized across the available evidence:

```text
weighted evidence score = Σ(category score × category weight / available weight)
coverage = available weight / total enabled weight
```

Renormalization prevents missing evidence from being treated as negative evidence. Coverage controls whether the result is sufficiently supported:

| Missing-data setting | Minimum coverage |
| --- | ---: |
| Light | 25% |
| Medium | 40% |
| Strong | 60% |

Below the threshold, the result is `N/A` rather than a letter grade.

## 3. Strictness

Strictness applies a transparent global adjustment after category weighting:

| Strictness | Adjustment |
| --- | ---: |
| Gentle | +4 |
| Balanced | 0 |
| Strict | −5 |

Intermediate slider values are linearly interpolated.

## 4. Dealbreakers

- `warning`: subtracts 4 points per triggered rule.
- `cap`: limits the final numeric score to 76.
- `avoid`: overrides the result to `Avoid` with a score of 0.

Rules requiring authoritative facts—such as political alignment or category-average pricing—cannot trigger from an unverified merchant claim alone.

## 5. Letter bands

| Score | Grade | Score | Grade |
| ---: | :--- | ---: | :--- |
| 97–100 | A+ | 77–79 | C+ |
| 93–96 | A | 73–76 | C |
| 90–92 | A− | 70–72 | C− |
| 87–89 | B+ | 67–69 | D+ |
| 83–86 | B | 63–66 | D |
| 80–82 | B− | 60–62 | D− |
| 0–59 | F | — | — |

Every `gradeProduct` result includes a `calculation` object containing category contributions, evidence coverage, strictness adjustment, warning penalty, caps, overrides, and the final result. This is the auditable explanation used by tests and future UI.
