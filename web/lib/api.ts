/* The only place this app knows a backend exists.
 *
 * Two rules hold the boundary:
 *
 * 1. NOTHING here invents data. There is no fallback object, no `?? 0`, no sample row
 *    for when the API is down. A component that cannot reach the backend renders an
 *    error state saying so. A dashboard that quietly substitutes zeros for an outage
 *    is worse than one that goes blank, because the zeros are believed.
 *
 * 2. Money crosses as integer minor units named `*_minor`, and is formatted for display
 *    only at the last moment, in format.ts. No arithmetic in this app touches rupees.
 */

/** Same-origin when the API serves the built UI; the dev server points at :8000. */
export const API_BASE =
  process.env.NEXT_PUBLIC_KAVACH_API ??
  (typeof window !== 'undefined' && window.location.port === '3000'
    ? 'http://127.0.0.1:8000'
    : '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: { field: string; problem: string }[];
  readonly reference?: string;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields as ApiError['fields'];
    this.reference = extra.reference as string | undefined;
  }

  /** What the operator should do about it, in one sentence.
   *
   * The unreachable case names the exact URL that failed and the command for the setup
   * they are actually in. "Start the API with `make run`" is wrong advice while someone
   * is running `next dev`, because demo rebuilds the UI and serves it on the API's port. */
  get remedy(): string {
    if (this.status === 0) {
      const where = API_BASE || 'this origin';
      return typeof window !== 'undefined' && window.location.port === '3000'
        ? `Nothing answered at ${where}. Run \`make dev\` to start the API alongside the `
          + 'dev server, or `make api` in another terminal, then retry.'
        : `Nothing answered at ${where}. Run \`make run\` to seed, build and serve the `
          + 'whole product, then retry.';
    }
    if (this.status === 404) return 'Check the identifier, or return to the command centre.';
    if (this.status === 409) return 'Reload — this item has already moved on.';
    if (this.status === 422) return 'Correct the highlighted fields and submit again.';
    if (this.status >= 500) return 'The failure is logged on the server. Retry, or check its output.';
    return 'Retry, or return to the command centre.';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      cache: 'no-store',
    });
  } catch {
    // A network-level failure has no status and no body. Naming it here means every
    // caller gets the same actionable message instead of "Failed to fetch".
    throw new ApiError(0, 'unreachable', 'Kavach API is not reachable.');
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const err = (body as { error?: Record<string, unknown> } | null)?.error;

    /* EVERY failure the API produces carries an {"error": {...}} envelope -- the three
       handlers in api_server.py leave no other shape. So a failure without one did not
       come from Kavach: something else is answering on this origin. The ordinary case is
       the built UI served by a plain static file server (`make site`, or web/out behind
       any daemon) with no backend mounted, where /api/health is simply a missing file.
       Read as an ordinary 404 that told the operator to "check the identifier, or return
       to the command centre" -- sending them to look for a bad id on a screen that never
       had one, and never naming the thing that is actually absent. It is the same
       condition as an unreachable API and gets the same answer. */
    if (!err) {
      throw new ApiError(0, 'unreachable',
        `Kavach API is not reachable — ${res.status} from something that is not it.`);
    }

    throw new ApiError(
      res.status,
      (err?.code as string) ?? 'error',
      (err?.message as string) ?? `Request failed with status ${res.status}.`,
      err ?? {},
    );
  }
  return body as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, payload: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(payload) });

/* ── domain types ───────────────────────────────────────────────────────────── */

export type Action = 'ALLOW' | 'ESCALATE' | 'DENY';
export type Verdict = 'ALLOW' | 'STEP_UP' | 'HOLD' | 'DENY';
export type StageState = 'PASS' | 'FAIL' | 'FLAG' | 'SKIPPED' | 'UNAVAILABLE';

export type Health = {
  status: string;
  version: string;
  mode: string;
  mode_note: string;
  database: string;
  models: { duplicate_risk: boolean; entailment: boolean };
  integrity: { chain_intact: boolean; events: number; broken_at: number | null };
  policy: Record<string, number | boolean>;
  ui: boolean;
};

export type DecisionPayload = {
  action?: Action;
  reasons?: string[];
  evidence_events?: number[];
  duplicate_risk?: number | null;
  risk_factors?: string[];
  open_exposure?: number;
};

