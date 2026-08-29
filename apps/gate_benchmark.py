#!/usr/bin/env python3
"""Entrypoint: generate the cart corpus, train entailment, benchmark it against the rules.

    python cmd/gate_benchmark.py

Writes data/entailment_model.pkl and evals/gate_report.json. Exits non-zero unless the
model stays inside the step-up budget and beats every feasible baseline -- including G3,
the best rule a competent engineer would write without one. Method: documents/07-evals.md.
"""

from kavach.intelligence.evaluate_gate import main

if __name__ == "__main__":
    main()
