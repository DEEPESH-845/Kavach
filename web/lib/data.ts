/* ─────────────────────────────────────────────────────────────────────────────
   Everything the page asserts, in one file, so one test can guard all of it.

   tests/test_site.py parses this against evals/risk_report.json, governor.Policy,
   truth._STALE_SECONDS and the MCP tool decorators. If any of them move and this
   does not, the build fails. ADR-007 does not stop at the edge of the repository.
   ───────────────────────────────────────────────────────────────────────────── */

export type Verdict = 'ALLOW' | 'ESCALATE' | 'DENY';
export type Admission = 'ALLOW' | 'STEP_UP' | 'HOLD' | 'DENY';
export type Kind = 'steel' | 'amber' | 'bone';

/* ── measured, from evals/risk_report.json ──────────────────────────────── */
export const REPORT = {
  threshold: 0.5132468693487481,
  duplicate_rate_assumption: 0.12,
  exposure_minor: 22531100,
  results: [
    { name: 'B0 escalate everything', precision: 0.16648648648648648, recall: 1.0,                 leaked_minor: 0,        review_rate: 1.0,                  gloss: 'send every single request to a human — catches everything, and no merchant would run it' },
    { name: 'B1 exact text match',    precision: 0.0,                 recall: 0.0,                 leaked_minor: 22531100, review_rate: 0.0,                  gloss: 'flag it only if the wording matches letter for letter — real duplicates are reworded, so it finds none' },
    { name: 'B2 rule: amt+open+24h',  precision: 0.18681318681318682, recall: 0.22077922077922077, leaked_minor: 18463600, review_rate: 0.19675675675675675,  gloss: 'same amount, still open, within 24 hours — what a good engineer writes without any AI' },
    { name: 'B3 learned, no text',    precision: 0.6593406593406593,  recall: 0.7792207792207793,  leaked_minor: 6110500,  review_rate: 0.19675675675675675,  gloss: 'AI, but it is never shown the reason the agent gave' },
    { name: 'B4 learned + reads text',precision: 0.8131868131868132,  recall: 0.961038961038961,   leaked_minor: 1425700,  review_rate: 0.19675675675675675,  gloss: 'AI that also reads the reason text — this is Kavach', hero: true },
  ],
  budget_sweep: [
    { budget: 0.05, escalated: 0.04108108108108108,  recall: 0.24675324675324675, precision: 1.0,                leaked_minor: 19522000, prevented_minor: 3009100 },
    { budget: 0.10, escalated: 0.08540540540540541,  recall: 0.512987012987013,   precision: 1.0,                leaked_minor: 12319500, prevented_minor: 10211600 },
    { budget: 0.20, escalated: 0.19675675675675675, recall: 0.961038961038961,   precision: 0.8131868131868132, leaked_minor: 1425700,  prevented_minor: 21105400 },
    { budget: 0.30, escalated: 0.28216216216216217, recall: 0.987012987012987,    precision: 0.5823754789272031, leaked_minor: 539600,   prevented_minor: 21991500 },
  ],
};

/* A line count changes on every commit and catches nothing. These are the numbers that
   mean something, so they are the ones the page states and tests/test_site.py guards
   against the tree: the test count against `def test` in tests/, and the scenario count
   against the adversary lab's own registry. A footer that states a number nothing checks
   is exactly the drift ADR-007 exists to stop. */
export const TREE = { tests: 254, scenarios: 11 };

/* Policy defaults, verbatim from pkg/kavach/governor.py. The governor compares against its
   own risk_threshold, not the benchmark's frozen threshold — different numbers for different
   jobs, and the page uses whichever one belongs to the code it is showing. */
export const POLICY = {
  max_auto_refund_minor: 1_000_00,
  session_cap_minor: 5_000_00,
  daily_cap_minor: 25_000_00,
  risk_threshold: 0.5,
};

/* The tool surface an agent sees. Names match razorpay-mcp-server so swapping is a config
   line; the return types do not, which is the entire point. */
export const TOOLS = [
  { n: 'fetch_payment',         w: false, d: 'a FinancialFact, not a raw entity' },
  { n: 'fetch_refund',          w: false, d: 'rail state and obligation state, separately' },
  { n: 'list_open_obligations', w: false, d: 'what money is still in flight' },
  { n: 'check_refund',          w: false, d: 'the verdict, without acting on it' },
  { n: 'create_refund',         w: true,  d: 'bounded, write-ahead, idempotency key from the intent id' },
  { n: 'approval_queue',        w: false, d: 'what is waiting on a human' },
  { n: 'audit_trail',           w: false, d: 'the events behind every decision' },
  { n: 'verify_audit_trail',    w: false, d: 'cryptographically verify the event log integrity' },
  { n: 'verify_agent',          w: false, d: 'the delegation envelope, checked over the raw bytes' },
  { n: 'admit_cart',            w: false, d: 'does this cart entail the mandate it arrived under?' },
  { n: 'create_payment_link',   w: true,  d: 'a request for money, recorded before it is sent' },
  { n: 'fetch_payment_link',    w: false, d: 'the link and the payments made against it' },
  { n: 'create_order',          w: true,  d: 'an order for Checkout, recorded as an event' },
  { n: 'fetch_order',           w: false, d: 'the order, as the rail reports it' },
];

