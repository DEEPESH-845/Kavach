# 09-demo: The Razorpay Buildathon Pitch

This script maps exactly to the 5-minute demo block outlined in the `README.md`. It is designed to be executed live using the Kavach MCP Server and the static frontend UI.

## Requirements
- `make site` running on `:4173`
- Kavach MCP Server running in a terminal
- Claude Desktop or a CLI agent configured to use the Kavach MCP Server

---

### Beat 1: The Setup (0:00 - 0:30)
**Goal:** Establish the twin problems of agentic commerce.

*Speaker (while showing the Kavach UI at `#counter`):*
"AI agents now stand on both sides of a merchant's counter. A buyer agent walks up to checkout holding a delegated mandate you cannot verify. An operator agent sits inside your dashboard moving your money out."

*Action:* Scroll to **#divergence**.
"Razorpay shipped how an agent pays. Kavach is how a merchant decides whether to accept one, and how to stop its own agents from paying twice. Here is the nightmare scenario: An agent issues a refund. The API returns `processed`. The agent misreads `processed` as 'the customer has the money', which is unobservable and false for hours. When the customer complains, the agent forms a *new* intent and refunds them again. One obligation, paid twice."

### Beat 2: Why existing controls fail (0:30 - 1:00)
**Goal:** Pre-empt the obvious objections.

*Action:* Keep scrolling through **#divergence** to show the existing controls.
"Why didn't idempotency keys stop this? Because the agent minted a *new* key for a new intent. Why didn't caps stop this? Because the second refund fits perfectly inside the daily cap. Every existing control bounds the wrong thing. None of them ask: 'Is this new intent financially the same obligation as something already in flight?'"

### Beat 3: Live Action (1:00 - 2:30)
**Goal:** Show Kavach catching both inbound and outbound fraud.

*Action:* Open Claude Desktop (configured with the Kavach MCP Server).
"Let's look at the outbound risk. A customer bought a ₹5,000 item. The agent just refunded them, and the customer complains it hasn't arrived. I'll tell the agent to refund them again."

*Prompt Claude:* "The refund didn't work, issue another refund for ₹5,000 for payment `pay_Nx3f9K2`."
*Claude calls `create_refund`.*

*Speaker:* "Kavach intercepts the `create_refund` call. The Duplicate Risk model reads the reason text and detects a semantic collision with an obligation already in flight. It scores the intent, checks the Governor, and..."
*Claude responds: "I cannot issue this refund. Kavach has escalated it to human review because an open obligation already matches this intent."*

*Speaker:* "Kavach refused the action. It didn't just warn us; it stopped the money."

### Beat 4: The Architecture (2:30 - 3:30)
**Goal:** Explain the Determinism Gradient.

*Action:* Switch back to the UI, scroll to **#gradient** (The 8 Planes).
"How did it do that safely? Kavach is ordered by a determinism gradient. Cryptography and integer arithmetic sit at the entrance. Accounting invariants sit at the exit. The learned ML planes sit in the middle—where the ambiguity actually is—and they can only ever move a decision toward *more* caution. An ML model can escalate a refund, but it can never override an accounting invariant to allow one."

### Beat 5: AI Judgement (3:30 - 4:30)
**Goal:** Show why rules fail and why LLMs shouldn't run everything.

*Action:* Scroll to **#evidence**.
"We tested this on a held-out dataset of 5,740 intents. If you write a hard-coded rule to catch duplicates, it leaks ₹1.8 Lakhs. Kavach's ML model reads the reason text and leaks only ₹14k—at the exact same human review budget. But we deliberately do *not* use LLMs for everything. Cap enforcement and rail state are deterministic by design. Putting an LLM in charge of cap arithmetic is malpractice."

### Beat 6: The Proof Spine (4:30 - 5:00)
**Goal:** Land the final blow: Cryptographic truth.

*Action:* Scroll to **#proof**.
"Finally, every decision Kavach makes is backed by a hash-chained, tamper-evident audit trail. When an agent moves your money, Kavach emits a `FinancialFact` citing the exact event sequence numbers that led to that decision. If a dispute happens six months later, you don't send the bank an LLM log. You send them the proof."

*Speaker (closing):* "Kavach. The seam between what a rail says and what is owed."
