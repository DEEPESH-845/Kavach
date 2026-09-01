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
    out = {}
    for s in node.body:
        if not isinstance(s, ast.AnnAssign) or s.value is None:
            continue
        try:
            out[s.target.id] = ast.literal_eval(s.value)
        except ValueError:
            continue  # a computed default (field(default_factory=...)); nothing to compare
    return out


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


def test_the_footer_mark_is_the_project_name_not_a_slogan():
    """The footer signs the page with the product's name, the same word the header nav and
    the console sidebar use.

    It read `proof.`, which is worse than a stray slogan: `proof` names the hash-chain plane
    and section 08, so the sign-off both repeated that section and widened the word from
    "the chain verifies" into a general claim of confidence.
    """
    mark = re.search(r'className="foot__mark">(.*?)</p>', PAGE, re.S)
    assert mark, "the footer no longer has a mark"
    body = mark.group(1)
    assert "KAVACH" in body, "the footer mark should be the project name"
    for slogan in ("proof", "coverage"):
        assert slogan not in body.lower(), (
            f"the footer mark says {slogan!r}; it should be the project name")


def test_every_intent_state_the_page_names_is_one_the_ledger_can_hold():
    """Chapter 06 draws the intent lifecycle. It may only draw states that exist."""
    schema = (ROOT / "pkg" / "kavach" / "ledger.py").read_text()
    match = re.search(r"status\s+TEXT NOT NULL,\s*--\s*([A-Z|]+)", schema)
    assert match, "status column comment with allowed states missing in ledger.py"
    allowed = set(match.group(1).split("|"))
    shown = set(re.findall(r"\{ s: '([A-Z_]+)',", SITE))
    assert shown, "the site no longer declares an INTENT_STATES block"
    assert shown <= allowed, (
        f"page shows intent states the ledger cannot hold: {shown - allowed}"
    )


def test_the_chain_caveat_on_the_page_is_the_caveat_the_api_ships():
    """proof.claims() ships its limits with every response so the UI cannot overstate the
    chain by omission. The landing page is a UI, and quoting the claim without the caveat
    is exactly the omission that guard exists to prevent."""
    src = (ROOT / "pkg" / "kavach" / "proof.py").read_text()
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "claims")
    ret = next(n for n in ast.walk(fn) if isinstance(n, ast.Return))
    claims = ast.literal_eval(ret.value)
    # the .ts wraps long strings across lines with `+`, so compare on collapsed whitespace
    flat = re.sub(r"\s+", " ", SITE.replace('"\n    + "', "").replace('" + "', ""))
    for key in ("proves", "does_not_prove", "limit"):
        want = re.sub(r"\s+", " ", claims[key])
        assert want in flat, f"proof.claims()[{key!r}] is not what the page quotes"


def test_every_chapter_the_jump_list_offers_is_a_place_on_the_page():
    """A navigation entry pointing at nothing is a scroll to the top that looks like a bug."""
    chapters = (WEB / "lib" / "chapters.ts").read_text()
    ids = re.findall(r"\{ id: '([\w-]+)',", chapters)
    assert len(ids) >= 8, "the chapter list has collapsed"
    markup = PAGE + (WEB / "app" / "page.tsx").read_text()
    for i in ids:
        assert f'id="{i}"' in markup, f"chapter '{i}' is in the jump list but not on the page"


def test_the_chapter_count_the_header_prints_is_the_length_of_the_list():
    chapters = (WEB / "lib" / "chapters.ts").read_text()
    ns = re.findall(r"n: '(\d+)'", chapters)
    assert ns == [f"{i:02d}" for i in range(1, len(ns) + 1)], (
        f"chapter numbers are not 01..{len(ns):02d}: {ns}")


def test_no_kinetic_heading_leaks_its_accent_marker():
    """`*asterisks*` mark the accent run in a <Kinetic> heading and are stripped on
    render. An odd count means one marker has no partner, and it prints."""
    for text in re.findall(r'<Kinetic text="([^"]*)"', PAGE):
        assert text.count("*") % 2 == 0, f"unbalanced accent marker in {text!r}"


def test_the_console_matches_its_own_hrefs_against_the_pathname_it_is_given():
    """`trailingSlash: true` makes usePathname() return '/dashboard/proof/', while the
    sidebar's hrefs are canonical and slashless. Without a normalisation step nothing
    matches: no active nav item, and the breadcrumb reads "Console" on every route."""
    config = (WEB / "next.config.ts").read_text()
    layout = (WEB / "app" / "dashboard" / "layout.tsx").read_text()
    if "trailingSlash: true" not in config:
        return                                   # the mismatch cannot arise
    assert "endsWith('/')" in layout, (
        "next.config sets trailingSlash but the console compares usePathname() to "
        "slashless hrefs without trimming it")


def test_no_surface_is_left_without_a_name_of_its_own():
    """The root layout must not declare a title, and everything under it must.

    Next renders root metadata into the prerendered <head>, and hydration reconciles that
    element back to its built value -- measured a few milliseconds after the console's own
    assignment, on every fresh load. So a title there does not merely duplicate the
    console's; it silently wins, and eighteen client-rendered routes go back to sharing one
    tab name on reload and on any pasted link. The console cannot answer with `metadata`
    because that is a server-component API and every route under the shell is a client
    component.

    The failure is invisible in development -- navigating inside the console looks right,
    because nothing re-renders the head -- which is exactly why it is asserted here.
    """
    app = WEB / "app"

    def declares_title(path: Path) -> bool:
        """Is there a `title:` inside this module's exported metadata object?

        Scoped to the declaration so that prose mentioning a title -- of which the root
        layout now has several, explaining why it has none -- cannot answer for it."""
        m = re.search(r"export const metadata[^=]*=\s*\{(.*?)\n?\};", path.read_text(), re.S)
        return bool(m and re.search(r"\btitle\s*:", m.group(1)))

    assert not declares_title(app / "layout.tsx"), (
        "app/layout.tsx declares a title again. It overrides the console's per-route "
        "titles on every fresh load. Name each surface instead: the landing page and the "
        "404 through their own `metadata`, the console from its shell."
    )

    # ...and with the root silent, every surface that can name itself must.
    for page in ((app / "page.tsx"), (app / "not-found.tsx")):
        assert declares_title(page), (
            f"{page.relative_to(WEB)} has no title of its own, and the root layout no "
            "longer supplies one, so the tab falls back to the bare URL"
        )

    shell = (app / "dashboard" / "layout.tsx").read_text()
    assert "document.title" in shell, (
        "the console shell no longer sets document.title, so every console route shows "
        "whatever the root layout left behind"
    )
