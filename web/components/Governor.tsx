'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStill } from '@/lib/motion';
import { useScene } from '@/lib/useScene';
import { POLICY } from '@/lib/data';
import { money } from '@/lib/util';

gsap.registerPlugin(ScrollTrigger);

/* CHAPTER 05 — the climax, and the only section on the page with nothing to click.
 *
 * Everything above it produced an input. This is where the four of them are made to
 * meet, in the order the code actually consults them, and the meeting is the whole
 * composition: four hairlines dropping onto one bus bar, one drop into the governor,
 * one decision out the bottom. The bus bar IS the convergence — no element travels
 * toward another, so the scene has no geometry to recompute on resize and reverses
 * exactly by running the same timeline backwards.
 *
 * Motion here is DECISIVE, per the section's semantics: nothing drifts, nothing
 * eases out slowly, and the rungs strike downward one at a time in the governor's
 * own strongest-first order. The two that fire do not flash or pulse — an invariant
 * that begs for attention is an invariant nobody trusts.
 *
 * The numbers are the same transaction the page opened with, and the reason strings
 * are the governor's own, formatted by the same `money()` the Python formats with.
 */

const INPUTS = [
  { k: 'steel', t: 'TRUTH',      v: 'rail PROCESSING',  s: 'obligation OPEN · evidence [12, 17]' },
  { k: 'steel', t: 'OBLIGATION', v: '₹5,000 open',      s: 'age 04:12:00 · tolerance 06:00:00' },
  { k: 'amber', t: 'RISK',       v: '0.951',            s: 'duplicate-risk · advisory only' },
  { k: 'bone',  t: 'POLICY',     v: 'caps + tiers',     s: 'autonomous ₹1,000 · session ₹5,000' },
] as const;

/* governor.decide, consulted in order. The two that fire are the two that fire for
   this intent: a duplicate-risk score over the threshold, and an amount over the
   autonomous limit. Neither can be waved through by the other. */
const RUNGS = [
  { n: '1', t: 'accounting invariants', s: 'captured · ₹5,000 ≤ ₹50,000', f: 'pass' },
  { n: '2', t: 'permission tier',       s: 'write tier',                   f: 'pass' },
  { n: '3', t: 'truth confidence',      s: 'DERIVED_CERTAIN',              f: 'pass' },
  { n: '4', t: 'duplicate-risk model',  s: '0.95 ≥ 0.50',                  f: 'escalate' },
  { n: '5', t: 'caps',                  s: 'autonomous limit',             f: 'escalate' },
] as const;

const REASONS = [
  `duplicate-risk 0.95 >= ${POLICY.risk_threshold.toFixed(2)}: this intent resembles an `
  + 'obligation already in flight',
  `amount ${money(5_000_00)} exceeds the autonomous limit of `
  + `${money(POLICY.max_auto_refund_minor)}`,
];

