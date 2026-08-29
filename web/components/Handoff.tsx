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
import gsap from 'gsap';
import { useScene } from '@/lib/useScene';

const DOORS = [
  {
    href: '/dashboard',
    n: '01',
    t: 'Open the console',
    d: 'The command centre, the obligation ledger, and every decision Kavach has made — derived from the event log, not seeded.',
    cta: 'Command centre',
    primary: true,
  },
  {
    href: '/dashboard/adversary',
    n: '02',
    t: 'Attack it',
    d: 'Eleven scenarios against the real decision code: duplicate refunds, forged mandates, replayed nonces, injected goal drift. Each states what it expects, then reports what happened.',
    cta: 'Adversary lab',
  },
  {
    href: '/dashboard/proof',
    n: '03',
    t: 'Verify it',
    d: 'Recompute the hash chain over the whole event log, and read what it proves — alongside what it deliberately does not.',
    cta: 'Proof & audit',
  },
];

export function Handoff() {
  const ref = useScene<HTMLElement>((q) => {
    gsap.from(q('.door'), {
      scrollTrigger: { trigger: '.handoff__grid', start: 'top 84%' },
      opacity: 0,
      y: 18,
      duration: 0.6,
      stagger: 0.09,
      ease: 'power2.out',
    });
  });

  return (
    <section className="sec" id="enter" ref={ref}>
      <div className="wrap">
        <p className="eyebrow">09 · ENTER</p>
        <h2 className="h2">Everything above is checkable.</h2>
        <p className="lede">
          The console runs against the same governor, the same truth plane and the same
          estimators this page describes. Nothing in it is a mock, and where the environment
          is deterministic it says so on every screen.
        </p>

        <div className="handoff__grid">
          {DOORS.map((d) => (
            <article className="door" key={d.href}>
              <p className="door__n mono">{d.n}</p>
              <h3 className="h3 door__t">{d.t}</h3>
              <p className="door__d">{d.d}</p>
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
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
