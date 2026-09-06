'use client';

/* The handoff from argument to product.
 *
 * The landing page spends eight sections making a case. This is where the reader stops
 * being told and starts checking — so it offers three doors rather than one generic CTA,
 * ordered by how sceptical the reader is:
 *
 *   believe it     -> the console, with the real ledger in it
 *   test it        -> the adversary lab, where they attack it themselves
 *   verify it      -> the proof chain, recomputed in front of them
 *
 * It replaced a single centre-aligned button with hardcoded colours that did not belong to
 * either design system.
 */

import Link from 'next/link';
import { useScene } from '@/lib/useScene';
import { Kinetic } from '@/components/Kinetic';
import { rise } from '@/lib/scroll';
import { useMagnetic } from '@/lib/magnetic';

const DOORS = [
  {
    href: '/tour',
    n: '01',
    t: 'Take the five-minute tour',
    d: 'Hand an agent a budget, watch it try to spend beyond it, watch Kavach stop it, approve the borderline case on your phone, pay for real in test mode — then try to tamper with the evidence and see it caught.',
    cta: 'Start the demo',
    primary: true,
  },
  {
    href: '/shop',
    n: '02',
    t: 'Shop through an agent',
    d: 'A working shop, one buyer’s budget, and an agent with six ways to shop — one honest, and five that a simple spending limit would happily wave through.',
    cta: 'Open the Shop',
  },
  {
    href: '/dashboard',
    n: '03',
    t: 'Run the merchant side',
    d: 'The merchant’s control room: what money is still owed, what is waiting on a human, the tools agents can call, eleven ways to attack the system, and the tamper-check run live in front of you.',
    cta: 'Command centre',
  },
];

export function Handoff() {
  // one magnetic button on this page, and it is the one that opens the product
  const mag = useMagnetic<HTMLSpanElement>();
  const ref = useScene<HTMLElement>((q) => {
    rise(q('.door'), { trigger: '.handoff__grid', start: 'top 84%', stagger: 0.09 });
  });

  return (
    <section className="sec" id="enter" ref={ref}>
      <div className="wrap">
        <p className="eyebrow">11 · ENTER</p>
        <Kinetic text="Everything above is *checkable* — by doing it." />
        <p className="lede">
          Everything behind these three doors runs the same code this page has been describing —
          the same rules, the same checks, the same models. Nothing is a mock-up. Where a screen
          is showing a fixed demo instead of live data, it says so on the screen.
        </p>

        <div className="handoff__grid">
          {DOORS.map((d) => (
            <article className="door" key={d.href}>
              <p className="door__n mono">{d.n}</p>
              <h3 className="h3 door__t">{d.t}</h3>
              <p className="door__d">{d.d}</p>
              <span className="mag" ref={d.primary ? mag : undefined}>
                <Link
                  className={`btn${d.primary ? ' btn--primary' : ''}`}
                  href={d.href}
                  onMouseMove={(e) => {
                    // The button fills from wherever the pointer entered it -- the same seam
                    // gesture the rest of the page uses, so the CTA is not a foreign object.
                    const r = e.currentTarget.getBoundingClientRect();
                    e.currentTarget.style.setProperty('--ox', `${((e.clientX - r.left) / r.width) * 100}%`);
                  }}
                >
                  <span>{d.cta} →</span>
                </Link>
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
