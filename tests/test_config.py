"""Policy from a file: validated, named on error, re-read when it changes."""

from __future__ import annotations

import os

import pytest
from kavach import config

FULL = """
[limits]
max_auto_refund_minor = 250000
session_cap_minor = 900000
daily_cap_minor = 5000000
risk_threshold = 0.42

[gate]
fraud_loss_share = 0.8
margin_share = 0.2
step_up_minor = 5000
hold_minor = 20000
step_up_catch_rate = 0.6
hold_catch_rate = 0.9

[agents]
"reporting-bot" = "readonly"

[server]
rate_limit_per_minute = 120
cors_origins = ["https://ui.example.com/"]
"""


def test_defaults_without_a_file(monkeypatch):
    monkeypatch.delenv("KAVACH_KILL_SWITCH", raising=False)
    s = config.load(None)
    assert s.source is None
    assert s.limits.max_auto_refund_minor == 1_000_00 and s.costs.step_up_minor == 4_000
    assert s.agents == {} and s.rate_limit_per_minute == 60 and s.cors_origins == ()
    assert s.policy_for("anyone", model_threshold=0.7).risk_threshold == 0.7
    assert s.policy_for("anyone", model_threshold=None).risk_threshold == 0.5


def test_full_file_round_trips(tmp_path, monkeypatch):
    monkeypatch.delenv("KAVACH_KILL_SWITCH", raising=False)
    f = tmp_path / "kavach.toml"
    f.write_text(FULL)
    s = config.load(str(f))
    assert s.source == str(f)
    assert s.limits.max_auto_refund_minor == 250_000 and s.limits.daily_cap_minor == 5_000_000
    assert s.costs.fraud_loss_share == 0.8 and s.costs.hold_catch_rate == 0.9
    assert s.agents == {"reporting-bot": "readonly"}
    assert s.rate_limit_per_minute == 120 and s.cors_origins == ("https://ui.example.com",)
    # a file threshold beats the model's
    assert s.policy_for("x", model_threshold=0.7).risk_threshold == 0.42
    p = s.policy_for("reporting-bot", model_threshold=None)
    assert p.allow_write is False and p.session_cap_minor == 900_000
    assert s.policy_for("other", model_threshold=None).allow_write is True


@pytest.mark.parametrize("body, field", [
    ("[limits]\nmax_auto_refund_minor = -1\n", "limits.max_auto_refund_minor"),
    ("[limits]\nmax_auto_refund_minor = 1.5\n", "limits.max_auto_refund_minor"),
    ("[limits]\nrisk_threshold = 7\n", "limits.risk_threshold"),
    ("[gate]\nstep_up_catch_rate = 'high'\n", "gate.step_up_catch_rate"),
    ("[agents]\nbot = 'god'\n", "agents.bot"),
    ("[server]\nrate_limit_per_minute = 0\n", "server.rate_limit_per_minute"),
    ("[limits]\nmax_auto_refund = 5\n", "limits.max_auto_refund"),
    ("[limit]\nx = 1\n", "limit"),
])
def test_errors_name_the_field(tmp_path, body, field):
    f = tmp_path / "bad.toml"
    f.write_text(body)
    with pytest.raises(config.ConfigError) as e:
        config.load(str(f))
    assert field in str(e.value)


def test_malformed_toml_is_a_config_error(tmp_path):
    f = tmp_path / "bad.toml"
    f.write_text("[limits\n")
    with pytest.raises(config.ConfigError):
        config.load(str(f))
    with pytest.raises(config.ConfigError):
        config.load(str(tmp_path / "missing.toml"))


def test_env_kill_switch_wins(tmp_path, monkeypatch):
    f = tmp_path / "k.toml"
    f.write_text("[limits]\nkill_switch = false\n")
    monkeypatch.setenv("KAVACH_KILL_SWITCH", "1")
    s = config.load(str(f))
    assert s.limits.kill_switch is False                       # the file's value
    assert s.policy_for("a", model_threshold=None).kill_switch is True   # env wins, live
    monkeypatch.delenv("KAVACH_KILL_SWITCH")
    assert s.policy_for("a", model_threshold=None).kill_switch is False  # no reload needed
    f.write_text("[limits]\nkill_switch = true\n")
    assert config.load(str(f)).policy_for("a", model_threshold=None).kill_switch is True


def test_current_reloads_when_the_file_changes(tmp_path, monkeypatch):
    monkeypatch.delenv("KAVACH_KILL_SWITCH", raising=False)
    f = tmp_path / "k.toml"
    f.write_text("[limits]\nmax_auto_refund_minor = 100\n")
    monkeypatch.setenv("KAVACH_POLICY", str(f))
    config.reset()
    assert config.current().limits.max_auto_refund_minor == 100
    f.write_text("[limits]\nmax_auto_refund_minor = 200\n")
    st = os.stat(f)
    os.utime(f, (st.st_atime + 5, st.st_mtime + 5))
    assert config.current().limits.max_auto_refund_minor == 200
    monkeypatch.delenv("KAVACH_POLICY")
    config.reset()
    assert config.current().source is None


def test_current_keeps_the_last_good_settings_when_the_file_goes_bad(tmp_path, monkeypatch):
    monkeypatch.delenv("KAVACH_KILL_SWITCH", raising=False)
    f = tmp_path / "k.toml"
    f.write_text("[limits]\nmax_auto_refund_minor = 100\n")
    monkeypatch.setenv("KAVACH_POLICY", str(f))
    config.reset()
    assert config.current().limits.max_auto_refund_minor == 100
    f.write_text("[limits]\nmax_auto_refund_minor = -5\n")
    st = os.stat(f)
    os.utime(f, (st.st_atime + 5, st.st_mtime + 5))
    assert config.current().limits.max_auto_refund_minor == 100
    config.reset()
    with pytest.raises(config.ConfigError):
        config.current()
    config.reset()