export function Governor() {
  const still = useStill();

  const ref = useScene<HTMLElement>((q, root) => {
    /* THE HIDDEN STATE, SET ONCE, UP FRONT.
     *
     * Never `gsap.from` with a stagger: a staggered `from` renders only its first
     * sub-tween at time zero, so three of these four inputs would be sitting on the
     * screen the question is supposed to have entirely to itself, and would then blink
     * out as the tween reached them. Setting the start state on the whole group and
     * tweening TO the finished one is the same motion, reverses the same way, and is
     * actually hidden before it is revealed. */
    gsap.set(q('.gov__in'),     { opacity: 0, y: -22 });
    gsap.set(q('.gov__lead'),   { scaleY: 0 });
    gsap.set(q('.gov__rung'),   { opacity: 0, x: -14 });
    gsap.set(q('.gov__why li'), { opacity: 0, x: -12 });

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: root, start: 'top top', end: 'bottom bottom',
        scrub: 0.5, invalidateOnRefresh: true,
      },
    });
    tl.to({}, { duration: 1 }, 0);                       // the timeline is 1 unit long

    /* The question is already on screen when the section pins — it arrives with the
       previous chapter's exit rather than fading up out of nothing — and then holds an
       otherwise empty viewport for the first fifth of the scroll. It is the only screen
       on the page with one sentence and nothing else, and it earns that by being the
       question every plane above it has been answering a piece of. It leaves upward,
       the way the reader is about to travel, because the answer is below it. */
    tl.to(q('.gov__q'), { opacity: 0, y: -34, duration: 0.07 }, 0.20);

    // inputs arrive downward: they are being handed IN to something below them
    // the handover overlaps the question's exit, or the scroll passes through a
    // frame holding nothing at all
    tl.from(q('.gov__eyebrow'), { opacity: 0, duration: 0.05 }, 0.22)
      .to(q('.gov__in'), { opacity: 1, y: 0, duration: 0.06, stagger: 0.026 }, 0.24);

    // the hairlines drop, the bus collects them, one line continues down. Origin top on
    // every one, so the convergence has a direction rather than merely a shape.
    tl.to(q('.gov__lead'), { scaleY: 1, duration: 0.05, stagger: 0.022 }, 0.38)
      .from(q('.gov__bus'),  { scaleX: 0, duration: 0.06 }, 0.44)
      .from(q('.gov__drop'), { scaleY: 0, duration: 0.04 }, 0.49);

    // the governor does not fade in. It is already the frame; it becomes legible.
    tl.from(q('.gov__box'), { opacity: 0, scaleY: 0.82, duration: 0.06 }, 0.52)
      .to(q('.gov__rung'), { opacity: 1, x: 0, duration: 0.045, stagger: 0.032 }, 0.58);

    tl.from(q('.gov__exit'), { scaleY: 0, duration: 0.04 }, 0.78)
      .from(q('.gov__out'),  { opacity: 0, y: -16, duration: 0.05 }, 0.81)
      .to(q('.gov__why li'), { opacity: 1, x: 0, duration: 0.05, stagger: 0.035 }, 0.87);

    // the header's chapter readout follows the beat, the way the stage's does
    ScrollTrigger.create({
      trigger: root, start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => {
        const p = self.progress;
        root.dataset.beat = p < 0.24 ? 'GOVERNOR' : p < 0.52 ? 'EVIDENCE'
          : p < 0.80 ? 'THE LADDER' : 'DECISION';
      },
      onLeave: () => { delete root.dataset.beat; },
      onLeaveBack: () => { delete root.dataset.beat; },
    });
  });

  return (
    <section className="gov" id="governor" ref={ref} data-still={still || undefined}>
      <div className="gov__sticky">
        <div className="wrap gov__in-wrap">
          <p className="gov__q">What is this agent allowed to do?</p>

          <div className="gov__rig">
            <p className="eyebrow gov__eyebrow">05 — four inputs, one order, strongest first</p>

            <ul className="gov__inputs">
              {INPUTS.map((i) => (
                <li className="gov__in" key={i.t} data-k={i.k}>
                  <span className="gov__in-t">{i.t}</span>
                  <span className="gov__in-v mono">{i.v}</span>
                  <span className="gov__in-s">{i.s}</span>
                  <i className="gov__lead" aria-hidden />
                </li>
              ))}
            </ul>

            <div className="gov__bus" aria-hidden />
            <div className="gov__drop" aria-hidden />

            <div className="gov__box">
              <p className="gov__box-t mono">KAVACH GOVERNOR</p>
              <ol className="gov__ladder">
                {RUNGS.map((r) => (
                  <li className="gov__rung" key={r.n} data-fired={r.f}>
                    <span className="gov__rung-n mono">{r.n}</span>
                    <span className="gov__rung-t">{r.t}</span>
                    <span className="gov__rung-s mono">{r.s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="gov__exit" aria-hidden />

            <output className="gov__out" data-v="ESCALATE">
              <span className="gov__out-v mono">ESCALATE</span>
              <ul className="gov__why mono">
                {REASONS.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </output>
          </div>
        </div>
      </div>
    </section>
  );
}