export type Intent = {
  intent_id: string;
  agent_id: string;
  session_id: string;
  tool: string;
  target_type: string;
  target_id: string;
  amount_minor: number;
  reason_text: string;
  created_at: number;
  status: string;
  result_id: string | null;
  decision: DecisionPayload;
};

export type StreamItem = {
  intent_id: string;
  agent_id: string;
  session_id: string;
  tool: string;
  target: string;
  target_type: string;
  target_id: string;
  amount_minor: number;
  reason_text: string;
  created_at: number;
  status: string;
  result_id: string | null;
  action: Action | null;
  risk: number | null;
  headline: string | null;
  exposure: number | null;
};

export type Overview = {
  as_of: number;
  exposure: { open_minor: number; open_count: number; oldest_seconds: number };
  governed: { intents: number; amount_minor: number; executed: number; last_24h: number };
  refused: { denied: number; escalated: number; protected_minor: number; duplicate_flagged: number };
  review_queue: number;
  unresolved_outcomes: number;
  agents: { active: number; admission_rate: number | null };
  integrity: { chain_verified: boolean; message: string; events: number };
  by_status: Record<string, number>;
};

export type EventRow = {
  seq: number;
  source: string;
  external_id: string;
  entity_type: string;
  entity_id: string;
  parent_entity_id: string | null;
  event_type: string;
  occurred_at: number;
  received_at: number;
  sig_verified: boolean;
  previous_event_hash: string | null;
  event_hash: string;
  payload?: Record<string, unknown>;
  verified?: boolean;
};

export type Fact = {
  entity_type: string;
  entity_id: string;
  rail_state: string;
  obligation_open: boolean;
  confidence: string;
  amount_minor: number;
  currency: string;
  because: string;
  evidence: number[];
  unresolved_for: number;
  arn: string | null;
  settled_to_customer: boolean;
  exposure_minor?: number;
};

export type EntityDetail = Fact & {
  timeline: EventRow[];
  related: {
    refunds?: Fact[];
    intents?: {
      intent_id: string; agent_id: string; session_id: string; amount_minor: number;
      reason_text: string; status: string; created_at: number; result_id: string | null;
    }[];
    payment?: Fact | null;
  };
  note: string;
};

export type TruthTrace = {
  entity_type: string;
  entity_id: string;
  steps: {
    event: EventRow;
    rail_state?: string;
    obligation_open?: boolean;
    confidence?: string;
    because?: string;
    changed?: boolean;
    error?: string;
  }[];
  fact: Fact;
  provenance: Record<string, string>;
  final_confidence: string;
  as_of: number;
};

export type DecisionDetail = {
  intent: Intent;
  truth: {
    fact: Fact | null;
    evidence: EventRow[];
    open_obligations: Record<string, unknown>[];
    exposure_minor: number;
  };
  risk: { score: number | null; factors: string[]; assessed: boolean };
  governor: { action: string; reasons: string[]; open_exposure: number | null };
  integration: { result_id: string | null; provider_events: EventRow[]; settled: string };
  audit: {
    events: EventRow[];
    sibling_intents: {
      intent_id: string; agent_id: string; session_id: string; amount_minor: number;
      reason_text: string; status: string; created_at: number; result_id: string | null;
    }[];
  };
  proof: { verified: boolean; message: string; event_seqs: number[] };
};

export type Obligations = {
  items: {
    entity_type: string; entity_id: string; amount_minor: number; currency: string;
    rail_state: string; confidence: string; because: string; unresolved_for: number;
    evidence: number[]; arn: string | null;
  }[];
  total_minor: number;
  count: number;
  oldest_seconds: number;
  ambiguous: number;
  as_of: number;
};

export type Agent = {
  agent_id: string; intents: number; requested_minor: number; denied: number;
  escalated: number; sessions: number; admission_rate: number | null;
  first_seen: number; last_seen: number;
};

export type Policy = {
  limits: Record<string, number | boolean>;
  threshold_source: string;
  authority_order: { rank: number; layer: string; kind: string; outcome: string; note: string }[];
  mutable: boolean;
  mutability_note: string;
};

export type Stage = { key: string; label: string; detail: string; state: StageState };

