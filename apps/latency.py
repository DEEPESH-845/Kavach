#!/usr/bin/env python3
"""Entrypoint: measure the decision paths' latency and single-core throughput.

    python apps/latency.py [--n 300]

Capacity claims in the README are made by this script and nothing else. It calls the same
`services` entrypoints the HTTP API and the MCP server call -- no stubbed model, no mocked
truth plane -- so the numbers are the real ones for this machine and this build.

Two paths are timed:

  outbound   truth -> exposure -> duplicate-risk estimator -> governor
             (an obligation is deliberately left in flight, so the estimator actually runs;
             timing the trivial path where there is nothing to score would flatter it)
  inbound    Ed25519 verification -> caps -> scope -> entailment -> fusion -> admission

Both run entirely local: the calibrated estimators are loaded from data/, so what is
measured is Kavach's own cost. The optional LLM planes add their provider's round trip on
top and sit behind circuit breakers (documents/05-architecture.md).

Exits non-zero if either path regresses past a deliberately loose ceiling -- this is a
regression tripwire, not a benchmark of the host.
"""

from __future__ import annotations

import argparse
import statistics
import time

from kavach import governor, ledger
from kavach.services import decisions
from kavach.services import gate as gate_service
from kavach.services import scenarios as lab

#: Loose enough that a slow CI runner passes, tight enough that a 10x regression -- an
#: accidental full-table scan, a model reloaded per call -- fails the build.
CEILING_MS = 25.0


def _percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * p))]


def _report(name: str, samples: list[float]) -> float:
    p50 = statistics.median(samples)
    print(f"  {name:<9} n={len(samples):<5} p50={p50:6.2f} ms   "
          f"p95={_percentile(samples, 0.95):6.2f} ms   p99={_percentile(samples, 0.99):6.2f} ms"
          f"   {1000 / p50:>6.0f} /s/core")
    return _percentile(samples, 0.95)


def outbound(n: int, model) -> list[float]:
    """A refund intent against a payment that already has one refund in flight."""
    conn = lab._sandbox()
    lab._payment(conn, "pay_LAT001", 500_000, lab.T - 7_200)
    seed = governor.new_intent("agent_cx_tier1", "sess_seed", "pay_LAT001", 84_900,
                               "Order never arrived, courier marked it delivered in error",
                               lab.T - 2_100)
    decisions.record(conn, seed, governor.Decision(governor.Action.ALLOW,
                                                   reasons=["seeded prior intent"]),
                     now=lab.T - 2_100)
    ledger.settle(conn, seed.intent_id, decisions.EXECUTED, result_id="rfnd_LAT001A")
    lab._refund(conn, "rfnd_LAT001A", "pay_LAT001", 84_900, lab.T - 2_040)

    samples = []
    for i in range(n):
        intent = governor.new_intent(
            "agent_cx_tier2", f"sess_{i}", "pay_LAT001", 84_900,
            "Customer says the package was never delivered, issuing a refund", lab.T)
        started = time.perf_counter()
        decisions.evaluate(conn, intent, now=lab.T, policy=lab._policy(), model=model)
        samples.append((time.perf_counter() - started) * 1000)
    conn.close()
    return samples


def inbound(n: int, model) -> list[float]:
    """A signed mandate presented with a cart, admitted end to end."""
    samples = []
    for i in range(n):
        conn = lab._sandbox()
        body = lab._mandate_body(nonce=f"nonce_lat_{i}")
        started = time.perf_counter()
        gate_service.admit(conn, envelope_body=body, cart_id=f"cart_lat_{i}",
                           merchant_id=lab._MERCHANT, lines=lab._GROCERY_CART, now=lab.T,
                           expected_principal=body["principal_id"], model=model)
        samples.append((time.perf_counter() - started) * 1000)
        conn.close()
    return samples


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure Kavach's decision-path latency")
    parser.add_argument("--n", type=int, default=300, help="samples per path")
    args = parser.parse_args()

    risk, entailment = lab.models()
    if risk is None or entailment is None:
        raise SystemExit("estimators are not trained here; run `make bench` and "
                         "`make gate-bench` first -- timing a path with the model absent "
                         "would measure a defence that is not running")

    print("\n  decision-path latency -- real code, local estimators, no network\n")
    worst = max(_report("outbound", outbound(args.n, risk)),
                _report("inbound", inbound(args.n, entailment)))
    print()
    if worst > CEILING_MS:
        raise SystemExit(f"p95 of {worst:.2f} ms exceeds the {CEILING_MS:.0f} ms ceiling")


if __name__ == "__main__":
    main()
