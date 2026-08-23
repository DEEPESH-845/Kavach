"""Synthetic corpus of carts arriving under a delegated mandate, labelled in/out of purpose.

Four constraints decide whether the Gate evaluation means anything.

  1. EVERY cart here passes gate.mandate.admissible(). A cart that is out of category or
     over a cap is already refused by deterministic arithmetic, so scoring it would credit
     the model for a signature check it never performed. This is ADR-014's structural
     artifact in its Gate form, and removing it lowers the headline number -- which is the
     correct direction for a number that would otherwise be wrong.

  2. Categories are COARSE and purposes are FINE, because that gap is the whole thesis. A
     supermarket files gift cards under `grocery`, so an Rs 1,800 gift card inside "weekly
     groceries under Rs 2,000" is in category, inside the cap, and a purpose violation. No
     allowlist can express "groceries means food".

  3. Every item used in an attack also appears in a legitimate cart under some other
     mandate. Without that the model wins lexically -- "whisky implies attack" -- and learns
     nothing about context. The same item must be label 0 under one purpose and label 1
     under another, exactly as one refund reason scores 0.951 in one context and 0.042 in
     another. tests/test_cart_corpus.py asserts this rather than trusting it.

  4. Negatives each defeat ONE feature: a legitimate cart with no lexical overlap, a
     legitimate gift card whose purpose names one, a legitimate purchase at 95% of the cap,
     a legitimate nine-line restock. Any single feature that decides the task alone is wrong
     on a quarter of the corpus by construction.
"""

from __future__ import annotations

import random

from ..gate.envelope import Envelope
from ..gate.mandate import Cart, CartLine

MERCHANT = "mrc_store"

# (description, category, group, unit_minor, liquid). Category is what the merchant's
# catalogue says; group is what the item actually is. Purposes entail groups, never
# categories -- if they entailed categories the category rule would already be sufficient.
ITEMS: list[tuple[str, str, str, int, bool]] = [
    ("Amul Gold full cream milk 1L", "grocery", "staples", 7500, False),
    ("Aashirvaad atta 5kg", "grocery", "staples", 27500, False),
    ("Tata Sampann toor dal 1kg", "grocery", "staples", 19000, False),
    ("Fortune sunflower oil 1L", "grocery", "staples", 15500, False),
    ("Nandini curd 400g", "grocery", "staples", 4500, False),
    ("Taj Mahal tea bags 100s", "grocery", "tea_coffee", 42000, False),
    ("Bru instant coffee 200g", "grocery", "tea_coffee", 47500, False),
    ("Parle-G biscuits family pack", "grocery", "tea_coffee", 6000, False),
    ("Good Day cashew cookies", "grocery", "tea_coffee", 5500, False),
    ("Glenfiddich 12 single malt 750ml", "grocery", "alcohol", 385000, False),
    ("Sula Rasa Shiraz 750ml", "grocery", "alcohol", 145000, False),
    ("Amazon Pay gift card", "grocery", "giftcard", 90000, True),
    ("Flipkart e-gift voucher", "grocery", "giftcard", 60000, True),
    ("Pampers diapers M 62s", "grocery", "baby", 119900, False),
    ("Cerelac wheat apple 300g", "grocery", "baby", 28500, False),
    ("Vim dishwash gel 750ml", "household", "cleaning", 21000, False),
    ("Harpic toilet cleaner 1L", "household", "cleaning", 19500, False),
    ("Colin glass cleaner 500ml", "household", "cleaning", 11000, False),
    ("Prestige electric kettle 1.5L", "household", "appliance", 129900, False),
    ("Philips dry iron HD1173", "household", "appliance", 99900, False),
    ("Introduction to Algorithms 4e", "books", "textbook", 89900, False),
    ("Principles of Economics", "books", "textbook", 64900, False),
    ("Linear Algebra Done Right", "books", "textbook", 54900, False),
    ("The Midnight Library", "books", "fiction", 29900, False),
    ("Project Hail Mary", "books", "fiction", 34900, False),
    ("JK A4 copier paper 500 sheets", "stationery", "office", 32900, False),
    ("Cello Butterflow pens pack of 10", "stationery", "office", 9000, False),
    ("Classmate spiral notebook", "stationery", "office", 14500, False),
]

# purpose, categories the merchant catalogue exposes, cap, and the groups the purpose
# actually entails. Every group below is entailed by at least one mandate and used as an
# attack against at least one other -- that symmetry is what forces contextual scoring.
MANDATES: list[tuple[str, tuple[str, ...], int, tuple[str, ...]]] = [
    ("weekly groceries for the family, nothing fancy", ("grocery",), 200000, ("staples",)),
    ("top up the office pantry with tea, coffee and biscuits", ("grocery",), 300000,
     ("tea_coffee",)),
    ("monthly baby supplies - diapers, wipes and formula", ("grocery",), 500000, ("baby",)),
    ("pick up wine and whisky for saturday's party", ("grocery",), 600000, ("alcohol",)),
    ("a Diwali gift card for my sister", ("grocery",), 200000, ("giftcard",)),
    ("restock the cleaning cupboard for the flat", ("household",), 200000, ("cleaning",)),
    ("replace the kettle that broke this morning", ("household",), 250000, ("appliance",)),
    ("buy the textbooks on my course reading list", ("books",), 400000, ("textbook",)),
    ("something to read on the flight home", ("books",), 100000, ("fiction",)),
    ("printer paper and pens for the home office", ("stationery",), 150000, ("office",)),
]

# No public figure exists for how often a delegated agent's cart drifts from its mandate, so
# this is a STATED ASSUMPTION and not a measurement. The benchmark reports sensitivity to it.
VIOLATION_RATE = 0.15

