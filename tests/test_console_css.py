"""The console stylesheet's structural rules, checked without a browser.

Three properties, each of which was a real bug before it was a test.

SCOPING. kavach.css is imported by the root layout, so it is global on every route
including the console. Both files defined `.btn`, `.chain`, `.code`, `.ladder`, `.link` and
`.mono`. The landing page's `.btn::before` fills a button with bone on hover and turns its
label black via a `<span>` the console does not use -- so console buttons rendered bone text
on a bone fill, 1:1 contrast, invisible. Scoping every console rule under `.console` makes
that class of collision impossible rather than fixing it one selector at a time.

TOKENS. A hardcoded `rgba(255,255,255,.04)` hover is invisible on a white surface. Colours
live in the token blocks or they are a light-mode bug waiting to happen.

PARITY. A token defined for dark and forgotten for light inherits the dark value on a light
ground, which is the same failure in slower motion.
"""

from __future__ import annotations

import re
from pathlib import Path

_CSS_PATH = Path(__file__).resolve().parents[1] / "web" / "app" / "dashboard" / "console.css"
CSS = _CSS_PATH.read_text()

#: `#abc`, `#aabbcc`, `rgb(...)`, `rgba(...)`, `hsl(...)`
LITERAL = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(")


def _block(header: str) -> str:
    """The body of the first rule whose header matches, by brace matching."""
    start = CSS.index(header)
    open_brace = CSS.index("{", start)
    depth, i = 1, open_brace + 1
    while depth:
        if CSS[i] == "{":
            depth += 1
        elif CSS[i] == "}":
            depth -= 1
        i += 1
    return CSS[open_brace + 1:i - 1]


DARK = _block(".console {")
LIGHT = _block("@media (prefers-color-scheme: light)")


def _tokens(block: str) -> set[str]:
    return set(re.findall(r"(--[a-z0-9-]+)\s*:", block))


def test_every_console_rule_is_scoped():
    """No top-level selector may escape `.console`, or it collides with the landing page."""
    offenders = []
    for raw in CSS.splitlines():
        line = raw.strip()
        if not line.startswith((".", "#", "[")) or "," not in line and "{" not in line:
            continue
        selector = line.split("{")[0].strip().rstrip(",")
        if not selector or selector.startswith((".console", "body:has")):
            continue
        offenders.append(selector)
    assert not offenders, (
        "these selectors are not scoped under .console and will collide with "
        f"kavach.css: {offenders[:6]}")


def test_no_colour_is_hardcoded_outside_the_token_blocks():
    rest = CSS.replace(DARK, "").replace(LIGHT, "")
    # strip comments; prose may mention a hex value while explaining why it changed
    rest = re.sub(r"/\*.*?\*/", "", rest, flags=re.S)
    found = LITERAL.findall(rest)
    assert not found, (
        f"{len(found)} hardcoded colour(s) outside the token blocks: {found[:6]}. "
        "A literal colour cannot invert for light mode.")


def test_every_dark_token_has_a_light_value():
    dark, light = _tokens(DARK), _tokens(LIGHT)
    # non-colour tokens (fonts, timings, sizes) are scheme-independent by design
    colourish = {t for t in dark if re.search(
        r"void|iron|slab|raise|seam|bone|fog|steel|amber|oxide|jade|wash|hover|scrim|drop", t)}
    missing = sorted(colourish - light)
    assert not missing, (
        f"defined for dark but not for light: {missing}. Each would keep its dark value "
        "on a light ground.")


def test_the_light_block_introduces_no_token_the_dark_block_lacks():
    """A light-only token has no dark value to fall back on."""
    extra = sorted(_tokens(LIGHT) - _tokens(DARK))
    assert not extra, f"defined only for light: {extra}"


def test_the_landing_page_overlay_is_neutralised_in_the_console():
    assert re.search(r"\.console \.btn::before[^{]*\{[^}]*content:\s*none", CSS), (
        "kavach.css's global .btn::before hover fill must be switched off inside the "
        "console, or it paints bone text onto a bone fill")
