"""Policy from a file. One TOML, validated once, re-read when it changes.

    KAVACH_POLICY=/etc/kavach/kavach.toml

Caps, thresholds, the Gate's economics, per-agent tiers and the server's own limits live
here so a merchant can run this without a code change. What does NOT live here is any way
to edit it from the product: a limit an operator can raise from the screen it is failing
on is not a limit. Changing the file is the audit trail -- a commit, a deploy, a diff.

Every key is checked for name and type and an error names the field, because a typo that
silently does nothing is the most expensive kind of configuration. Unknown keys are errors
for the same reason.

Defaults are the compiled-in ones from governor.Policy and admission.Costs, so a deployment
with no file behaves exactly as before. KAVACH_KILL_SWITCH=1 in the environment always wins
over the file: the switch exists so an operator can halt everything without touching a
config that may be under review.
"""

from __future__ import annotations

import logging
import os
import tomllib
from dataclasses import dataclass, replace
from typing import Any

from . import governor
from .gate import admission

log = logging.getLogger(__name__)

TIERS = ("readonly", "agent")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    source: str | None
    limits: governor.Policy
    costs: admission.Costs
    agents: dict[str, str]
    rate_limit_per_minute: int
    cors_origins: tuple[str, ...]
    #: from [limits].risk_threshold; None means "use the model's frozen threshold"
    risk_threshold_override: float | None

    def policy_for(self, agent_id: str | None, *,
                   model_threshold: float | None) -> governor.Policy:
        """The policy one decision runs under: the file's limits, the agent's tier, and the
        threshold in order of authority -- file override, then the trained model, then the
        compiled default."""
        threshold = (self.risk_threshold_override if self.risk_threshold_override is not None
                     else model_threshold if model_threshold is not None
                     else governor.Policy.risk_threshold)
        tier = self.agents.get(agent_id or "", "agent")
        return replace(self.limits, risk_threshold=threshold,
                       allow_write=self.limits.allow_write and tier != "readonly")


# ------------------------------------------------------------------ validation