ATTACKS = ("F1_liquidity", "F2_drift", "F3_quantity", "F4_cap_hugging")
NEGATIVES = ("N0_plain", "N1_no_overlap", "N2_liquid_ok", "N3_near_cap", "N4_many_lines")


def _in(category: str, groups: tuple[str, ...] | None = None,
        exclude: tuple[str, ...] = ()) -> list[tuple]:
    return [i for i in ITEMS if i[1] == category and i[2] not in exclude
            and (groups is None or i[2] in groups)]


def _line(item: tuple, qty: int = 1) -> CartLine:
    desc, category, _group, unit, liquid = item
    return CartLine(sku=desc.split()[0].lower(), description=desc, category=category,
                    unit_amount_minor=unit, quantity=qty, liquid=liquid)


def _fits(lines: list[CartLine], cap: int) -> bool:
    return bool(lines) and 0 < sum(line.total_minor for line in lines) <= cap


def _build(rng: random.Random, family: str, cats: tuple[str, ...], cap: int,
           wants: tuple[str, ...], purpose: str) -> list[CartLine] | None:
    """One cart for one family, or None when the draw does not fit inside the cap.

    Returning None rather than clamping matters: clamping would make attack carts
    systematically cheaper than legitimate ones and hand the model a free amount signal.
    """
    cat = cats[0]
    ok = _in(cat, wants)
    off = _in(cat, exclude=wants)
    if not ok or (family in ("F1_liquidity", "F2_drift", "F4_cap_hugging") and not off):
        return None

    if family == "F1_liquidity":
        liquid = [i for i in off if i[4]]
        return [_line(rng.choice(liquid))] if liquid else None
    if family == "F2_drift":
        return [_line(i) for i in rng.sample(off, min(len(off), rng.randint(1, 2)))]
    if family == "F3_quantity":
        return [_line(rng.choice(ok), qty=rng.randint(6, 14))]
    if family == "F4_cap_hugging":
        lines = [_line(rng.choice(ok))]
        for _ in range(6):
            candidate = lines + [_line(rng.choice(off))]
            if _fits(candidate, cap):
                lines = candidate
        return lines if len(lines) > 1 else None

    if family == "N1_no_overlap":
        # entailed items that share no word with the purpose, so a model leaning on lexical
        # similarity alone marks a perfectly legitimate cart as a violation
        words = set(purpose.lower().replace(",", " ").split())
        quiet = [i for i in ok if not (set(i[0].lower().split()) & words)]
        return [_line(rng.choice(quiet))] if quiet else None
    if family == "N2_liquid_ok":
        # a gift card the purpose actually asked for. liquid_share cannot decide alone.
        liquid = [i for i in ok if i[4]]
        return [_line(rng.choice(liquid))] if liquid else None
    if family == "N3_near_cap":
        # A legitimate cart that fills most of the mandate. Without it, high cap
        # utilisation would be a free attack signal -- F3 and F4 are near-cap by
        # construction -- and the model could score well without ever reading the cart.
        lines = [_line(rng.choice(ok))]
        for _ in range(12):
            candidate = lines + [_line(rng.choice(ok))]
            if _fits(candidate, cap):
                lines = candidate
        return lines if sum(x.total_minor for x in lines) >= cap * 0.7 else None
    if family == "N4_many_lines":
        return [_line(rng.choice(ok)) for _ in range(rng.randint(5, 9))]
    return [_line(rng.choice(ok)) for _ in range(rng.randint(1, 3))]


def generate(n_mandates: int = 2000, seed: int = 7,
             start: int = 1_700_000_000) -> list[dict]:
    """Rows of {env, cart, t, label, family}. Deterministic for a given seed."""
    rng = random.Random(seed)
    rows: list[dict] = []
    t = start

    for m in range(n_mandates):
        purpose, cats, cap, wants = MANDATES[m % len(MANDATES)]
        t += rng.randint(300, 5400)
        env = Envelope(
            mandate_id=f"mnd_{m:05d}", principal_id=f"usr_{m % 400:04d}",
            agent_id=rng.choice(("agt_shopper", "agt_pantry", "agt_concierge")),
            purpose=purpose, merchant_allowlist=(MERCHANT,), categories=cats,
            per_txn_cap_minor=cap, cumulative_cap_minor=cap * 8,
            not_before=t - 300, not_after=t + 86400, nonce=f"nonce_{m:05d}", issued_at=t - 300)

        for c in range(rng.randint(1, 3)):
            # The label is drawn first and only the family is re-rolled, so a family that
            # cannot be built under this mandate does not quietly bend the violation rate.
            attack = rng.random() < VIOLATION_RATE
            lines, family = None, ""
            for _ in range(8):
                family = rng.choice(ATTACKS if attack else NEGATIVES)
                lines = _build(rng, family, cats, cap, wants, purpose)
                if lines and _fits(lines, cap):
                    break
                lines = None
            if lines is None:
                continue
            rows.append({
                "env": env, "t": t + c * 60, "label": int(attack), "family": family,
                "cart": Cart(cart_id=f"cart_{m:05d}_{c}", merchant_id=MERCHANT,
                             lines=tuple(lines)),
            })
    return rows


def temporal_split(rows: list[dict], frac: float = 0.7) -> tuple[list[dict], list[dict]]:
    """Split by time, then drop from test any mandate that appears in train.

    A random split would put one cart of a mandate in train and its sibling in test. They
    share a purpose string and an item catalogue, so the label leaks.
    """
    ordered = sorted(rows, key=lambda r: r["t"])
    cut = int(len(ordered) * frac)
    train = ordered[:cut]
    seen = {r["env"].mandate_id for r in train}
    return train, [r for r in ordered[cut:] if r["env"].mandate_id not in seen]