export type Admission = {
  verdict: Verdict;
  reasons: string[];
  envelope_failures: string[];
  scope_violations: string[];
  purpose_risk: number | null;
  risk_factors: string[];
  evidence_events: number[];
  expected_loss_rupees: Record<string, number>;
  mandate_id: string | null;
  cart: {
    cart_id: string; merchant_id: string; total_minor: number;
    lines: { sku: string; description: string; category: string; quantity: number;
             unit_amount_minor: number; total_minor: number; liquid: boolean }[];
  };
  stages: Stage[];
  charged_to_mandate: boolean;
  entailment_model: boolean;
  issuer: { key_id: string; simulated: boolean; note?: string };
};

export type Mandate = {
  mandate_id: string; principal_id: string; agent_id: string; purpose: string;
  merchant_allowlist: string[]; categories: string[];
  per_txn_cap_minor: number; cumulative_cap_minor: number;
  not_before: number; not_after: number; nonce: string; issued_at: number;
};

export type ScenarioSpec = {
  id: string; plane: 'inbound' | 'outbound'; severity: string; title: string;
  question: string; defence: string; expect: string[];
};

export type ScenarioResult = ScenarioSpec & {
  steps: string[];
  actual: string;
  expected: string[];
  outcome: 'HELD' | 'BROKEN' | 'MODEL_UNAVAILABLE';
  elapsed_ms: number;
  model_used: boolean;
  decision?: DecisionPayload;
  truth?: Record<string, unknown>;
  admission?: Admission;
  first_admission?: Admission;
  mandate?: Mandate;
  sandbox: { isolated: boolean; epoch: number; note: string };
};

export type ChainPage = {
  items: EventRow[];
  next_before: number | null;
  status: { ok: boolean; events: number; checked: number; broken_at: number | null; detail: string | null; head: string | null };
  claims: Record<string, string>;
};

export type ReviewResult = {
  intent_id: string; action: string; applied: boolean; status: string;
  audit_event_seq: number; provider_call: string; what_happens_next: string;
};

export type EvaluateResult = {
  committed: boolean;
  intent_id: string | null;
  decision: DecisionPayload;
  truth: Record<string, unknown>;
  note: string;
};

type Page<T> = { items: T[]; total: number; limit: number; offset: number };

/* ── endpoints ──────────────────────────────────────────────────────────────── */

export const api = {
  health: () => get<Health>('/health'),
  policy: () => get<Policy>('/policy'),
  overview: () => get<Overview>('/overview'),
  stream: (limit = 40, before?: number) =>
    get<{ items: StreamItem[]; next_before: number | null }>(
      `/stream?limit=${limit}${before ? `&before=${before}` : ''}`),

  intents: (q: { status?: string; agent_id?: string; target_id?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)));
    return get<Page<Intent>>(`/intents${p.toString() ? `?${p}` : ''}`);
  },
  decision: (id: string) => get<DecisionDetail>(`/intents/${encodeURIComponent(id)}`),

  reviewQueue: () => get<{ items: Intent[]; total: number }>('/review'),
  review: (id: string, body: { action: 'approve' | 'reject'; reviewer?: string; note?: string }) =>
    post<ReviewResult>(`/review/${encodeURIComponent(id)}`, body),
  reconciliation: () => get<{ items: Intent[]; total: number }>('/reconciliation'),

  entities: (type: 'payment' | 'refund', limit = 50, offset = 0) =>
    get<Page<Fact> & { note: string }>(`/entities/${type}?limit=${limit}&offset=${offset}`),
  entity: (type: 'payment' | 'refund', id: string) =>
    get<EntityDetail>(`/entities/${type}/${encodeURIComponent(id)}`),
  truth: (type: 'payment' | 'refund', id: string) =>
    get<TruthTrace>(`/truth/${type}/${encodeURIComponent(id)}`),
  obligations: () => get<Obligations>('/obligations'),

  agents: () => get<{ items: Agent[] }>('/agents'),
  agent: (id: string) => get<Agent & { intents: Intent[] }>(`/agents/${encodeURIComponent(id)}`),

  gateInspect: (mandate: Mandate) => post<{
    valid: boolean; failures: string[]; mandate: (Mandate & {
      spent_minor: number; remaining_minor: number }) | null;
    admissions?: { seq: number; at: number; cart_id: string; total_minor: number; event_hash: string }[];
    issuer?: { key_id: string; simulated: boolean };
  }>('/gate/inspect', mandate),
  gateAdmit: (body: {
    mandate: Mandate; cart_id: string; merchant_id: string;
    lines: { sku: string; description: string; category: string;
             unit_amount_minor: number; quantity: number; liquid: boolean }[];
    untrusted_context?: string; commit?: boolean;
  }) => post<Admission>('/gate/admit', body),

  evaluate: (body: {
    agent_id: string; session_id: string; target_id: string; amount_minor: number;
    reason_text: string; tool?: string; commit?: boolean;
  }) => post<EvaluateResult>('/governor/evaluate', body),

  chain: (limit = 50, before?: number) =>
    get<ChainPage>(`/proof/chain?limit=${limit}${before ? `&before=${before}` : ''}`),
  verifyChain: () => get<ChainPage['status'] & { claims: Record<string, string>; verified_at: number }>('/proof/verify'),
  disputeUrl: (id: string) => `${API_BASE}/api/dispute/${encodeURIComponent(id)}`,
  dispute: (id: string) => get<Record<string, unknown>>(`/dispute/${encodeURIComponent(id)}`),

  scenarios: () => get<{ items: ScenarioSpec[]; models: Record<string, boolean>; note: string }>('/scenarios'),
  runScenario: (id: string) => post<ScenarioResult>(`/scenarios/${encodeURIComponent(id)}/run`, {}),

  evaluations: () => get<{ risk: Record<string, unknown> | null; gate: Record<string, unknown> | null; note: string }>('/evaluations'),
};

