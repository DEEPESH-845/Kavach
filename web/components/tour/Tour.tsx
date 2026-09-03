'use client';

/* The five-minute path.
 *
 * Each step mounts a real surface and, where the story needs the agent to have acted,
 * drives the journey store the way a judge's click would. Nothing shown is a recording:
 * the verdicts on screen were produced when the step opened.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Play } from 'lucide-react';
import { journey, useJourney } from '@/lib/journey';
import { Journey } from '@/components/bazaar/Journey';
import type { Focus } from '@/components/bazaar/Journey';
import { Duel } from '@/components/duel/Duel';
import { Tamper } from '@/components/proof/Tamper';
import { Finale } from './Finale';

type Step = {
  id: string; t: string; title: string; body: React.ReactNode; action?: string;
  kind: 'problem' | 'journey' | 'tamper' | 'duel' | 'finale'; focus?: Focus;
  drive?: () => Promise<void> | void;
};

const STEPS: Step[] = [
  { id: 'problem', t: '00:00', title: 'The problem', kind: 'problem',
    body: <>AI agents can act faster than humans can review them. One arrives at your checkout holding a mandate you cannot verify; one sits inside your dashboard moving money out. Both act on beliefs you cannot check — and leave no proof of what was decided.</> },
  { id: 'mandate', t: '00:30', title: 'Give an agent authority', kind: 'journey', focus: 'mandate',
    body: <>Priya writes a <b>mandate</b>: a purpose in her own words, a cap per order, a cap for the week, the categories she delegates, and a merchant. It is signed with Ed25519. Everything downstream is arithmetic on these fields — so the signature is checked first, over the raw bytes.</>,
    action: 'Edit the purpose or the caps if you like. The agent will be held to whatever you write.' },
  { id: 'shop', t: '01:00', title: 'The agent shops', kind: 'journey', focus: 'agent',
    body: <>A bench agent reads the mandate, filters the store to the delegated categories, matches products to the purpose text and fills a cart. The activity rail shows only what actually happened — it is the agent&apos;s plan, not a typing effect.</>,
    action: 'Watch the agent rail on the right fill with the plan.',
    drive: () => journey.runAgent('legit') },
  { id: 'attack', t: '01:30', title: 'The agent overreaches', kind: 'journey', focus: 'cart',
    body: <>Now the agent misreads “printer paper” as needing a printer and bundles a desk lamp with it: <b>₹7,499 against a ₹5,000 cap</b>. Every item is in scope. The signature is valid. Only the arithmetic is wrong.</>,
    action: 'The cart on the right is over the cap. Next: present it to Kavach.',
    drive: () => journey.runAgent('cap') },
  { id: 'blocked', t: '02:00', title: 'Kavach blocks it', kind: 'journey', focus: 'verdict',
    body: <>The mandate is presented at checkout and the admission ladder runs — signature, issuer, window, binding, revocation, replay, merchant, scope, <b>caps</b>. The cap rung fails by integer arithmetic; no model was consulted. The refusal names the exact excess and cites the events it counted.</>,
    action: 'Open “Show the ladder & proof” to see every rung and the raw admission.',
    drive: () => journey.submit() },
  { id: 'stepup', t: '02:30', title: 'A human decides the grey case', kind: 'journey', focus: 'stepup',
    body: <>A desk lamp passes every deterministic check, but the entailment model is not sure it is what “paper, pens and notebooks” meant. Rather than guess, Kavach asks Priya — on <b>her own phone</b>. Approval re-runs admission at the moment of the tap; only then is the mandate charged.</>,
    action: 'Scan the QR with a phone, or open the approval page from the link, and approve.',
    drive: async () => { await journey.runAgent('stepup'); await journey.submit(); } },
  { id: 'payment', t: '03:00', title: 'A real payment, in test mode', kind: 'journey', focus: 'checkout',
    body: <>A compliant cart is admitted and the mandate charged. Kavach creates a <b>real Razorpay TEST order</b> whose notes carry the admission&apos;s hash — the decision is visible from Razorpay&apos;s own dashboard. Pay with a test card in the Checkout modal, or scan a Payment Link on a phone.</>,
    action: 'Pay with card 4111 1111 1111 1111 (any future expiry, any CVV), or UPI success@razorpay.',
    drive: async () => {
      await journey.runAgent('legit');
      await journey.submit();
      if (journey.snapshot().admission?.verdict === 'ALLOW') await journey.startCheckout();
    } },
  { id: 'evidence', t: '03:30', title: 'What Kavach believes, and why', kind: 'journey', focus: 'evidence',
    body: <>The payment was <b>observed</b> through an API response and the checkout signature verified — so the truth plane grades it <span className="mono">DERIVED_PROBABLE</span>, not certain. A signed webhook would upgrade it. Kavach does not confuse “we saw something” with “we can prove it”.</>,
    action: 'If you paid, the truth panel shows the observed source, the signature and the confidence. If not, the verdict and ladder above are the evidence.' },
  { id: 'tamper', t: '04:00', title: 'Try to tamper with the evidence', kind: 'tamper',
    body: <>Every event carries a SHA-256 over its own fields and its predecessor&apos;s hash. Edit one amount in a <b>copy</b> of the log and verification breaks at exactly that row — and halts for everything after it. The live ledger is re-verified beside the result.</>,
    action: 'Press “Tamper with this evidence”.' },
  { id: 'duel', t: '04:30', title: 'Without Kavach, with Kavach', kind: 'duel',
    body: <>The same seven actions in two lanes, from one sandbox run of the real decision code. The legitimate actions pass in both lanes; the attacks execute only on the left. The counters are sums of what the code decided, not marketing numbers.</>,
    action: 'Let it play, or step through.' },
  { id: 'finale', t: '05:00', title: 'The thesis', kind: 'finale',
    body: <>Agents need authority. Authority needs boundaries. Boundaries need evidence.</> },
];

export function Tour() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = Math.max(0, Math.min(STEPS.length - 1, Number(params.get('step') ?? 0) || 0));
  const [i, setI] = useState(initial);
  const [started, setStarted] = useState(initial > 0);
  const [resetting, setResetting] = useState(false);
  const driven = useRef<string | null>(null);
  const j = useJourney();
  const step = STEPS[i];

  const go = useCallback((n: number) => {
    const k = Math.max(0, Math.min(STEPS.length - 1, n));
    setI(k);
    setStarted(true);
    router.replace(`/tour/?step=${k}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, go]);

  // Drive the journey once per step entry, and only once the store has loaded.
  useEffect(() => {
    if (!started || !step.drive || !j.store || driven.current === step.id) return;
    driven.current = step.id;
    void step.drive();
  }, [started, step, j.store]);

  useEffect(() => { void journey.load(); }, []);

  if (!started) {
    return (
      <div className="tr-wrap">
        <div className="tr-problem" style={{ padding: 'clamp(30px, 8vh, 80px) 0' }}>
          <p className="fn-eyebrow mono" style={{ margin: 0, fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--fog2)' }}>Five minutes · ten steps · nothing to configure</p>
          <h1>What happens when an AI agent is allowed to buy things on your behalf?</h1>
          <p>Give an agent authority, watch it shop, watch it overreach, watch Kavach intervene — and see why — then approve the grey case on your phone, make a real test payment, inspect the evidence, and try to tamper with it.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn--primary" style={{ padding: '14px 22px', fontSize: 15 }} disabled={resetting}
              onClick={async () => {
                // A judge's run starts from a known ledger. Reset is env-gated; when it is
                // off the tour simply starts where the ledger is.
                setResetting(true);
                await journey.resetDemo();
                setResetting(false);
                driven.current = null;
                go(0);
              }}><Play size={15} /> {resetting ? 'Resetting the ledger…' : 'Start the five-minute demo'}</button>
            <a className="btn" href="/shop">Skip to the Bazaar</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tr-wrap">
      <div className="tr-grid">
        <nav className="tr-rail" aria-label="Tour steps">
          <div className="tr-progress" aria-hidden><i style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
          {STEPS.map((s, n) => (
            <button key={s.id} className="tr-step" aria-current={n === i ? 'step' : undefined} data-done={n < i || undefined} onClick={() => go(n)}>
              <span className="tr-t">{s.t}</span>
              <span>{s.title}</span>
            </button>
          ))}
        </nav>

        <div style={{ minWidth: 0 }}>
          <div className="tr-narr" role="status" aria-live="polite">
            <span className="tr-time">{step.t}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              {step.action ? <p className="tr-do">→ {step.action}</p> : null}
            </div>
            <button className="btn btn--primary" onClick={() => go(i + 1)} disabled={i === STEPS.length - 1}>Next <ArrowRight size={13} /></button>
          </div>

          {step.kind === 'problem' ? <Problem /> : null}
          {step.kind === 'journey' ? <Journey focus={step.focus} compact expand={step.id === 'blocked'} /> : null}
          {step.kind === 'tamper' ? <Tamper /> : null}
          {step.kind === 'duel' ? <Duel compact autoplay /> : null}
          {step.kind === 'finale' ? <Finale /> : null}
        </div>
      </div>

      <div className="tr-bar">
        <button className="btn btn--sm" onClick={() => go(i - 1)} disabled={i === 0}><ArrowLeft size={12} /> Back</button>
        <span className="tr-pos">{step.t} · step {i + 1} of {STEPS.length} · ← → keys</span>
        <span className="tr-spacer" />
        <button className="btn btn--primary btn--sm" onClick={() => go(i + 1)} disabled={i === STEPS.length - 1}>Next <ArrowRight size={12} /></button>
      </div>
    </div>
  );
}

function Problem() {
  return (
    <div className="tr-problem">
      <h1>Agents now stand on both sides of the counter.</h1>
      <p>Razorpay shipped how an agent <em>pays</em>. Nobody shipped how a merchant decides whether to <em>accept</em> one — or how to stop the merchant&apos;s own agents from paying twice.</p>
      <div className="tr-two">
        <div className="tr-quote">
          <b>Inbound — an agent arrives at checkout</b>
          “Weekly groceries under ₹2,000, here’s my mandate.” The cart holds milk, dal, and a <span className="mono">₹1,800 gift card</span>. In category. Under the cap. Not what anyone asked for.
        </div>
        <div className="tr-quote">
          <b>Outbound — an agent moves the merchant’s money</b>
          <span className="mono">create_refund → 200 OK, status: processing</span>. The agent reports “done”. The customer is not credited for days, complains, and the agent forms a <em>new</em> intent: refund again.
        </div>
      </div>
      <p>Both are one failure: an agent acting on a belief the merchant cannot verify, with no proof afterwards of what was decided or why. The next nine steps show the answer by doing it.</p>
    </div>
  );
}
