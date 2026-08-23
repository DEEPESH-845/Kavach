"""Synthetic corpus of agent refund intents, labelled duplicate / not-duplicate.

Design constraints that decide whether the evaluation means anything:

  1. Duplicates are PARAPHRASES, never string copies. If a duplicate reused the same reason
     text, exact string equality would score ~1.0 and no model would be justified.
  2. Hard negatives share the payment, the time window and much of the vocabulary, and
     differ only in which obligation they refer to. "refund the shipping fee" and "refund
     the duplicate charge" on the same payment are not the same obligation. Without these
     the task collapses to "is there anything open?" and any rule wins.
  3. Split is TEMPORAL, not random. Intents for one payment are correlated; a random split
     puts the paraphrase of an intent in train and its twin in test, which leaks the label.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

# Each obligation is a distinct thing the merchant owes. Paraphrases within a set mean the
# same thing; across sets they do not, however similar the words look.
OBLIGATIONS: dict[str, dict] = {
    "duplicate_charge": {
        "share": (1.0, 1.0),
        "texts": ["customer was charged twice for this order",
                  "duplicate debit reported by the buyer",
                  "double charge on the same order, please reverse one",
                  "amount got deducted 2 times from customer account",
                  "buyer says he paid twice, refund the extra one",
                  "two debits for a single order - refund duplicate"],
    },
    "item_damaged": {
        "share": (0.6, 1.0),
        "texts": ["item arrived damaged", "product was broken on delivery",
                  "customer received a cracked unit", "damaged goods, refund the customer",
                  "packaging crushed, item unusable", "received defective product"],
    },
    "shipping_fee": {
        "share": (0.02, 0.08),
        "texts": ["refund the shipping charge only", "waive the delivery fee for this order",
                  "courier charges to be returned to customer",
                  "refund delivery charges, keep the item amount",
                  "customer charged shipping on a free-shipping order"],
    },
    "not_delivered": {
        "share": (1.0, 1.0),
        "texts": ["order never arrived", "package not delivered to the customer",
                  "customer did not receive the shipment", "undelivered order, full refund",
                  "courier marked delivered but customer denies receipt"],
    },
    "size_return": {
        "share": (0.4, 0.9),
        "texts": ["wrong size, customer returned it", "size mismatch return",
                  "customer returned the item for size issue",
                  "returned - size too small", "exchange declined, refunding for size"],
    },
    "price_match": {
        "share": (0.05, 0.2),
        "texts": ["price dropped after purchase, refund the difference",
                  "price match adjustment for this order",
                  "refund the difference after the discount was applied late",
                  "customer found a lower price, adjusting"],
    },
    "late_delivery": {
        "share": (0.05, 0.15),
        "texts": ["delivered late, goodwill refund", "compensation for delayed delivery",
                  "late shipment goodwill gesture", "sla breach on delivery, partial refund"],
    },
}

_AGENTS = ["support_agent", "ops_agent", "whatsapp_bot", "dashboard_claude"]

# How often an agent re-decides an obligation it has already acted on. There is no public
# figure for this, so it is a stated assumption, not a measurement: 12% is deliberately
# conservative -- lower than the rate a naive retry loop would produce and high enough to
# evaluate against. Sensitivity to it is reported in evals/risk_report.json.
DUPLICATE_RATE = 0.12


def generate(n_payments: int = 2600, seed: int = 7, start: int = 1_700_000_000) -> list[dict]:
    rng = random.Random(seed)
    rows: list[dict] = []
    t = start

    for p in range(n_payments):
        payment_id = f"pay_{p:05d}"
        payment_amount = rng.choice([49900, 129900, 249900, 500000, 1250000, 89900])
        t += rng.randint(600, 7200)

        kinds = rng.sample(list(OBLIGATIONS), k=rng.choice([1, 1, 2, 2, 3]))
        history: list[dict] = []

        for kind in kinds:
            spec = OBLIGATIONS[kind]
            lo, hi = spec["share"]
            amount = max(100, int(payment_amount * rng.uniform(lo, hi)) // 100 * 100)
            if rng.random() < 0.20 and history:   # collide with an existing amount
                amount = rng.choice(history)["amount"]
            t0 = t + rng.randint(60, 3600)
            first = {"kind": kind, "amount": amount, "reason": rng.choice(spec["texts"]),
                     "t": t0, "session_id": f"s_{p}_{kind}", "agent_id": rng.choice(_AGENTS),
                     "status": "EXECUTED",
                     # the webhook-lag window: the result of this intent is not yet visible
                     "result_known": rng.random() > 0.45}
            rows.append(_row(payment_id, payment_amount, first, history, label=0, rng=rng))
            history = history + [first]

            # THE duplicate: same obligation, new session, paraphrased.
            # Crucially the AMOUNT IS NOT A RELIABLE TELL. An agent re-deciding an obligation
            # often picks a different slice of it -- it refunds the remainder, or re-refunds
            # the whole thing after a partial. Making every duplicate amount-identical would
            # let `amount_delta == 0` solve the task and no model would be justified.
            if rng.random() < DUPLICATE_RATE:
                twin_texts = [x for x in spec["texts"] if x != first["reason"]]
                roll = rng.random()
                if roll < 0.55:
                    dup_amount = amount + rng.choice([0, 0, rng.randint(-200, 200)])
                elif roll < 0.80:
                    dup_amount = int(payment_amount * rng.uniform(lo, hi))  # re-decided slice
                else:
                    dup_amount = max(100, amount - int(amount * rng.uniform(0.2, 0.6)))
                dup = {"kind": kind,
                       "amount": max(100, dup_amount // 100 * 100),
                       "reason": rng.choice(twin_texts),
                       "t": first["t"] + rng.randint(300, 40000),
                       "session_id": f"s_{p}_{kind}_retry",
                       "agent_id": rng.choice(_AGENTS), "status": "PROPOSED",
                       "result_known": False}
                rows.append(_row(payment_id, payment_amount, dup, history, label=1, rng=rng))

            # Hard negative that breaks amount-matching outright: an order with two identical
            # units. Refunding the second one is a DIFFERENT obligation for the IDENTICAL
            # amount. Only the reason text carries the distinction.
            if kind in {"item_damaged", "size_return", "not_delivered"} and rng.random() < 0.30:
                marker = rng.choice(["- second unit in the same order",
                                     "- this is for the other item in the order",
                                     "for the 2nd piece, first one already handled",
                                     "second identical unit, separate refund"])
                extra = {"kind": kind + "_unit2", "amount": amount,
                         "reason": rng.choice(spec["texts"]) + " " + marker,
                         "t": first["t"] + rng.randint(600, 30000),
                         "session_id": f"s_{p}_{kind}_2", "agent_id": rng.choice(_AGENTS),
                         "status": "PROPOSED", "result_known": False}
                rows.append(_row(payment_id, payment_amount, extra, history, label=0, rng=rng))

    rows.sort(key=lambda r: r["t"])
    return rows


def _row(payment_id: str, payment_amount: int, cur: dict, history: list[dict],
         label: int, rng: random.Random) -> dict:
    prior = [{"amount": h["amount"], "reason": h["reason"], "t": h["t"],
              "session_id": h["session_id"], "agent_id": h["agent_id"],
              "status": h["status"], "result_known": h["result_known"]} for h in history]
    open_amount = sum(h["amount"] for h in history if not h["result_known"])
    return {
        "payment_id": payment_id, "payment_amount": payment_amount,
        "t": cur["t"], "amount": cur["amount"], "reason": cur["reason"],
        "session_id": cur["session_id"], "agent_id": cur["agent_id"],
        "prior": prior, "open_amount": open_amount,
        "open_count": sum(1 for h in history if not h["result_known"]),
        "label": label, "_kind": cur["kind"],
    }


def temporal_split(rows: list[dict], frac: float = 0.7) -> tuple[list[dict], list[dict]]:
    """Split by time. Also drop any test payment that appears in train, so a paraphrase
    pair cannot straddle the boundary."""
    cut = int(len(rows) * frac)
    train, test = rows[:cut], rows[cut:]
    seen = {r["payment_id"] for r in train}
    test = [r for r in test if r["payment_id"] not in seen]
    return train, test


def main() -> None:
    rows = generate()
    out = Path("data/intents.jsonl")
    out.parent.mkdir(exist_ok=True)
    with out.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    tr, te = temporal_split(rows)
    pos = sum(r["label"] for r in rows)
    print(f"{len(rows)} rows -> {out}  positives={pos} ({pos/len(rows):.1%})")
    print(f"train={len(tr)} (pos {sum(r['label'] for r in tr)})  "
          f"test={len(te)} (pos {sum(r['label'] for r in te)})  disjoint payments")


if __name__ == "__main__":
    main()
