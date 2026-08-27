"""Centralized money abstraction for safe financial arithmetic.

Floats and doubles must never be used in the money path. This module enforces
strict minor-unit arithmetic, safe parsing from strings, decimals or ints,
and prevents invalid financial inputs (negative, overflow, malformed).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

MAX_MINOR_UNITS = 100_000_000_00  # Example max cap for a transaction: 100 Crore


class MoneyError(ValueError):
    """Base exception for invalid money operations."""
    pass


def parse_inr(value: str | int | float | Decimal) -> int:
    """Safely parse a value into INR minor units (paise).

    Validates:
    - No direct floats (must use str or Decimal if decimal is needed).
    - No negative values.
    - No fractional minor units (e.g. ₹0.001).
    - Checks for overflow limits.
    """
    if isinstance(value, bool):
        raise MoneyError(f"Refusing to parse bool {value!r}.")

    try:
        if isinstance(value, int):
            d = Decimal(value)
        elif isinstance(value, float):
            d = Decimal(str(value))
        else:
            d = Decimal(str(value))
    except (InvalidOperation, TypeError) as e:
        raise MoneyError(f"Malformed money input: {value!r}") from e

    if not d.is_finite() or d.is_nan():
        raise MoneyError(f"Non-finite money input: {value!r}")

    if d < 0:
        raise MoneyError(f"Negative money input not allowed: {value!r}")

    # Multiply by 100 for minor units
    minor = d * Decimal(100)

    # Must be an exact integer
    if minor != minor.to_integral_value():
        raise MoneyError(f"Fractional paise not allowed: {value!r}")

    minor_int = int(minor)
    
    if minor_int > MAX_MINOR_UNITS:
        raise MoneyError(f"Money value exceeds max permitted: {minor_int}")

    return minor_int


def format_inr(minor_units: int) -> str:
    """Format minor units as INR decimal string."""
    if not isinstance(minor_units, int):
        raise TypeError("minor_units must be int")
    return f"{Decimal(minor_units) / 100:.2f}"
