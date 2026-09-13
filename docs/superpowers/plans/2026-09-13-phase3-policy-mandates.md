# Phase 3 — Policy as config, real mandate issuance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Caps, thresholds, Gate economics, per-agent tiers and server limits come from one validated TOML file that is re-read when it changes; principals register Ed25519 keys and submit envelopes they signed, and the server-signing demo path only exists under `KAVACH_DEMO=1`.

**Architecture:** `kavach/config.py` loads `KAVACH_POLICY` (stdlib `tomllib`) into a frozen `Settings` (governor `Policy`, admission `Costs`, agent tiers, server limits) with field-naming errors, cached by mtime. The API, MCP server and seed all build their `Policy` through it. `services/gate.py` gains a signed path (`raw, signature, key_id`) beside the demo path; `register_demo_issuer` becomes a no-op outside demo so a publicly-derivable key is never trusted in production. `/api/issuers` and `python -m kavach principal|issuers` complete the loop.

**Tech Stack:** stdlib `tomllib`, `cryptography` Ed25519 (already a dependency).

**Spec:** `docs/superpowers/specs/2026-09-13-production-readiness-design.md` §3, §4

## Global Constraints
- No new dependency. Money stays integer minor units. Every task: tests + ruff + commit.
- `KAVACH_KILL_SWITCH=1` in the environment always wins over the file.
- No write API for policy. Ever.

---

### Task 1: `kavach.config` — Settings from TOML, validated, mtime-cached

**Files:** Create `pkg/kavach/config.py`; Create `kavach.example.toml`; Test `tests/test_config.py`.

**Interfaces (produces):**
- `config.Settings` frozen dataclass: `source: str | None`, `limits: governor.Policy` (kill_switch OR'd with env), `costs: admission.Costs`, `agents: dict[str, str]` (agent_id → `"readonly" | "agent"`), `rate_limit_per_minute: int`, `cors_origins: tuple[str, ...]`, `risk_threshold_override: float | None`.
- `config.load(path: str | None) -> Settings` — path None ⇒ defaults; raises `config.ConfigError("limits.max_auto_refund_minor must be a positive integer")`.
- `config.current() -> Settings` — reads `KAVACH_POLICY`, re-loads when the file's mtime changes (one `os.stat` per call).
- `Settings.policy_for(agent_id: str | None, *, model_threshold: float | None) -> governor.Policy` — applies the agent tier and the threshold (override > model > default).

TOML shape (`kavach.example.toml`):
```toml
[limits]
max_auto_refund_minor = 100000      # ₹1,000.00 — above this a human approves
session_cap_minor     = 500000
daily_cap_minor       = 2500000
# risk_threshold = 0.5              # omit to use the trained model's frozen threshold
# kill_switch = false               # KAVACH_KILL_SWITCH=1 in the environment always wins

[gate]                              # merchant economics; every rate is a stated assumption
fraud_loss_share   = 1.0
margin_share       = 0.15
step_up_minor      = 4000
hold_minor         = 15000
step_up_catch_rate = 0.70
hold_catch_rate    = 0.95

[agents]                            # per-agent tier; anything not listed is "agent"
# "reporting-bot" = "readonly"

[server]
rate_limit_per_minute = 60
cors_origins = []
```

Tests: defaults when no file; a full file round-trips into `Policy`/`Costs`; a bad type names the field; unknown section/key is an error (typos must not silently do nothing); `policy_for("reporting-bot")` has `allow_write=False`; env kill switch wins; `current()` reloads after the file changes (write, bump mtime with `os.utime`).

---

### Task 2: Wire `config` into the API, MCP server, seed and scenarios

**Files:** Modify `apps/api_server.py` (`policy()` → `config.current().policy_for(...)`; `_bucket` and CORS from settings at startup; `/api/policy` reports `source`, `costs`, `agents`), `pkg/kavach/mcp/server.py` (`_policy` built per call via `config.current().policy_for(agent_id, model_threshold=...)`), `pkg/kavach/services/gate.py` (pass `costs=config.current().costs` to `admission.admit/decide`), `pkg/kavach/services/stepup.py` (same), `apps/api_server.py` evaluate uses `policy_for(body.agent_id)`.
Test: `tests/test_api_policy.py` — with `KAVACH_POLICY` pointing at a temp TOML: `/api/policy` shows the file's values and `source`; an agent listed as `readonly` gets `DENY` with the tier reason from `/api/governor/evaluate`; health still fine. Startup with an invalid file fails loudly (`config.current()` raising at import → test via `load`).

---

### Task 3: Issuers API + signed envelopes on admit/inspect/step-up; demo issuer only under demo

**Files:** Modify `pkg/kavach/gate/envelope.py` (`list_issuers`, `remove_issuer`), `pkg/kavach/services/gate.py` (`admit(..., signed=None)`, `inspect(..., signed=None)`, `register_demo_issuer` no-op outside demo, `sign_with(private_key, body)`), `pkg/kavach/services/stepup.py` (store `{"signed": {...}}` when the envelope was caller-signed; resolve re-runs with it), `apps/api_server.py` (`SignedEnvelope` model; `AdmitRequest.mandate | envelope` exactly-one validator; `/api/issuers` GET/POST/DELETE operator; refuse `mandate` form outside demo with 403 `demo_signing_disabled`), `web/lib/api.ts` types.
Test: `tests/test_api_mandates.py` (KAVACH_DEMO=0): register an issuer over HTTP; sign a mandate with the private half in the test; admit → verdict; a tampered byte → `BAD_SIGNATURE`; unknown key_id → `UNKNOWN_ISSUER`; the `mandate` form → 403; step-up with a signed envelope → token → approve re-runs admission and charges; `register_demo_issuer` does nothing outside demo (no `kavach-demo-principal` row).

---

### Task 4: CLI — `principal keygen|sign`, `issuers add|list|remove`

**Files:** Modify `pkg/kavach/__main__.py`; Test `tests/test_cli.py`.
`principal keygen` → `{key_id, public_key_b64, private_key_b64}` (key_id `prin_<hex>`); `principal sign --private-key <b64> [--key-id X] mandate.json` → `{raw_b64, signature_b64, key_id}` — exactly the `envelope` object `/api/gate/admit` takes. `issuers add --key-id X --public-key <b64>`, `issuers list`, `issuers remove X`. Test: keygen → issuers add → sign → `envelope.verify` in-process passes.

### Task 5: Docs + console
`documents/11-deploy.md`: "Policy file" section and "Real mandates" section (keygen → register → sign → admit, with curl). `README.md` config table row `KAVACH_POLICY`. Console: Governor page shows `source` and Gate economics from `/api/policy`; Settings "Why nothing is editable" card updated to name the file. `tsc` + build.
