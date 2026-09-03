'use client';

/* The buyer journey, as one store.
 *
 * `/shop` and `/tour` render the same objects and drive the same actions, so the state has
 * to live outside either page. It is a hand-rolled external store (useSyncExternalStore)
 * rather than a library: five actions, one subscription, sessionStorage persistence.
 *
 * TWO RULES, inherited from api.ts:
 *   1. Nothing here invents a verdict. Every phase change follows a response from the
 *      backend, and the activity rail records what the backend returned -- never what a
 *      timer decided to say.
 *   2. Money is integer minor units until format.ts renders it.
 *
 * Polling (step-up on a phone, a payment landing at Razorpay) is bounded by a generation
 * counter: a new action or an unmount bumps it, and any in-flight loop that notices stops.
 */

import { useSyncExternalStore } from 'react';
import { ApiError, journeyApi } from './api';
import type {
  Admission, CartLine, CheckoutStart, CheckoutStatus, Mandate, Plan, Product, StepUpView,
  Storefront,
} from './api';

export type Phase =
  | 'loading' | 'idle' | 'planning' | 'admitting' | 'decided'
  | 'stepup' | 'checkout' | 'paying' | 'paid' | 'error';

export type Activity = {
  id: number; at: number; text: string;
  kind: 'agent' | 'kavach' | 'principal' | 'rail' | 'system' | 'error';
};

export type JourneyState = {
  phase: Phase;
  store: Storefront | null;
  mandate: Mandate | null;
  mode: string;
  plan: Plan | null;
  lines: CartLine[];
  untrusted: string;
  cartId: string | null;
  admission: Admission | null;
  stepup: { token: string; approvePath: string; view: StepUpView | null; expiresAt: number } | null;
  checkout: { order: CheckoutStart; status: CheckoutStatus | null } | null;
  activity: Activity[];
  error: ApiError | null;
  /** spent against the mandate as of the last admission, for the budget meter */
  spentMinor: number;
};

const PERSIST = 'kavach.journey.v1';

const initial: JourneyState = {
  phase: 'loading', store: null, mandate: null, mode: 'legit', plan: null, lines: [],
  untrusted: '', cartId: null, admission: null, stepup: null, checkout: null, activity: [],
  error: null, spentMinor: 0,
};

let state: JourneyState = initial;
const listeners = new Set<() => void>();
let generation = 0;
let nextId = 1;

function emit() {
  for (const l of listeners) l();
  try {
    const { store: _s, activity, ...rest } = state;
    sessionStorage.setItem(PERSIST, JSON.stringify({ ...rest, activity: activity.slice(-40) }));
  } catch { /* private mode, quota, or no window: persistence is a convenience */ }
}

function set(patch: Partial<JourneyState>) {
  state = { ...state, ...patch };
  emit();
}

