#!/usr/bin/env python3
"""High-precision matching from a product description to environmental categories.

The matcher deliberately favors no result over a misleading result. Ingredient
mentions are never used because an ingredient estimate is not a product estimate.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable


PROCESSING_TERMS = {
    "bar", "biscuit", "biscuits", "bread", "cake", "candy", "cereal", "chips", "cookie", "cookies",
    "flavor", "flavored", "flavour", "flavoured", "jam", "juice", "meal",
    "mix", "pie", "pizza", "powder", "sauce", "smoothie", "snack", "soup",
    "spread", "supplement", "syrup", "treat", "treats",
}

SIMPLE_PRODUCT_MODIFIERS = {
    "conventional", "fresh", "frozen", "natural", "organic", "raw", "whole",
    "large", "medium", "small", "red", "green", "yellow", "bunch",
}

VARIETY_CATEGORIES = {
    "Apples", "Bananas", "Berries & Grapes", "Brassicas", "Citrus Fruit",
    "Onions & Leeks", "Other Fruit", "Other Vegetables", "Peas", "Potatoes",
    "Root Vegetables", "Tomatoes",
}


def normalize(value: Any) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split())


def singularize(word: str) -> str:
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("oes") and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def category_aliases(names: Iterable[str]) -> dict[str, set[str]]:
    """Build aliases while suppressing ambiguous shortened category names."""
    names = list(dict.fromkeys(names))
    base_counts: dict[str, int] = {}
    for name in names:
        base = normalize(re.sub(r"\([^)]*\)", "", name))
        base_counts[base] = base_counts.get(base, 0) + 1

    aliases: dict[str, set[str]] = {}
    for name in names:
        canonical = normalize(name)
        base = normalize(re.sub(r"\([^)]*\)", "", name))
        values = {canonical}
        if base and base_counts[base] == 1 and not base.startswith("other "):
            values.add(base)
        if " and " in base and not base.startswith("other "):
            values.update(part.strip() for part in base.split(" and ") if part.strip())
        values.update(" ".join(singularize(word) for word in value.split()) for value in list(values))
        aliases[name] = {value for value in values if value}
    return aliases


def cleaned_title_tokens(title: str) -> list[str]:
    title = normalize(title)
    title = re.sub(r"\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|g|kg|lb|lbs|pound|pounds|count|ct)\b", " ", title)
    return normalize(title).split()


def match_category(
    title: str,
    category_names: Iterable[str],
    structured_categories: Iterable[str] = (),
    ingredients: str = "",
) -> dict[str, Any]:
    """Return one unambiguous category match or a documented refusal.

    ``ingredients`` is accepted so callers can pass the complete product record,
    but is intentionally not examined.
    """
    del ingredients
    alias_map = category_aliases(category_names)
    structured = {normalize(value) for value in structured_categories if normalize(value)}

    structured_matches = []
    for name, aliases in alias_map.items():
        if aliases & structured:
            structured_matches.append(name)
    if len(structured_matches) == 1:
        return {
            "matched": True,
            "category": structured_matches[0],
            "confidence": 0.92,
            "evidence": "structured product category",
            "measurementScope": "category_estimate",
            "informationalOnly": True,
            "gradeEligible": False,
        }
    if len(structured_matches) > 1:
        return {"matched": False, "reason": "ambiguous structured product categories"}

    tokens = cleaned_title_tokens(title)
    if not tokens:
        return {"matched": False, "reason": "missing product title"}
    if PROCESSING_TERMS & set(tokens):
        return {"matched": False, "reason": "title describes a processed or multi-ingredient product"}

    meaningful = [token for token in tokens if token not in SIMPLE_PRODUCT_MODIFIERS and not token.isdigit()]
    candidate = " ".join(meaningful)
    title_matches = [name for name, aliases in alias_map.items() if candidate in aliases]
    if not title_matches:
        title_matches = [
            name for name, aliases in alias_map.items() if name in VARIETY_CATEGORIES
            and any(candidate.endswith(" " + alias) and len(candidate.split()) == len(alias.split()) + 1 for alias in aliases)
        ]
    if len(title_matches) == 1:
        return {
            "matched": True,
            "category": title_matches[0],
            "confidence": 0.88,
            "evidence": "simple product title",
            "measurementScope": "category_estimate",
            "informationalOnly": True,
            "gradeEligible": False,
        }
    if len(title_matches) > 1:
        return {"matched": False, "reason": "ambiguous product title"}
    return {"matched": False, "reason": "no high-confidence category match"}


def load_category_names(snapshot_path: Path) -> list[str]:
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    return [record["productName"] for record in snapshot.get("records", [])]
