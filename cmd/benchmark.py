#!/usr/bin/env python3
"""Entrypoint: regenerate the corpus, train the duplicate-risk model, benchmark it.

    python cmd/benchmark.py

Writes data/risk_model.pkl and evals/risk_report.json. Asserts that the model beats every
feasible baseline at equal escalation cost -- if it does not, this exits non-zero and the
model has no business shipping. Method: documents/07-evals.md.
"""

from kavach.intelligence.evaluate import main

if __name__ == "__main__":
    main()
