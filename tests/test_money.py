
import pytest
from kavach.money import MoneyError, format_inr, parse_inr


def test_parse_inr_valid():
    assert parse_inr(5000) == 500000
    assert parse_inr("5000") == 500000
    assert parse_inr("100.50") == 10050
    assert parse_inr(100.50) == 10050
    assert parse_inr("0") == 0
    assert parse_inr("0.01") == 1

def test_parse_inr_invalid():
    with pytest.raises(MoneyError):
        parse_inr("100.555")
    with pytest.raises(MoneyError):
        parse_inr(-100)
    with pytest.raises(MoneyError):
        parse_inr("-100.50")
    with pytest.raises(MoneyError):
        parse_inr("abc")
    with pytest.raises(MoneyError):
        parse_inr(True)
    with pytest.raises(MoneyError):
        parse_inr(float("nan"))
    with pytest.raises(MoneyError):
        parse_inr(float("inf"))

def test_format_inr():
    assert format_inr(500000) == "5000.00"
    assert format_inr(10050) == "100.50"
    assert format_inr(1) == "0.01"
    assert format_inr(0) == "0.00"
