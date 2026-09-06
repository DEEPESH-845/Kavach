/* ─────────────────────────────────────────────────────────────────────────────
   PLAIN ENGLISH, ONCE.

   This page talks about payments, cryptography and machine learning, and the
   reader might be a merchant, an engineer, a judge with ninety seconds, or
   someone who has never heard the word "webhook". Every term below is the same
   term the code uses -- nothing here is a simplified alias -- and every gloss is
   one sentence a non-specialist can finish.

   Used by <Term> for the inline chips. One definition, one place: if a word
   needs explaining twice on the page, it is explained the same way both times.
   ───────────────────────────────────────────────────────────────────────────── */

export type Gloss = { t: string; d: string };

export const GLOSSARY = {
  agent: { t: 'AI agent',
    d: 'A program that acts for a person — browsing, filling a cart, asking for a refund — without a human clicking each step.' },

  mandate: { t: 'Mandate',
    d: 'The permission slip a person signs for their agent: what it may buy, up to how much, and for how long. Kavach checks every action against it.' },

  envelope: { t: 'Delegation envelope',
    d: 'The mandate plus its digital signature, carried by the agent like an ID card. Kavach checks the signature before reading anything inside it.' },

  ed25519: { t: 'Ed25519 signature',
    d: 'A standard digital signature. It proves a mandate really came from the person who signed it and has not been edited since — the way a sealed envelope proves it was not opened.' },

  rail: { t: 'The rail',
    d: 'The payment network that actually moves the money — Razorpay, then the card networks and banks behind it. Kavach sends instructions to it and cannot see inside it.' },

  obligation: { t: 'Obligation',
    d: 'Money you owe someone but they do not have yet. A refund stays an open obligation until something proves the customer was actually credited.' },

  captured: { t: 'Captured',
    d: 'The payment has been taken from the customer, not merely authorised. You can only refund money that was captured.' },

  idempotency: { t: 'Idempotency key',
    d: 'A tag on a request so that sending it twice by accident only charges once. It stops repeats of the same request — it cannot stop a second, differently-worded request for the same thing.' },

  webhook: { t: 'Webhook',
    d: 'A message the payment provider sends you when something happens — "refund created", "payment failed". It arrives whenever it arrives, sometimes hours later.' },

  hmac: { t: 'HMAC signature',
    d: 'A short code attached to a webhook that proves it really came from Razorpay and was not faked or edited on the way.' },

  arn: { t: 'ARN / RRN',
    d: 'The tracking number the banking network issues once a refund is genuinely on its way to the customer. Until it exists, nobody can say the money is moving.' },

  npci: { t: 'NPCI',
    d: 'India’s national payments network, which sits between the gateway and the customer’s bank. Nothing a merchant runs can see inside it.' },

  mcp: { t: 'MCP',
    d: 'Model Context Protocol — the standard way an AI agent is handed a set of tools it may call. Kavach ships as one of these tool servers, so an agent can use it without any code change.' },

  'append-only': { t: 'Append-only log',
    d: 'A record you can only add to, never edit or delete. Every fact Kavach states points back to the entries in it.' },

  'hash-chain': { t: 'Hash chain',
    d: 'Each entry in the log carries a fingerprint of itself and of the entry before it. Change any old entry and every fingerprint after it stops matching — so tampering is visible.' },

  'sha-256': { t: 'SHA-256',
    d: 'The standard fingerprinting function used for those hashes. The same input always gives the same fingerprint; a different input effectively never does.' },

  escalate: { t: 'Escalate',
    d: 'Stop and ask a human, rather than approve or refuse on your own. Kavach escalates when it is unsure — it never guesses.' },

  'step-up': { t: 'Step-up',
    d: 'Ask the buyer to confirm — a tap on their phone — before the purchase goes through, instead of blocking it outright.' },

  reconciliation: { t: 'Reconciliation',
    d: 'Going back and checking what actually happened, instead of assuming the instruction you sent worked.' },

  entailment: { t: 'Entailment',
    d: 'Does this cart actually match what the buyer approved? ₹1,800 of gift cards fits a "₹2,000 of groceries" budget arithmetically, and fails on entailment.' },

  'minor-units': { t: 'Minor units',
    d: 'Money stored as whole paise rather than decimal rupees, so rounding can never quietly lose or invent a fraction of a rupee.' },

  'write-ahead': { t: 'Write-ahead',
    d: 'Write down what you are about to do before you do it. If the power cuts mid-way, the note survives and you know what to go and check.' },

  precision: { t: 'Precision',
    d: 'Of everything the system flagged, how much really was a problem. Low precision means it interrupts people for nothing.' },

  recall: { t: 'Recall',
    d: 'Of everything that really was a problem, how much the system caught. Low recall means money leaves quietly.' },

  'held-out': { t: 'Held-out split',
    d: 'Cases deliberately kept away from the model while it was being built, so the score measures what it does with things it has never seen.' },

  'expected-loss': { t: 'Expected loss',
    d: 'The average money each choice costs you, once you weigh what it might save against how often it goes wrong. Kavach picks the cheapest of the four.' },

  deterministic: { t: 'Deterministic',
    d: 'Same inputs, same answer, every time — arithmetic and signature checks, no model, nothing to be talked out of.' },

  staleness: { t: 'Staleness tolerance',
    d: 'How long Kavach will accept silence before it stops calling something known and starts calling it unknown.' },

  tier: { t: 'Permission tier',
    d: 'Whether an agent is allowed only to look things up (read) or also to move money (write).' },
} satisfies Record<string, Gloss>;

export type TermKey = keyof typeof GLOSSARY;
