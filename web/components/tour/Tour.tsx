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
import { Term } from '@/components/Term';

type Step = {
  id: string; t: string; title: string; body: React.ReactNode; action?: string;
  kind: 'problem' | 'journey' | 'tamper' | 'duel' | 'finale'; focus?: Focus;
  drive?: () => Promise<void> | void;
};

const STEPS: Step[] = [
  { id: 'problem', t: '00:00', title: 'The problem', kind: 'problem',
    body: <>AI agents act faster than any human can check them. One turns up at your checkout holding a <Term k="mandate">permission slip</Term> you have no way to verify. Another sits inside your own dashboard, issuing refunds. Both are acting on things they believe but cannot show you — and neither leaves any proof of what was decided, or why.</> },
  { id: 'mandate', t: '00:30', title: 'Give an agent authority', kind: 'journey', focus: 'mandate',
    body: <>Priya writes a <b><Term k="mandate">mandate</Term></b> — a permission slip in her own words: what it is for, the most she will spend per order, the most for the whole week, which kinds of product, and at which shop. She signs it digitally (<Term k="ed25519">Ed25519</Term>), so it cannot be edited without breaking the seal. Kavach checks that seal before it reads anything inside.</>,
    action: 'Edit the purpose or the limits if you like. The agent will be held to exactly what you write.' },
  { id: 'shop', t: '01:00', title: 'The agent shops', kind: 'journey', focus: 'agent',
    body: <>The agent reads the mandate, narrows the shop down to the categories it was allowed, matches products against Priya&apos;s stated purpose, and fills a cart. The list on the right is what the agent actually did, step by step — not a scripted animation.</>,
    action: 'Watch the agent’s activity list on the right fill up.',
    drive: () => journey.runAgent('legit') },
  { id: 'attack', t: '01:30', title: 'The agent overreaches', kind: 'journey', focus: 'cart',
    body: <>Now the agent misreads “printer paper” as “she needs a printer”, and throws in a desk lamp too: <b>₹7,499 against a ₹5,000 limit</b>. Nothing here is sinister. Every item is a category she allowed, the signature is genuine — the agent was simply too generous with her money.</>,
    action: 'The cart on the right is now over the limit. Next: hand it to Kavach.',
    drive: () => journey.runAgent('cap') },
  { id: 'blocked', t: '02:00', title: 'Kavach blocks it', kind: 'journey', focus: 'verdict',
    body: <>The cart arrives at checkout and Kavach runs its checks in a fixed order: is the signature real, is it still in date, has it been cancelled, has this exact request been seen before, is it the right shop, are these the right categories — and finally, <b>is it within the limit?</b> The last one fails on plain arithmetic. No AI was asked. The refusal says exactly how much over it was and which records it counted.</>,
    action: 'Open “Show the ladder & proof” to see every check and the raw decision.',
    drive: () => journey.submit() },
  { id: 'stepup', t: '02:30', title: 'A human decides the grey case', kind: 'journey', focus: 'stepup',
    body: <>A desk lamp passes every hard rule — right shop, right category, under the limit. But is a lamp really what “paper, pens and notebooks” meant? Kavach is not sure, so it does not guess: it asks Priya, on <b>her own phone</b>. When she taps approve, every check runs again from scratch at that moment, and only then is she charged.</>,
    action: 'Scan the QR code with your phone, or open the approval link, and approve it.',
    drive: async () => { await journey.runAgent('stepup'); await journey.submit(); } },
  { id: 'payment', t: '03:00', title: 'A real payment, in test mode', kind: 'journey', focus: 'checkout',
    body: <>A cart that obeys the mandate is allowed through and charged. Kavach creates a <b>real order in Razorpay&apos;s test mode</b> — real system, no real money — and stamps the decision&apos;s fingerprint onto it, so the reason for this payment is visible from inside Razorpay&apos;s own dashboard. Pay with a test card here, or scan a payment link on your phone.</>,
    action: 'Pay with Netbanking → any bank → Success, or the domestic test card 5267 3181 8797 5449 (any future expiry, any CVV, OTP 1234).',
    drive: async () => {
      await journey.runAgent('legit');
      await journey.submit();
      if (journey.snapshot().admission?.verdict === 'ALLOW') await journey.startCheckout();
    } },
  { id: 'evidence', t: '03:30', title: 'What Kavach believes, and why', kind: 'journey', focus: 'evidence',
    body: <>Kavach <b>saw</b> the payment succeed and checked its signature — but seeing is not the same as being told officially. So it grades this <span className="mono">DERIVED_PROBABLE</span> rather than certain, and will upgrade it the moment Razorpay&apos;s signed <Term k="webhook">confirmation message</Term> lands. Most software would already be calling this “done”.</>,
    action: 'If you paid, the panel below shows where that belief came from, whether it was signed, and how confident Kavach is. If not, the decision above is the evidence.' },
  { id: 'tamper', t: '04:00', title: 'Try to tamper with the evidence', kind: 'tamper',
    body: <>Every record carries a fingerprint of itself <em>and</em> of the record before it — a <Term k="hash-chain">hash chain</Term>. Change one rupee in a <b>copy</b> of the log and the check fails at exactly that row, and at every row after it. Nothing can be edited quietly. Your real log is re-checked alongside, so you can see it is still intact.</>,
    action: 'Press “Tamper with this evidence”.' },
  { id: 'duel', t: '04:30', title: 'Without Kavach, with Kavach', kind: 'duel',
    body: <>The same seven actions, run twice: once with no protection, once through Kavach. The honest actions go through on both sides. The attacks only succeed on the left. Both columns come from one real run of the actual decision code — the totals are what it decided, not numbers we chose.</>,
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
          <p>You give an agent a budget. It goes shopping. It overspends — honestly, not maliciously — and Kavach stops it and tells you exactly why. Then you approve a borderline case from your phone, make a real payment in test mode, look at the evidence behind every decision, and finally try to tamper with that evidence and watch it get caught. No setup, no sign-up, no real money.</p>
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
            <a className="btn" href="/shop">Skip to the Shop</a>
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
      <p>Razorpay has solved how an agent <em>pays</em>. Nobody has solved how a shop decides whether to <em>accept</em> one — or how to stop the shop&apos;s own agents from paying the same person twice.</p>
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
      <p>These are the same failure wearing two hats: an agent acting on something it believes, that the merchant has no way to check, leaving no proof afterwards of what was decided or why. The next nine steps fix it, by doing it.</p>
    </div>
  );
}
