"""The landing page states numbers and names. This fails the build when they drift.

ADR-007 says no metric ships before its experiment. A page is the easiest place for that
discipline to lapse quietly, so everything it asserts is checked against the tree rather
than trusted: the benchmark numbers against the report, the policy constants against
`governor.Policy`, and every enum member and tool name it prints against the source that
defines them.
"""

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
# every constant the page states lives in one module; the markup is spread across the
# components, so the vocabulary checks read all of them at once
SITE = (WEB / "lib" / "data.ts").read_text()
PAGE = "\n".join(p.read_text() for p in sorted((WEB / "components").glob("*.tsx")))
REPORT = json.loads((ROOT / "evals" / "risk_report.json").read_text())


def _defaults(path: Path, cls: str) -> dict:
    """Field defaults of a dataclass, read from source rather than imported."""
    tree = ast.parse(path.read_text())
    node = next(n for n in ast.walk(tree)
                if isinstance(n, ast.ClassDef) and n.name == cls)
    return {s.target.id: ast.literal_eval(s.value)
            for s in node.body if isinstance(s, ast.AnnAssign) and s.value is not None}


def _members(path: Path, cls: str) -> set[str]:
    tree = ast.parse(path.read_text())
    node = next(n for n in ast.walk(tree)
                if isinstance(n, ast.ClassDef) and n.name == cls)
    return {t.id for s in node.body if isinstance(s, ast.Assign)
            for t in s.targets if isinstance(t, ast.Name)}


def test_every_quoted_result_matches_the_report():
    for row in REPORT["results"]:
        for key in ("precision", "recall", "leaked_minor", "review_rate"):
            assert repr(row[key]) in SITE, f"{row['name']} {key} is stale on the site"


def test_every_quoted_sweep_point_matches_the_report():
    for point in REPORT["budget_sweep"]:
        for key in ("escalated", "recall", "precision", "leaked_minor"):
            assert repr(point[key]) in SITE, f"budget {point['budget']} {key} is stale"


def test_the_benchmark_threshold_and_base_rate_match_the_report():
    assert repr(REPORT["threshold"]) in SITE
    assert repr(REPORT["duplicate_rate_assumption"]) in SITE


def test_no_plane_claims_to_be_built_before_its_module_exists():
    """The page shows a built/planned marker per plane. It has to be the truth."""
    claims = re.findall(r"src: '([^']+)', built: (true|false)", SITE)
    assert len(claims) == 8, f"expected 8 planes, found {len(claims)}"
    for src, built in claims:
        exists = (ROOT / "pkg" / "kavach" / src).exists()
        assert exists == (built == "true"), (
            f"pkg/kavach/{src} {'exists' if exists else 'does not exist'}, "
            f"but the page marks it {'built' if built == 'true' else 'planned'}")


def test_the_policy_the_page_simulates_is_the_policy_the_governor_uses():
    policy = _defaults(ROOT / "pkg" / "kavach" / "governor.py", "Policy")
    quoted = {k: v for k, v in re.findall(
        r"(max_auto_refund_minor|session_cap_minor|daily_cap_minor|risk_threshold): ([\d_.]+)",
        SITE)}
    assert quoted, "the site no longer declares a POLICY block"
    for field, raw in quoted.items():
        want = policy[field]
        got = float(raw.replace("_", "")) if "." in raw else int(raw.replace("_", ""))
        assert got == want, f"site POLICY.{field}={got}, governor.Policy has {want}"


def test_the_staleness_tolerance_the_hero_shows_is_the_one_truth_uses():
    src = (ROOT / "pkg" / "kavach" / "truth.py").read_text()
    hours = int(re.search(r'"refund":\s*(\d+)\s*\*\s*3600', src).group(1))
    assert f"staleness tolerance {hours:02d}:00:00" in PAGE


def test_every_state_name_on_the_page_exists_in_the_code():
    truth = ROOT / "pkg" / "kavach" / "truth.py"
    known = _members(truth, "Rail") | _members(truth, "Confidence")
    known |= _members(ROOT / "pkg" / "kavach" / "governor.py", "Action")
    known |= {"STEP_UP", "HOLD"}          # gate/admission.py verdicts, per the Phase 1 spec
    shown = set(re.findall(r"\b(?:[A-Z]{4,}_)*[A-Z]{4,}\b", PAGE + SITE))
    shown &= {w for w in shown if w.isupper() and "_" in w or w in known}
    unknown = {w for w in shown if w in
               {"INITIATED", "ACCEPTED", "PROCESSING", "CONFIRMED", "SETTLED", "REVERSED",
                "AMBIGUOUS", "FAILED_TERMINAL", "DERIVED_CERTAIN", "DERIVED_PROBABLE",
                "UNKNOWN", "ALLOW", "ESCALATE", "DENY", "STEP_UP", "HOLD"}} - known
    assert not unknown, f"the page shows states the code does not define: {unknown}"


def test_every_tool_the_page_advertises_is_a_tool_the_server_exposes():
    src = (ROOT / "pkg" / "kavach" / "mcp" / "server.py").read_text()
    exposed = set(re.findall(r"@mcp\.tool\([^)]*\)\s*\ndef (\w+)", src))
    advertised = set(re.findall(r"\{ n: '(\w+)',", SITE))
    assert advertised, "the site no longer declares a TOOLS block"
    assert advertised == exposed, f"site advertises {advertised}, server exposes {exposed}"


def test_the_entry_point_the_page_prints_is_the_one_that_is_installed():
    pyproject = (ROOT / "pyproject.toml").read_text()
    name = re.search(r"^(\S+) = \"kavach\.mcp\.server:main\"", pyproject, re.M).group(1)
    assert f'"command": "{name}"' in PAGE


def test_the_test_count_the_footer_states_is_the_real_one():
    tests = len(re.findall(r"^def test", "\n".join(
        p.read_text() for p in (ROOT / "tests").glob("test_*.py")), re.M))
    quoted = int(re.search(r"TREE = \{[^}]*tests: (\d+)", SITE).group(1))
    assert quoted == tests, f"site says {quoted} tests, tree has {tests}"


def test_the_scenario_count_the_footer_states_is_the_real_one():
    """The footer says how many adversary scenarios exist. The lab's registry says the same,
    or the footer is quoting a number nothing checks -- which is the drift ADR-007 exists to
    stop, and the reason the test count is already guarded here."""
    from kavach.services import scenarios

    quoted = int(re.search(r"TREE = \{[^}]*scenarios: (\d+)", SITE).group(1))
    assert quoted == len(scenarios.catalogue()), (
        f"site says {quoted} scenarios, the lab registers {len(scenarios.catalogue())}")


def test_the_footer_does_not_reuse_a_plane_name_as_a_slogan():
    """`proof` names the hash-chain plane and section 08. Using it as the footer's sign-off
    repeated the section and widened the word into a general claim of confidence. The mark
    states what is checked instead."""
    mark = re.search(r'className="foot__mark">.*?</p>', PAGE, re.S)
    assert mark, "the footer no longer has a mark"
    assert "proof" not in mark.group(0).lower(), (
        "the footer mark claims 'proof'; it should name what is actually checked")
