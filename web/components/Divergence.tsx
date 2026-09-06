'use client';

import gsap from 'gsap';
import { useScene } from '@/lib/useScene';
import { Term } from '@/components/Term';
import { fade, inward, rise } from '@/lib/scroll';

/* The section where the failure is explained, choreographed so that scrolling performs
   the argument rather than merely revealing it:

     the transcript arrives a line at a time, in the order the agent got it wrong
     the quote's rule draws down as the citation lands
     the two claims start on top of each other and are pulled apart by the scroll,
     opening a gap that the verdict then fills

   That last one is the page's primitive at section scale. You do not read that one
   field cannot carry both values; you separate them yourself. */

export function Divergence() {
  const ref = useScene<HTMLElement>((q) => {
    /* THE HANDOFF FROM THE HERO. The seam that opened between the cell's two halves
       keeps opening as the hero leaves, and this is where it lands: one hairline drawing
       downward out of the fold, amber at the top where the divergence is still the
       subject, grey by the time it is just a margin rule. Two sections, one line — the
       argument does not start, it continues. It draws early, well before the lines it
       carries, so the rule is already there for them to arrive against. */
    gsap.fromTo(q('.transcript__rule'), { scaleY: 0 }, {
      scaleY: 1, duration: 0.9, ease: 'power2.out',
      scrollTrigger: { trigger: '.transcript', start: 'top 96%' },
    });

    // the transcript accumulates: each line is a record arriving, not a heading landing
    inward(q('.transcript__line'), { trigger: '.transcript', start: 'top 78%', stagger: 0.13, d: 18 });

    fade(q('.quote blockquote'), { trigger: '.quote', start: 'top 80%' });
    gsap.fromTo(q('.quote blockquote'),
      { '--rule': '0%' }, {
        '--rule': '100%', duration: 0.7, ease: 'power2.inOut',
        scrollTrigger: { trigger: '.quote', start: 'top 80%' },
      });

    // The claims only converge and split where the layout has two columns to split.
    // Below that they are stacked, so a horizontal tear means nothing and would push
    // the document sideways; there they simply rise.
    const mm = gsap.matchMedia();
    mm.add('(min-width: 861px)', () => {
      gsap.timeline({
        scrollTrigger: { trigger: '.split-claim', start: 'top 88%', end: 'top 38%', scrub: 0.8 },
        defaults: { ease: 'none' },
      })
        .fromTo(q('.split-claim__side:first-child'), { xPercent: 44, opacity: 0.25 }, { xPercent: 0, opacity: 1 }, 0)
        .fromTo(q('.split-claim__side:last-child'), { xPercent: -44, opacity: 0.25 }, { xPercent: 0, opacity: 1 }, 0)
        .fromTo(q('.split-claim__verdict'), { opacity: 0, scaleY: 0.55 }, { opacity: 1, scaleY: 1 }, 0.35);
    });
    mm.add('(max-width: 860px)', () => {
      rise(q('.split-claim__side, .split-claim__verdict'),
           { trigger: '.split-claim', start: 'top 82%', stagger: 0.12, d: 18 });
    });

    gsap.utils.toArray<HTMLElement>(q('[data-rise]'))
      .forEach((el) => rise(el, { start: 'top 86%' }));
  });

  return (
    <section className="sec" id="divergence" ref={ref}>
      <div className="wrap">
        <p className="eyebrow" data-rise>02 — where the money goes missing</p>
        <h2 className="h2" data-rise>“Done” is not the same as “the customer has the money.”</h2>

        <p className="plain" data-rise>
          <b>In plain English</b>
          When an agent asks for a refund, the payment system replies almost instantly. That
          reply only means <em>the instruction was accepted</em> — the money can take days to
          reach the customer’s bank. The agent reads the reply as “done”, tells the customer so,
          and when the customer says the money never arrived, asks for the refund again. Two
          refunds leave. One was owed.
        </p>

        <div className="transcript">
          <i className="transcript__rule" aria-hidden />
          <p className="transcript__line">
            <span className="who who--agent">agent</span>
            <span className="mono">create_refund(pay_Nx3f9K2, 500000)</span>
          </p>
          <p className="transcript__line">
            <span className="who who--api">api</span>
            <span className="mono">200 OK &nbsp;{'{"id":"rfnd_Hx9pQ2", "status":"processed"}'}</span>
          </p>
          <p className="transcript__line">
            <span className="who who--agent">agent</span>
            <span className="mono said">“Done — I’ve refunded ₹5,000.”</span>
          </p>
          <p className="transcript__line transcript__line--truth">
            <span className="who who--truth">truth</span>
            <span className="mono">the customer has not been credited, and may not be for days</span>
          </p>
        </div>

        <figure className="quote">
          <blockquote>
            Usually, Razorpay moves a refund to the <span className="mono">processed</span> state
            before receiving the <Term k="arn">ARN/RRN</Term> from the Gateway.
          </blockquote>
          <figcaption data-rise>Razorpay refund documentation</figcaption>
        </figure>

        <div className="split-claim">
          <div className="split-claim__side">
            <p className="cell__label">what <span className="mono">processed</span> means</p>
            <p className="claim mono" data-steel>the rail dispatched it</p>
            <p className="cell__note">something we can see and verify — certain</p>
          </div>
          <p className="split-claim__verdict">One field cannot carry both.</p>
          <div className="split-claim__side">
            <p className="cell__label">what the agent read</p>
            <p className="claim mono" data-oxide>the customer has the money</p>
            <p className="cell__note">not visible from here — and untrue for hours</p>
          </div>
        </div>

        <p className="body" data-rise>
          So the customer complains again. The agent does not <em>retry</em> the old request —
          it makes a brand-new one: <span className="mono">“the refund didn’t work, issue
          another.”</span> Different words, different session, so every duplicate-blocking
          trick built into payment systems sees two unrelated requests. In money terms it is
          one debt, paid twice.
        </p>
      </div>
    </section>
  );
}
