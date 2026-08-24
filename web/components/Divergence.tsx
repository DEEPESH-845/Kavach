'use client';

import gsap from 'gsap';
import { useScene } from '@/lib/useScene';

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
    gsap.from(q('.transcript__line'), {
      scrollTrigger: { trigger: '.transcript', start: 'top 78%' },
      opacity: 0, x: -18, duration: 0.5, stagger: 0.13, ease: 'power2.out',
    });

    gsap.from(q('.quote blockquote'), {
      scrollTrigger: { trigger: '.quote', start: 'top 80%' },
      opacity: 0, duration: 0.6, ease: 'power2.out',
    });
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
      gsap.from(q('.split-claim__side, .split-claim__verdict'), {
        scrollTrigger: { trigger: '.split-claim', start: 'top 82%' },
        opacity: 0, y: 18, duration: 0.6, stagger: 0.12, ease: 'power2.out',
      });
    });

    gsap.utils.toArray<HTMLElement>(q('[data-rise]')).forEach((el) =>
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: 'top 86%' },
        opacity: 0, y: 16, duration: 0.7, ease: 'power2.out',
      }));
  });

  return (
    <section className="sec" id="divergence" ref={ref}>
      <div className="wrap">
        <p className="eyebrow" data-rise>02 — where the money goes missing</p>
        <h2 className="h2" data-rise>Tool acknowledgement is not financial truth.</h2>

        <div className="transcript">
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
            before receiving the ARN/RRN from the Gateway.
          </blockquote>
          <figcaption data-rise>Razorpay refund documentation</figcaption>
        </figure>

        <div className="split-claim">
          <div className="split-claim__side">
            <p className="cell__label">what <span className="mono">processed</span> means</p>
            <p className="claim mono" data-steel>the rail dispatched it</p>
            <p className="cell__note">observable, signature-verified, certain</p>
          </div>
          <p className="split-claim__verdict">One field cannot carry both.</p>
          <div className="split-claim__side">
            <p className="cell__label">what the agent read</p>
            <p className="claim mono" data-oxide>the customer has the money</p>
            <p className="cell__note">unobservable from here — and false for hours</p>
          </div>
        </div>

        <p className="body" data-rise>
          So the customer complains again. The agent does not <em>retry</em> — it forms a
          <em> new intent</em>: <span className="mono">“the refund didn’t work, issue another.”</span>{' '}
          Different words, different session, different key. Financially, the same obligation,
          paid twice.
        </p>
      </div>
    </section>
  );
}
