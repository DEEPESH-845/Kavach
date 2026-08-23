"""Shared fixtures.

Every test passes `now` explicitly. Nothing in Kavach reads the clock during a derivation,
so the same events always produce the same fact -- which is what makes a payment decision
replayable months later during a dispute.
"""

from __future__ import annotations

import pytest
from kavach.eventlog import connect


@pytest.fixture
def conn():
    c = connect(":memory:")
    yield c
    c.close()
