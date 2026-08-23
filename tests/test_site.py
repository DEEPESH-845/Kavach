"""The landing page states numbers. This fails the build when they drift.

ADR-007 says no metric ships before its experiment. A marketing page is the easiest
place for that discipline to quietly lapse, so the page's numbers are asserted against
evals/risk_report.json and against the tree itself rather than trusted.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = (ROOT / "web" / "kavach.js").read_text()
REPORT = json.loads((ROOT / "evals" / "risk_report.json").read_text())


def test_every_quoted_result_matches_the_report():
    for row in REPORT["results"]:
        for key in ("precision", "recall", "leaked_minor", "review_rate"):
            assert repr(row[key]) in SITE, f"{row['name']} {key} is stale on the site"


def test_every_quoted_sweep_point_matches_the_report():
    for point in REPORT["budget_sweep"]:
        for key in ("escalated", "recall", "precision", "leaked_minor"):
            assert repr(point[key]) in SITE, f"budget {point['budget']} {key} is stale"


def test_the_governor_threshold_is_the_frozen_one():
    assert repr(REPORT["threshold"]) in SITE


def test_the_tree_stats_are_current():
    lines = sum(len(p.read_text().splitlines()) for p in (ROOT / "pkg").rglob("*.py"))
    tests = len(re.findall(r"^def test", "\n".join(
        p.read_text() for p in (ROOT / "tests").glob("test_*.py")), re.M))
    quoted = dict(re.findall(r"(lines|tests): (\d+)", SITE))
    assert int(quoted["lines"]) == lines, f"site says {quoted['lines']} lines, tree has {lines}"
    assert int(quoted["tests"]) == tests, f"site says {quoted['tests']} tests, tree has {tests}"