def _int(section: str, key: str, value: Any, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ConfigError(f"{section}.{key} must be an integer >= {minimum}, got {value!r}")
    return value


def _rate(section: str, key: str, value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= 1:
        raise ConfigError(f"{section}.{key} must be a number between 0 and 1, got {value!r}")
    return float(value)


def _bool(section: str, key: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ConfigError(f"{section}.{key} must be true or false, got {value!r}")
    return value


def _only(section: str, table: Any, allowed: set[str]) -> dict[str, Any]:
    if not isinstance(table, dict):
        raise ConfigError(f"{section} must be a table")
    unknown = set(table) - allowed
    if unknown:
        raise ConfigError(f"{section}.{sorted(unknown)[0]} is not a setting; known: "
                          f"{', '.join(sorted(allowed))}")
    return table


def _parse(doc: dict[str, Any], source: str | None) -> Settings:
    _only("(top level)", doc, {"limits", "gate", "agents", "server"})
    lim = _only("limits", doc.get("limits", {}),
                {"max_auto_refund_minor", "session_cap_minor", "daily_cap_minor",
                 "risk_threshold", "kill_switch"})
    base = governor.Policy()
    threshold = None
    if "risk_threshold" in lim:
        threshold = _rate("limits", "risk_threshold", lim["risk_threshold"])
    kill = _bool("limits", "kill_switch", lim["kill_switch"]) if "kill_switch" in lim else False
    limits = governor.Policy(
        max_auto_refund_minor=_int("limits", "max_auto_refund_minor",
                                   lim.get("max_auto_refund_minor", base.max_auto_refund_minor),
                                   minimum=1),
        session_cap_minor=_int("limits", "session_cap_minor",
                               lim.get("session_cap_minor", base.session_cap_minor), minimum=1),
        daily_cap_minor=_int("limits", "daily_cap_minor",
                             lim.get("daily_cap_minor", base.daily_cap_minor), minimum=1),
        risk_threshold=threshold if threshold is not None else base.risk_threshold,
        # the environment switch is OR'd in by Policy's default factory
        kill_switch=kill or governor.Policy().kill_switch,
    )

    g = _only("gate", doc.get("gate", {}),
              {"fraud_loss_share", "margin_share", "step_up_minor", "hold_minor",
               "step_up_catch_rate", "hold_catch_rate"})
    c = admission.DEFAULT_COSTS
    costs = admission.Costs(
        fraud_loss_share=_rate("gate", "fraud_loss_share",
                               g.get("fraud_loss_share", c.fraud_loss_share)),
        margin_share=_rate("gate", "margin_share", g.get("margin_share", c.margin_share)),
        step_up_minor=_int("gate", "step_up_minor", g.get("step_up_minor", c.step_up_minor)),
        hold_minor=_int("gate", "hold_minor", g.get("hold_minor", c.hold_minor)),
        step_up_catch_rate=_rate("gate", "step_up_catch_rate",
                                 g.get("step_up_catch_rate", c.step_up_catch_rate)),
        hold_catch_rate=_rate("gate", "hold_catch_rate",
                              g.get("hold_catch_rate", c.hold_catch_rate)),
    )

    agents_tbl = doc.get("agents", {})
    if not isinstance(agents_tbl, dict):
        raise ConfigError("agents must be a table of agent_id = tier")
    agents: dict[str, str] = {}
    for agent_id, tier in agents_tbl.items():
        if tier not in TIERS:
            raise ConfigError(f"agents.{agent_id} must be one of {', '.join(TIERS)}, "
                              f"got {tier!r}")
        agents[str(agent_id)] = tier

    srv = _only("server", doc.get("server", {}), {"rate_limit_per_minute", "cors_origins"})
    origins = srv.get("cors_origins", [])
    if not isinstance(origins, list) or not all(isinstance(o, str) for o in origins):
        raise ConfigError("server.cors_origins must be a list of strings")

    return Settings(
        source=source, limits=limits, costs=costs, agents=agents,
        rate_limit_per_minute=_int("server", "rate_limit_per_minute",
                                   srv.get("rate_limit_per_minute", 60), minimum=1),
        cors_origins=tuple(o.strip().rstrip("/") for o in origins if o.strip()),
        risk_threshold_override=threshold,
    )


def load(path: str | None) -> Settings:
    """Read and validate one file, or the defaults when `path` is None."""
    if not path:
        return _parse({}, None)
    try:
        with open(path, "rb") as f:
            doc = tomllib.load(f)
    except FileNotFoundError:
        raise ConfigError(f"KAVACH_POLICY points at {path}, which does not exist") from None
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{path} is not valid TOML: {e}") from None
    return _parse(doc, path)


# ------------------------------------------------------------------ the live copy

_cache: tuple[str | None, float, Settings] | None = None


def reset() -> None:
    global _cache
    _cache = None


def current() -> Settings:
    """The settings in force right now. Re-reads the file when its mtime changes; one
    stat() per call otherwise.

    A file that becomes invalid while the process runs keeps the last good settings and
    logs the error: a bad edit must not silently widen a limit, and must not take a
    payments API down either. At startup, with nothing good to fall back on, it raises."""
    global _cache
    path = os.environ.get("KAVACH_POLICY", "").strip() or None
    mtime = os.stat(path).st_mtime if path and os.path.exists(path) else 0.0
    if _cache and _cache[0] == path and _cache[1] == mtime:
        return _cache[2]
    try:
        settings = load(path)
    except ConfigError:
        if _cache and _cache[0] == path:
            log.exception("KAVACH_POLICY is invalid; keeping the last good settings")
            _cache = (path, mtime, _cache[2])
            return _cache[2]
        raise
    _cache = (path, mtime, settings)
    return settings