/* ── the buyer journey ──────────────────────────────────────────────────────── */

export type Product = {
  sku: string; name: string; description: string; category: string;
  unit_amount_minor: number; liquid: boolean; blurb: string; review?: string;
};

export type Scenario = {
  id: string; label: string; title: string; question: string; rung: string;
  expects: Verdict[]; attack: boolean;
};

export type Storefront = {
  merchant_id: string; categories: string[]; products: Product[]; scenarios: Scenario[];
  principal: { id: string; name: string };
  agent: { id: string; name: string; note: string };
  mandate: Mandate;
};

export type CartLine = {
  sku: string; description: string; category: string; unit_amount_minor: number;
  quantity: number; liquid: boolean; name?: string;
};

export type Plan = {
  mode: string; label: string; title: string; question: string; rung: string;
  expects: Verdict[]; attack: boolean; lines: CartLine[]; total_minor: number;
  untrusted_context: string; trace: string[]; merchant_id: string; agent_id: string;
};

export type StepUpView = {
  token: string; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  expires_at: number; seconds_left: number; agent_id: string; mandate_id: string;
  purpose: string; merchant_id: string; amount_minor: number; per_txn_cap_minor: number;
  items: { name: string; description: string; quantity: number; total_minor: number }[];
  verdict: Verdict; reasons: string[]; purpose_risk: number | null;
  resolved_at: number | null; resolved_by: string | null;
  result: Record<string, unknown>;
};

export type StepUpCreated = {
  token: string; expires_at: number; status: string; approve_path: string;
  admission: Admission; ttl_seconds: number;
};

export type StepUpResolved = {
  token: string; status: string; applied: boolean; outcome?: string; charged?: boolean;
  audit_event_seq?: number; admission_event_seq?: number; spent_minor?: number;
  what_happens_next?: string;
};

export type CheckoutStart = {
  order_id: string; amount_minor: number; currency: string; key_id: string;
  test_mode: boolean; notes: Record<string, string>; event_seq: number; note: string;
};

export type CheckoutStatus = {
  order_id: string; cart_id: string; amount_minor: number; payment_id: string | null;
  paid: boolean; test_mode: boolean;
  link: { link_id: string; short_url: string } | null;
  checkout_events: EventRow[]; signature_verified: boolean;
  fact: Record<string, unknown> & { confidence?: string; rail_state?: string; because?: string } | null;
  payment_events: EventRow[];
  observed?: { source: string; signature: string; confidence: string };
  preview_with_webhook: { simulated: boolean; confidence: string; rail_state: string; because: string; note: string } | null;
  webhook_configured: boolean;
  signature_event_seq?: number; payment_event_seq?: number;
};

export type DuelStep = {
  n: number; kind: 'inbound' | 'outbound'; mode: string; title: string; question: string;
  attack: boolean; amount_minor: number; lines?: CartLine[]; reason_text?: string;
  agent_id?: string; session_id?: string;
  ungoverned: { executed: boolean; amount_minor: number; note: string };
  kavach: {
    verdict: string; reasons: string[]; refused_by: string; stages?: Stage[];
    purpose_risk?: number | null; duplicate_risk?: number | null; risk_factors?: string[];
    executed_minor: number; truth?: Record<string, unknown> | null;
  };
  cumulative: DuelTotals;
};

