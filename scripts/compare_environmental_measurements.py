#!/usr/bin/env python3
"""Conservative normalization and comparison for environmental measurements.

This module is intentionally independent from grading. It only determines whether
two sourced measurements are comparable and, when they are, expresses their
values in a shared canonical unit.
"""

from __future__ import annotations

import re
from typing import Any


UNIT_CONVERSIONS = {
    "g_co2e": ("kg_co2e", 0.001),
    "kg_co2e": ("kg_co2e", 1.0),
    "t_co2e": ("kg_co2e", 1000.0),
    "ml": ("l", 0.001),
    "l": ("l", 1.0),
    "liter": ("l", 1.0),
    "liters": ("l", 1.0),
    "litre": ("l", 1.0),
    "litres": ("l", 1.0),
    "m3": ("l", 1000.0),
    "m2_year": ("m2_year", 1.0),
    "g_po4e": ("g_po4e", 1.0),
}

LOWER_IS_BETTER_METRICS = {
    "climate_change",
    "freshwater_use",
    "water_use",
    "land_use",
    "eutrophication",
    "material_waste",
}

SCOPE_LABELS = {
    "exact_product": "exact product",
    "product_variant": "product variant",
    "category_estimate": "category estimate",
    "ingredient_estimate": "ingredient estimate",
}


def normalized_context(value: Any) -> str:
    """Normalize labels without pretending unlike concepts are equivalent."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split())


def normalized_unit(value: Any) -> str:
    unit = str(value or "").strip().lower()
    unit = unit.replace("co₂", "co2").replace("co2-eq", "co2e").replace("co2eq", "co2e")
    unit = re.sub(r"[\s-]+", "_", unit)
    unit = {"kgco2e": "kg_co2e", "gco2e": "g_co2e", "tco2e": "t_co2e", "m^3": "m3"}.get(unit, unit)
    return unit


def normalize_measurement(measurement: dict[str, Any]) -> dict[str, Any]:
    """Return a copy with safely converted value and uncertainty bounds."""
    unit = normalized_unit(measurement.get("unit"))
    if unit not in UNIT_CONVERSIONS:
        raise ValueError(f"unsupported environmental unit: {measurement.get('unit')}")
    canonical_unit, factor = UNIT_CONVERSIONS[unit]
    result = dict(measurement)
    result["value"] = float(measurement["value"]) * factor
    result["unit"] = canonical_unit
    for key in ("lower_bound", "upper_bound"):
        value = measurement.get(key)
        result[key] = None if value is None else float(value) * factor
    return result


def compare_measurements(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Compare two measurements only when their scientific context aligns."""
    reasons = []
    for field in ("metric", "functional_unit", "lifecycle_boundary"):
        if normalized_context(left.get(field)) != normalized_context(right.get(field)):
            reasons.append(f"different {field.replace('_', ' ')}")

    try:
        normalized_left = normalize_measurement(left)
        normalized_right = normalize_measurement(right)
    except ValueError as error:
        reasons.append(str(error))
        normalized_left = normalized_right = None

    if normalized_left and normalized_right and normalized_left["unit"] != normalized_right["unit"]:
        reasons.append("incompatible units")

    if reasons:
        return {"comparable": False, "reasons": reasons}

    left_value = normalized_left["value"]
    right_value = normalized_right["value"]
    difference = left_value - right_value
    ratio = None if right_value == 0 else left_value / right_value
    metric = normalized_context(left.get("metric")).replace(" ", "_")

    winner = None
    if metric in LOWER_IS_BETTER_METRICS and difference != 0:
        winner = "left" if difference < 0 else "right"

    left_upper = normalized_left.get("upper_bound")
    left_lower = normalized_left.get("lower_bound")
    right_upper = normalized_right.get("upper_bound")
    right_lower = normalized_right.get("lower_bound")
    ranges_overlap = None
    if None not in (left_lower, left_upper, right_lower, right_upper):
        ranges_overlap = max(left_lower, right_lower) <= min(left_upper, right_upper)

    return {
        "comparable": True,
        "metric": left.get("metric"),
        "unit": normalized_left["unit"],
        "functionalUnit": left.get("functional_unit"),
        "lifecycleBoundary": left.get("lifecycle_boundary"),
        "left": {
            "value": left_value,
            "lowerBound": left_lower,
            "upperBound": left_upper,
            "scope": left.get("measurement_scope"),
            "scopeLabel": SCOPE_LABELS.get(left.get("measurement_scope"), left.get("measurement_scope")),
        },
        "right": {
            "value": right_value,
            "lowerBound": right_lower,
            "upperBound": right_upper,
            "scope": right.get("measurement_scope"),
            "scopeLabel": SCOPE_LABELS.get(right.get("measurement_scope"), right.get("measurement_scope")),
        },
        "difference": difference,
        "ratio": ratio,
        "lowerImpact": winner,
        "uncertaintyRangesOverlap": ranges_overlap,
        "informationalOnly": True,
        "gradeEligible": False,
    }
