# 06 — Threat Model

Scope: the merchant's position. Kavach sees what Razorpay can see and what arrives at the
merchant's own surface. NPCI-side and issuer-side conditions are outside it and are
represented as AMBIGUOUS rather than guessed (ADR-003).

## Assets

1. **Money in flight** — refunds dispatched, carts admitted, obligations not yet settled.
2. **The mandate** — a principal's delegation, and the cap and scope arithmetic resting on it.
3. **The evidence chain** — every fact cites the event sequence numbers behind it. If the log
   can be forged or reordered, every decision derived from it is worthless.

## Trust boundaries

| Input | Trusted? | Why |
|---|---|---|
| Delegation envelope | **No** — supplied by the arriving agent | verified: Ed25519 over raw bytes, nonce, window, principal binding, revocation |
| Cart | **Yes** — the merchant's own storefront and catalogue | `category` and `liquid` are merchant facts; if the agent could set them the scope check would be self-certified |
| Razorpay webhook | **Only with a valid HMAC** | `verify_webhook` over raw bytes, constant-time compare |
| Razorpay API response | Partially | ingested as an event with `sig_verified=0`, so it can never yield DERIVED_CERTAIN |
| Issuer public key | **Yes** — configured out of band | a key an envelope asserts about itself proves nothing |
| Agent free text (reason, purpose) | **No** | reaches only the learned components, which can escalate but never authorise |

## Adversaries and controls

### A1 · Forger — presents a mandate the principal never signed
Ed25519 verified over the raw bytes *before* the JSON is parsed. Verifying a re-serialised
structure would fail on key ordering, which invites relaxing the check until it passes — and
a relaxed signature check is a decoration. **Residual:** a stolen private key is
indistinguishable from the principal. Mitigated only by revocation, read at decision time.

### A2 · Replayer — reuses a mandate that already succeeded
Nonce claimed once, `INSERT OR IGNORE` on a primary key. Claimed **only** after every other
check passes, so a wrong clock or a wrong principal cannot burn a live mandate — otherwise
replay protection becomes a denial-of-service primitive. Signature is checked first, so
unsigned traffic never reaches the nonce table at all.

### A3 · Scope stretcher — a real mandate, a cart outside what it delegated
Merchant allowlist, category scope, per-transaction and cumulative caps, all integer
arithmetic. Empty scopes fail closed: a mandate naming no categories delegated none.

### A4 · Purpose subverter — a cart inside every cap that is not what was asked for
**The adversary no shipped control addresses.** ₹1,800 of gift cards satisfies "weekly
groceries under ₹2,000" arithmetically and to the rupee. Countered by the entailment model,
measured in `07-evals.md`. **Residual, measured not asserted:** purpose drift is caught 0.550
of the time, and lexical similarity cannot bridge synonymy.

### A5 · Hijacked agent — instructions injected into content the agent read
Kavach does not attempt to detect the injection. It bounds the blast radius: the mandate the
agent holds still caps the amount, still limits the merchants, and the cart is still scored
against the purpose the *principal* stated rather than the one the agent now believes.
**Residual:** an injected instruction that stays inside purpose, scope and cap is not
detected. Goal-drift detection is named as out of scope, not solved.

### A6 · Re-deciding agent — outbound, forms a new intent for an obligation already in flight
An idempotency key protects a *retried request*; nothing protects a *re-decided* one
(ADR-008). Countered by the open-object ledger and the duplicate-risk model, with the
write-ahead intent log making the crash window recoverable.

### A7 · Confused agent — reads a rail state as a financial outcome
Not malicious and the most common. `status: processed` on a refund means dispatched, not
credited. Countered by returning rail state and obligation state as separate fields, and by
staleness becoming *unknown* rather than *unchanged*.

## Failure posture

Every degradation widens caution; none opens the gate (ADR-006).

| Failure | Behaviour |
|---|---|
| Entailment model missing | risk UNKNOWN → floor rises to STEP_UP. ALLOW is unreachable. |
| Issuer key unknown | `UNKNOWN_ISSUER` → DENY. Never skipped. |
| Truth-plane confidence UNKNOWN | outbound escalates rather than proceeds |
| Webhook signature absent or wrong | not ingested; cannot raise confidence |
| Clock skew beyond the window | envelope fails closed |

## Explicitly not defended

Stated so the omissions are decisions rather than gaps discovered later: cross-merchant ring
detection, injection-span localisation, goal drift across a session, mandate farming and
velocity analysis, a compromised merchant catalogue mislabelling `category` or `liquid`, and
anything requiring NPCI-side visibility. The first four are Phase 3; the fifth is a trust
assumption stated above; the sixth is ruled out by ADR-002 and ADR-003.
