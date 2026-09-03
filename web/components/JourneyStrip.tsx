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

const NODES: { k: string; t: string; d: string; step: number; tone?: 'steel' | 'amber' | 'bone' | 'oxide' | 'jade' }[] = [
  { k: 'buyer', t: 'Buyer', d: 'Priya, with a card and no time', step: 1 },
  { k: 'mandate', t: 'Mandate', d: 'purpose · caps · scope · window, Ed25519-signed', step: 1, tone: 'steel' },
  { k: 'agent', t: 'Agent', d: 'shops within it — or past it', step: 2 },
  { k: 'action', t: 'Action', d: 'a cart, presented at checkout', step: 3 },
  { k: 'governor', t: 'Kavach', d: 'the eleven-rung admission ladder', step: 4, tone: 'bone' },
  { k: 'evidence', t: 'Evidence', d: 'every rung cites what it read', step: 4, tone: 'steel' },
  { k: 'verdict', t: 'Verdict', d: 'ALLOW · STEP-UP · DENY', step: 5, tone: 'amber' },
  { k: 'payment', t: 'Payment', d: 'Razorpay, test mode, hash in the notes', step: 6, tone: 'jade' },
  { k: 'proof', t: 'Proof', d: 'a hash chain you can try to break', step: 8, tone: 'steel' },
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
        <p className="eyebrow">What you can do on this site, in the order it happens</p>
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
          Five minutes, ten steps, nothing to configure. Every verdict on the way is the real
          admission path; every payment is Razorpay test mode; every event is in the hash chain.
        </p>
      </div>
    </section>
  );
}
