from __future__ import annotations

import hypothesis.strategies as st
from hypothesis import given
from kavach import money


@given(st.floats(min_value=0.0, max_value=10_000_000.0, allow_nan=False, allow_infinity=False))
def test_parse_inr_float_is_safe(val: float):
    try:
        minor = money.parse_inr(val)
        assert isinstance(minor, int)
        assert minor >= 0
        expected = int(round(val * 100))
        assert minor == expected
    except money.MoneyError:
        pass


@given(st.integers(min_value=0, max_value=10_000_000))
def test_parse_inr_int(val: int):
    assert money.parse_inr(val) == val * 100


@given(st.text())
def test_parse_inr_string(val: str):
    try:
        minor = money.parse_inr(val)
        assert isinstance(minor, int)
        assert minor >= 0
    except ValueError:
        pass  # expected for random unparseable strings