function log(kind: Activity['kind'], text: string) {
  const entry = { id: nextId++, at: Date.now(), text, kind };
  state = { ...state, activity: [...state.activity, entry].slice(-80) };
  emit();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;
const getServerSnapshot = () => initial;

export function useJourney(): JourneyState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ── helpers ────────────────────────────────────────────────────────────────── */

const now = () => Math.floor(Date.now() / 1000);
const nonce = () => `nonce_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
const cartIdFor = (mode: string) => `cart_${mode}_${Math.random().toString(36).slice(2, 10)}`;

export const cartTotal = (lines: CartLine[]) =>
  lines.reduce((n, l) => n + l.unit_amount_minor * l.quantity, 0);

function failure(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e));
}

function restore(): Partial<JourneyState> | null {
  try {
    const raw = sessionStorage.getItem(PERSIST);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<JourneyState>;
    // A payment or approval in flight cannot be resumed blind; land on the verdict.
    const phase = saved.phase === 'paying' || saved.phase === 'stepup' ? 'decided' : saved.phase;
    return { ...saved, phase: phase === 'loading' || phase === 'error' ? 'idle' : phase };
  } catch {
    return null;
  }
}

/* ── actions ────────────────────────────────────────────────────────────────── */

export const journey = {
  /** Fetch the storefront once; keep whatever the session already had. */
  async load() {
    if (state.store) return;
    try {
      const store = await journeyApi.storefront();
      const saved = restore();
      const mandate = saved?.mandate ?? store.mandate;
      state = { ...state, ...saved, store, mandate, phase: saved?.phase ?? 'idle', error: null };
      if (!saved) log('system', `Storefront loaded · ${store.products.length} products at ${store.merchant_id}`);
      emit();
    } catch (e) {
      set({ phase: 'error', error: failure(e) });
    }
  },

  setMandate(patch: Partial<Mandate>) {
    if (!state.mandate) return;
    set({ mandate: { ...state.mandate, ...patch } });
  },

  setMode(mode: string) { set({ mode }); },

  /** The agent plans a cart for the chosen mode. Deterministic; the trace is the plan's. */
  async runAgent(mode = state.mode) {
    if (!state.mandate) return;
    generation++;
    set({ phase: 'planning', mode, admission: null, stepup: null, checkout: null, error: null });
    log('principal', `Mandate ${state.mandate.mandate_id} handed to ${state.mandate.agent_id}`);
    try {
      const plan = await journeyApi.plan(state.mandate, mode);
      for (const line of plan.trace) log('agent', line);
      set({ plan, lines: plan.lines, untrusted: plan.untrusted_context, cartId: cartIdFor(mode), phase: 'idle' });
    } catch (e) {
      set({ phase: 'error', error: failure(e) });
      log('error', failure(e).message);
    }
  },

  /** Manual edits: the judge is the agent's hands. */
  addProduct(p: Product, quantity = 1) {
    const existing = state.lines.find((l) => l.sku === p.sku);
    const lines = existing
      ? state.lines.map((l) => (l.sku === p.sku ? { ...l, quantity: l.quantity + quantity } : l))
      : [...state.lines, { sku: p.sku, name: p.name, description: p.description, category: p.category,
                           unit_amount_minor: p.unit_amount_minor, quantity, liquid: p.liquid }];
    set({ lines, cartId: state.cartId ?? cartIdFor('manual'), admission: null, stepup: null, checkout: null,
          phase: state.phase === 'decided' || state.phase === 'paid' ? 'idle' : state.phase });
    log('agent', `Added ${p.name} × ${quantity} to the cart`);
  },

  setQuantity(sku: string, quantity: number) {
    const lines = quantity <= 0
      ? state.lines.filter((l) => l.sku !== sku)
      : state.lines.map((l) => (l.sku === sku ? { ...l, quantity } : l));
    set({ lines, admission: null, stepup: null, checkout: null, phase: 'idle' });
  },

  setUntrusted(text: string) { set({ untrusted: text }); },

  /** Present the mandate at checkout. ALLOW charges it; STEP_UP asks the principal. */
  async submit() {
    const { mandate, lines } = state;
    if (!mandate || !lines.length) return;
    generation++;
    const gen = generation;
    const cartId = state.cartId ?? cartIdFor(state.mode);
    const envelope = { ...mandate, nonce: nonce(), issued_at: now() - 60 };
    set({ phase: 'admitting', cartId, mandate: envelope, admission: null, stepup: null, checkout: null, error: null });
    log('agent', `Presenting mandate at ${mandate.merchant_allowlist[0]} · cart ${cartId}`);
    log('kavach', 'Intercepting the purchase intent');
    try {
      const admission = await journeyApi.admit({
        mandate: envelope, cart_id: cartId, merchant_id: mandate.merchant_allowlist[0],
        lines: lines.map(({ name: _n, ...l }) => l), untrusted_context: state.untrusted, commit: true,
      });
      if (gen !== generation) return;
      for (const s of admission.stages) {
        if (s.state === 'PASS') continue;
        log('kavach', `${s.label}: ${s.state} — ${s.detail}`);
      }
      log('kavach', `Decision: ${admission.verdict}`);
      const spent = admission.charged_to_mandate ? state.spentMinor + admission.cart.total_minor : state.spentMinor;
      set({ admission, phase: 'decided', spentMinor: spent });
      if (admission.verdict === 'STEP_UP' || admission.verdict === 'HOLD') {
        await journey.openStepUp();
      }
    } catch (e) {
      if (gen !== generation) return;
      set({ phase: 'error', error: failure(e) });
      log('error', failure(e).message);
    }
  },

  /** Mint the re-consent token and start watching for the principal's answer. */
  async openStepUp() {
    const { mandate, lines, cartId } = state;
    if (!mandate || !cartId) return;
    const gen = generation;
    try {
      const created = await journeyApi.stepUp({
        mandate, cart_id: cartId, merchant_id: mandate.merchant_allowlist[0],
        lines: lines.map(({ name: _n, ...l }) => l), untrusted_context: state.untrusted,
      });
      if (gen !== generation) return;
      set({ phase: 'stepup', stepup: { token: created.token, approvePath: created.approve_path, view: null, expiresAt: created.expires_at } });
      log('kavach', `Re-consent requested from ${mandate.principal_id} · expires in ${created.ttl_seconds / 60} min`);
      journey.watchStepUp();
    } catch (e) {
      if (gen !== generation) return;
      set({ phase: 'error', error: failure(e) });
      log('error', failure(e).message);
    }
  },

  watchStepUp() {
    const gen = generation;
    const tick = async () => {
      if (gen !== generation || !state.stepup) return;
      try {
        const view = await journeyApi.stepUpView(state.stepup.token);
        if (gen !== generation || !state.stepup) return;
        set({ stepup: { ...state.stepup, view } });
        if (view.status === 'PENDING') {
          if (!document.hidden) setTimeout(tick, 2000); else setTimeout(tick, 5000);
          return;
        }
        if (view.status === 'APPROVED') {
          log('principal', `${view.resolved_by ?? 'principal'} approved on their device`);
          log('kavach', 'Re-ran admission at the moment of approval; mandate charged');
          set({ phase: 'checkout', spentMinor: (view.result?.spent_minor as number | undefined) ?? state.spentMinor });
          void journey.startCheckout();
        } else if (view.status === 'DENIED') {
          log('principal', `${view.resolved_by ?? 'principal'} denied on their device`);
          set({ phase: 'decided' });
        } else {
          log('system', 'The approval request expired without an answer');
          set({ phase: 'decided' });
        }
      } catch (e) {
        if (gen !== generation) return;
        log('error', failure(e).message);
        setTimeout(tick, 4000);
      }
    };
    void tick();
  },

  /** The admitted cart becomes a real Razorpay TEST order. */
  async startCheckout() {
    const { mandate, lines, cartId } = state;
    if (!mandate || !cartId) return;
    generation++;
    const gen = generation;
    set({ error: null });
    log('rail', 'Creating a Razorpay TEST order for the admitted cart');
    try {
      const order = await journeyApi.checkoutStart({
        cart_id: cartId, merchant_id: mandate.merchant_allowlist[0],
        lines: lines.map(({ name: _n, ...l }) => l), mandate_id: mandate.mandate_id,
        agent_id: mandate.agent_id,
      });
      if (gen !== generation) return;
      set({ phase: 'checkout', checkout: { order, status: null } });
      log('rail', `Order ${order.order_id} created · notes carry the admission hash`);
      return order;
    } catch (e) {
      if (gen !== generation) return;
      set({ error: failure(e) });
      log('error', failure(e).message);
    }
  },

  async confirmCheckout(resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const gen = generation;
    set({ phase: 'paying' });
    log('rail', `Checkout returned ${resp.razorpay_payment_id} with a signature`);
    try {
      const status = await journeyApi.checkoutConfirm({
        order_id: resp.razorpay_order_id, payment_id: resp.razorpay_payment_id,
        signature: resp.razorpay_signature,
      });
      if (gen !== generation || !state.checkout) return;
      log('kavach', 'Checkout signature verified (HMAC over order_id|payment_id)');
      log('kavach', `Payment observed by API response · ${status.observed?.confidence ?? 'unknown confidence'}`);
      set({ phase: 'paid', checkout: { ...state.checkout, status } });
    } catch (e) {
      if (gen !== generation) return;
      set({ phase: 'checkout', error: failure(e) });
      log('error', failure(e).message);
    }
  },

  async payOnPhone() {
    if (!state.checkout) return;
    const gen = generation;
    try {
      const link = await journeyApi.checkoutLink(state.checkout.order.order_id);
      if (gen !== generation || !state.checkout) return;
      log('rail', `Payment Link ${link.link_id} ready for a phone`);
      journey.watchCheckout();
      return link;
    } catch (e) {
      if (gen !== generation) return;
      set({ error: failure(e) });
      log('error', failure(e).message);
    }
  },

  watchCheckout() {
    const gen = generation;
    const tick = async () => {
      if (gen !== generation || !state.checkout) return;
      try {
        const status = await journeyApi.checkoutStatus(state.checkout.order.order_id);
        if (gen !== generation || !state.checkout) return;
        set({ checkout: { ...state.checkout, status } });
        if (status.paid) {
          log('rail', `Payment ${status.payment_id} observed · ${status.observed?.confidence}`);
          set({ phase: 'paid' });
          return;
        }
        setTimeout(tick, document.hidden ? 6000 : 3000);
      } catch (e) {
        if (gen !== generation) return;
        log('error', failure(e).message);
        setTimeout(tick, 6000);
      }
    };
    void tick();
  },

  async refreshCheckout() {
    if (!state.checkout) return;
    try {
      const status = await journeyApi.checkoutStatus(state.checkout.order.order_id);
      set({ checkout: { ...state.checkout, status }, phase: status.paid ? 'paid' : state.phase });
    } catch (e) {
      set({ error: failure(e) });
    }
  },

  /** Stop every loop. Called on unmount. */
  stop() { generation++; },

  /** Back to an empty cart under the same mandate. */
  clear() {
    generation++;
    set({ phase: 'idle', plan: null, lines: [], untrusted: '', cartId: null, admission: null, stepup: null, checkout: null, error: null });
    log('system', 'Cart cleared');
  },

  /** The judge's button: re-seed the ledger and forget this session. */
  async resetDemo() {
    generation++;
    try {
      const out = await journeyApi.resetDemo();
      const store = state.store;
      state = { ...initial, store, mandate: store?.mandate ?? null, phase: 'idle', activity: [] };
      try { sessionStorage.removeItem(PERSIST); } catch { /* fine */ }
      emit();
      log('system', `Demo reset · ${out.counts.events} events, ${out.counts.intents} intents re-seeded`);
      return out;
    } catch (e) {
      set({ error: failure(e) });
      log('error', failure(e).message);
    }
  },
};