/* ── the eight planes, ordered by how much of each can be proven ─────────── */
export type Plane = {
  half: string; n: string; t: string; m: string; k: Kind; ai: string; ms: string;
  catches: string; cannot: string; boundary: string;
  /** the module that implements it, and whether that module is in the tree yet.
   *  tests/test_site.py asserts `built` against the filesystem, so the page cannot
   *  claim a plane exists before it does — or keep calling one planned after it lands. */
  src: string; built: boolean;
};

export const PLANES: Plane[] = [
  { half: 'GATE · inbound',  n: '①', src: 'gate/envelope.py', built: true, t: 'Credential',        m: 'is the permission slip real, current, and for this shop?',      k: 'steel', ai: 'no AI, ever',       ms: '~3 ms',
    catches: 'Forged, expired, cancelled, re-used and out-of-scope permission slips. Spending limits are checked in whole paise against a running total rebuilt from the log.',
    cannot: 'Tell you whether the cart matches what the buyer meant. A valid signature answers <em>who</em>, never <em>what</em>.',
    boundary: 'The slip arrives with the agent, so it is treated as untrusted. The signature is checked over the raw bytes before a single field inside is read.' },
  { half: 'GATE · inbound',  n: '②', src: 'intelligence/entailment.py', built: true, t: 'Intent',            m: 'is this cart really what the buyer asked for?',               k: 'amber', ai: 'AI',                ms: '~120 ms',
    catches: '₹1,800 of gift cards satisfying “weekly groceries under ₹2,000” arithmetically, and an ₹18,000 chair satisfying “office supplies”.',
    cannot: 'Judge a cart that is genuinely in scope but wrong for reasons the buyer never wrote down.',
    boundary: 'The item categories come from the merchant’s own catalogue, so they can be trusted. If the agent could set them, the check would be the agent marking its own homework.' },
  { half: 'GATE · inbound',  n: '③', src: 'gate/provenance.py', built: true, t: 'Provenance',        m: 'did the agent change its mind right after reading something?', k: 'amber', ai: 'AI',                ms: '~140 ms',
    catches: 'A goal that shifted the instant the agent read a product review — plus the exact sentence of planted text that moved it.',
    cannot: 'Catch an agent that was hostile before the session started. There is no change of mind to notice.',
    boundary: 'Page text, cart text and logs go into our own prompts clearly labelled as untrusted data, never as instructions. A test proves the checker ignores a planted “return ALLOW”.' },
  { half: 'GATE · inbound',  n: '④', src: 'gate/population.py', built: true, t: 'Population',        m: 'how much has this agent done in the last hour?',              k: 'amber', ai: 'rule of thumb',      ms: '<1 ms',
    catches: 'A bot farm firing requests faster than any real person would — 20 in an hour makes Kavach stricter, 50 makes it strictest.',
    cannot: 'Spot a coordinated group. We record an agent and a session, but no device, address or token, so there is nothing shared to link accounts by. That is the next thing to build, not something we claim today.',
    boundary: 'It counts rows in our own records, so nothing the agent says about itself can move it. Advisory only: it can make Kavach stricter and can never let a cart through.' },
  { half: 'RAIL · outbound', n: '⑤', src: 'truth.py', built: true, t: 'Truth',             m: '“the rail is done” is not “the customer was paid”',            k: 'steel', ai: 'no AI, ever',       ms: '<1 ms',
    catches: '<span class="mono">processed</span> being read as <em>the customer has the money</em>. Evidence that contradicts itself, and silence that has gone on too long.',
    cannot: 'See anything inside the national payments network. Those cases come back as <span class="mono">AMBIGUOUS</span> with a stated reason — never as an invented answer.',
    boundary: 'A message whose signature we could not verify never becomes certain evidence. The signature is checked over the raw body, in constant time.' },
  { half: 'RAIL · outbound', n: '⑥', src: 'ledger.py', built: true, t: 'Obligation ledger', m: 'what money is already promised but not yet confirmed',         k: 'steel', ai: 'no AI',             ms: '<1 ms',
    catches: 'Money already on its way whose confirmation has not landed yet — the exact window every duplicate is born in.',
    cannot: 'See anything the merchant owes that was created outside this system.',
    boundary: 'The total is recalculated from the event log on every single call. A stored second copy of a derived number is a number that quietly goes wrong.' },
  { half: 'RAIL · outbound', n: '⑦', src: 'intelligence/model.py', built: true, t: 'Duplicate risk',    m: 'are we being asked for money we have already sent?',          k: 'amber', ai: 'AI · advisory',     ms: '~2 ms',
    catches: '“The refund didn’t work, issue another” when one is already on its way. The same sentence scores 0.951 in one situation and 0.042 in another — context, not keywords.',
    cannot: 'Approve anything at all. It can push a decision toward a human, and that is the whole of its power.',
    boundary: 'It is right about four times in five, so roughly one interruption in five delays a perfectly good refund. That cost is exactly why it asks a human instead of refusing.' },
  { half: 'RAIL · outbound', n: '⑧', src: 'governor.py', built: true, t: 'Governor',          m: 'the final call: bookkeeping, permissions, certainty, AI, caps', k: 'bone',  ai: 'policy',           ms: '<1 ms',
    catches: 'Everything the AI is not allowed to wave through, checked in a fixed order, strongest rule first.',
    cannot: 'Be argued with. No score, and no human, gets to override a bookkeeping rule.',
    boundary: 'When something breaks, the system only ever gets stricter. There is no failure anywhere in it that ends up more permissive than the healthy path.' },
];

