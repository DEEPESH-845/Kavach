'use client';

/* The product in one line, between the hero and the argument.
 *
 *   Buyer → Mandate → Agent → Action → Governor → Evidence → Verdict → Payment → Proof
 *
 * Every node is a door into the tour step that demonstrates it. The strip lights up left
 * to right as it enters the viewport -- the only motion is the order things happen in.
 */

import gsap from 'gsap';
import { useScene } from '@/lib/useScene';
import { Term } from '@/components/Term';

const NODES: { k: string; t: string; d: string; step: number; tone?: 'steel' | 'amber' | 'bone' | 'oxide' | 'jade' }[] = [
  { k: 'buyer', t: 'Buyer', d: 'Priya, with a card and no time', step: 1 },
  { k: 'mandate', t: 'Mandate', d: 'what she allows: purpose, limit, deadline — signed', step: 1, tone: 'steel' },
  { k: 'agent', t: 'Agent', d: 'shops within it — or past it', step: 2 },
  { k: 'action', t: 'Action', d: 'a cart, presented at checkout', step: 3 },
  { k: 'governor', t: 'Kavach', d: 'runs every check, strongest rule first', step: 4, tone: 'bone' },
  { k: 'evidence', t: 'Evidence', d: 'each check records what it looked at', step: 4, tone: 'steel' },
  { k: 'verdict', t: 'Verdict', d: 'allow it, ask a human, or refuse', step: 5, tone: 'amber' },
  { k: 'payment', t: 'Payment', d: 'Razorpay test mode — no real money', step: 6, tone: 'jade' },
  { k: 'proof', t: 'Proof', d: 'a tamper-evident log — try to break it', step: 8, tone: 'steel' },
];

export function JourneyStrip() {
  const ref = useScene<HTMLElement>((q, root) => {
    gsap.set(q('.js__node'), { opacity: 0.25, y: 8 });
    gsap.set(q('.js__line'), { scaleX: 0 });
    gsap.timeline({ scrollTrigger: { trigger: root, start: 'top 78%' } })
      .to(q('.js__line'), { scaleX: 1, duration: 1.1, ease: 'power2.inOut' }, 0)
      .to(q('.js__node'), { opacity: 1, y: 0, duration: 0.5, stagger: 0.11, ease: 'power2.out' }, 0.1);
  });

  return (
    <section className="sec js" id="journey" ref={ref} aria-label="The journey">
      <div className="wrap">
        <p className="eyebrow">Start here — what Kavach actually is</p>
        <p className="plain">
          <b>In plain English</b>
          An <Term k="agent">AI agent</Term> is a program that shops, pays or issues refunds on
          someone’s behalf, without a person clicking each step. Kavach sits between that agent
          and your money. Before anything moves it checks three things — <em>who</em> authorised
          this (the buyer’s signed <Term k="mandate">permission slip</Term>), <em>what</em> is
          really in the cart, and <em>what you already owe</em> — then does one of three things:
          allow it, stop and ask a human, or refuse. Whichever it picks, it writes down the
          reason and the evidence, so you can check the decision later.
        </p>
        <p className="eyebrow" style={{ marginTop: '2.4em' }}>
          What you can do on this site, in the order it happens
        </p>
        <div className="js__track">
          <i className="js__line" aria-hidden />
          <ol className="js__nodes">
            {NODES.map((n, i) => (
              <li key={n.k} className="js__node" data-tone={n.tone}>
                <a href={`/tour/?step=${n.step}`} className="js__link" aria-label={`${n.t}: ${n.d}. Opens tour step ${n.step}`}>
                  <span className="js__n mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="js__t">{n.t}</span>
                  <span className="js__d">{n.d}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
        <p className="note">
          Five minutes, ten steps, nothing to set up. Nothing here is a mock-up: every decision
          you see is made by the real code, every payment runs in Razorpay’s test mode (no real
          money), and every step is written into a tamper-evident{' '}
          <Term k="hash-chain">log</Term> you can try to break yourself at the end.
        </p>
      </div>
    </section>
  );
}