export type DuelTotals = {
  ungoverned_minor: number; kavach_minor: number; ungoverned_unauthorised_minor: number;
  kavach_unauthorised_minor: number; protected_minor: number;
};

export type Duel = {
  steps: DuelStep[]; totals: DuelTotals;
  model_used: { entailment: boolean; duplicate_risk: boolean };
  sandbox: { isolated: boolean; epoch: number; note: string };
  lanes: { ungoverned: string; kavach: string }; generated_at: number;
};

export type TamperResult = {
  target: { seq: number; field: string; original: unknown; mutated: unknown; event_type: string; entity: string };
  before: ChainPage['status']; after: ChainPage['status'];
  rows: { seq: number; event_type: string; source: string; entity: string; stored_hash: string;
          recomputed_hash: string; verified: boolean; is_target: boolean; halted: boolean }[];
  live: { untouched: boolean; status: ChainPage['status'] };
  claims: Record<string, string>; note: string;
};

export type McpTool = { name: string; toolset: string; write: boolean; enabled: boolean; summary: string };
export type McpTools = {
  tools: McpTool[];
  status: { tools: number; read_only: boolean; toolsets: string[]; mode: string };
  suggested_target: { payment_id: string; amount_minor: number; order_id: string } | null;
  duplicate_target: {
    payment_id: string; refund_id: string; amount_minor: number; open_for_seconds: number;
    intent_age_seconds: number; reason_text: string; confidence: string; rail_state: string;
    asks: number;
  } | null;
  seeded_targets: string[];
  config: Record<string, unknown>;
  parity: { toolsets: string[]; flags: string[]; note: string };
};
export type McpCall = {
  tool: string; args: Record<string, unknown>; result: Record<string, unknown>;
  elapsed_ms: number; write: boolean; toolset: string | null;
};

export type HealthPlus = Health & {
  razorpay: { mode: string; credentials: boolean; checkout: boolean; checkout_note: string };
  webhook: { configured: boolean; path: string; note: string };
  mcp: { available: boolean; tools?: number; read_only?: boolean; mode?: string; reason?: string };
  demo: { reset_enabled: boolean };
  uptime_seconds: number;
};

export const journeyApi = {
  health: () => get<HealthPlus>('/health'),
  storefront: () => get<Storefront>('/storefront'),
  plan: (mandate: Mandate, mode: string) => post<Plan>('/storefront/plan', { mandate, mode }),
  admit: api.gateAdmit,
  stepUp: (body: {
    mandate: Mandate; cart_id: string; merchant_id: string; lines: CartLine[];
    untrusted_context?: string;
  }) => post<StepUpCreated>('/stepup', body),
  stepUpView: (token: string) => get<StepUpView>(`/stepup/${encodeURIComponent(token)}`),
  stepUpResolve: (token: string, action: 'approve' | 'deny', resolver = 'principal') =>
    post<StepUpResolved>(`/stepup/${encodeURIComponent(token)}/resolve`, { action, resolver }),
  checkoutStart: (body: {
    cart_id: string; merchant_id: string; lines: CartLine[]; mandate_id: string; agent_id: string;
  }) => post<CheckoutStart>('/checkout', body),
  checkoutLink: (orderId: string) =>
    post<{ link_id: string; short_url: string; reused: boolean }>(`/checkout/${encodeURIComponent(orderId)}/link`, {}),
  checkoutConfirm: (body: { order_id: string; payment_id: string; signature: string }) =>
    post<CheckoutStatus>('/checkout/confirm', body),
  checkoutStatus: (orderId: string) => get<CheckoutStatus>(`/checkout/${encodeURIComponent(orderId)}`),
  checkoutLatest: () => get<{ payment: McpTools['suggested_target'] }>('/checkout/latest'),
  duel: () => get<Duel>('/duel'),
  tamper: (seq?: number) => post<TamperResult>('/proof/tamper', seq ? { seq } : {}),
  mcpTools: () => get<McpTools>('/mcp/tools'),
  mcpCall: (tool: string, args: Record<string, unknown>) =>
    post<McpCall>(`/mcp/${encodeURIComponent(tool)}`, { args }),
  resetDemo: () => post<{ reset: boolean; counts: Record<string, number>; at: number }>('/demo/reset', {}),
};