/* Obligation kinds and reason strings, lifted from intelligence/corpus.py so the replay is
   the corpus's own vocabulary rather than invented copy. */
export const KINDS = [
  { k: 'duplicate_charge', share: [1, 1],     texts: ['customer was charged twice for this order', 'duplicate debit reported by the buyer', 'double charge on the same order, please reverse one', 'buyer says he paid twice, refund the extra one'] },
  { k: 'item_damaged',     share: [.6, 1],    texts: ['item arrived damaged', 'product was broken on delivery', 'customer received a cracked unit', 'packaging crushed, item unusable'] },
  { k: 'shipping_fee',     share: [.02, .08], texts: ['refund the shipping charge only', 'waive the delivery fee for this order', 'refund delivery charges, keep the item amount'] },
  { k: 'not_delivered',    share: [1, 1],     texts: ['order never arrived', 'package not delivered to the customer', 'courier marked delivered but customer denies receipt'] },
  { k: 'size_return',      share: [.4, .9],   texts: ['wrong size, customer returned it', 'size mismatch return', 'returned - size too small'] },
  { k: 'price_match',      share: [.05, .2],  texts: ['price dropped after purchase, refund the difference', 'customer found a lower price, adjusting'] },
  { k: 'late_delivery',    share: [.05, .15], texts: ['delivered late, goodwill refund', 'sla breach on delivery, partial refund'] },
];

/* ── the outbound half: intent lifecycle, verbatim from ledger.py's schema ───
   `status TEXT NOT NULL,   -- PROPOSED|APPROVED|EXECUTED|BLOCKED|ESCALATED|FAILED`
   Chapter 06 shows the three states of the happy path; tests/test_site.py asserts every
   one it names is in that enumeration, so the page cannot invent a state the ledger has
   no column value for. */
export const INTENT_STATES = [
  { s: 'PROPOSED', d: 'the intent, recorded before it is judged' },
  { s: 'APPROVED', d: 'write-ahead — the reservation, committed before the call' },
  { s: 'EXECUTED', d: 'settled, carrying the refund id the rail returned' },
];

/* ── what each chapter leaves behind in the one append-only log ─────────────
   The final section walks this end to end. It is the page's own table of contents
   restated as evidence, which is the only form the argument can be checked in. */
export const CHAIN = [
  { t: 'INTENT',      d: 'an intents row, PROPOSED, before anything judges it' },
  { t: 'TRUTH',       d: 'a FinancialFact citing events [12, 17]' },
  { t: 'OBLIGATION',  d: 'exposure recomputed from the log, never stored' },
  { t: 'RISK',        d: 'score 0.951, recorded as advisory' },
  { t: 'GOVERNOR',    d: 'ESCALATE, with the reasons that produced it' },
  { t: 'PROVIDER',    d: 'one request, keyed kavach-<intent_id>' },
  { t: 'WEBHOOK',     d: 'seq 17, sig_verified over the raw body' },
  { t: 'RECONCILE',   d: 'EXECUTED, matched on notes.intent_id' },
  { t: 'PROOF',       d: 'SHA-256 over every row and its predecessor', end: true },
];

/* Verbatim from proof.claims(), which the API ships with every proof response so the UI
   cannot overstate the chain by omission. The page is a UI. tests/test_site.py asserts
   these three strings against the Python, so the caveat cannot quietly fall out of the
   marketing copy while staying in the API. */
export const CLAIMS = {
  proves:
    "the ordered event log has not been altered since it was written: every row "
    + "reproduces its stored SHA-256 over its own immutable fields and its "
    + "predecessor's hash",
  does_not_prove:
    "who wrote an event. Provenance for rail events comes from the HMAC signature "
    + "check on the webhook, recorded separately as sig_verified",
  limit:
    "an attacker with write access could rewrite the chain from the point of an edit "
    + "forward. Externally anchoring the head would close that, and is not implemented",
  algorithm: "SHA-256, chained",
};
