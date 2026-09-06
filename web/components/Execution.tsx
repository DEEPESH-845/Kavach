'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useScene } from '@/lib/useScene';
import { INTENT_STATES } from '@/lib/data';
import { Term } from '@/components/Term';
import { ExecutionField } from '@/components/ExecutionField';

gsap.registerPlugin(ScrollTrigger);

/* CHAPTER 06 — the half of the system the page never used to show.
 *
 * Everything before this decides. Nothing before this ACTS. Between `governor.reserve`
 * and `governor.execute_provider` there is a real network call to a company we do not
 * control, and the honest way to draw that is a boundary you can see: our states on one
 * side, the rail on the other, and every crossing rendered as a crossing.
 *
 * MOTION SEMANTICS. Execution is DIRECTIONAL — this is the only place on the page where
 * anything travels rightward, because it is the only place anything leaves us. The
 * answer travels back leftward along its own wire. Chapter 08 is convergent instead, and
 * the reader should be able to tell the two apart with the labels covered.
 *
 * The sequence is `pkg/kavach/governor.py` read out loud: reserve → APPROVED → commit →
 * provider call → EXECUTED, with the crash window between the commit and the settle
 * stated rather than hidden, because the reconciler in chapter 08 only exists because
 * that window is real.
 *
 * Every animated property is transform or opacity. Nothing here touches layout.
 */

const BEATS = [
  {
    h: <>Write down what you are about to do, <em>before</em> you do it.</>,
    p: <>Kavach saves the decision to disk first, and only then calls Razorpay. If the machine
       dies a millisecond later, that saved note survives and something knows ₹5,000 was about
       to move. A note written <em>after</em> the call would not have been there to find. This
       is called <Term k="write-ahead">writing ahead</Term>, and it is the difference between a
       gap you can investigate and money that vanished silently.</>,
  },
  {
    h: <>One request leaves, tagged so it can never be sent twice.</>,
    p: <>It carries an <Term k="idempotency">idempotency key</Term> built from this request’s own
       id — <span className="mono">kavach-&lt;intent_id&gt;</span> — so if the network hiccups
       and we send it again, Razorpay refunds once. Note what that does <em>not</em> cover: an
       agent that asks again in different words is a new request with a new key. Which is exactly
       why the duplicate had to be stopped further upstream, before it ever got here.</>,
  },
  {
    h: <>Razorpay answers. We <em>record</em> that answer — we don’t believe it.</>,
    p: <>A success response carrying a refund id means the gateway accepted the instruction and
       sent it onward. It does not mean the customer has the money. So the reply is filed as one
       more piece of evidence, and the debt stays open until something actually proves it was
       paid.</>,
  },
  {
    h: <>In the gap between those two steps, <em>the server can die</em>.</>,
    p: <>Then our records say “about to pay” and nothing in them knows whether ₹5,000 actually
       left. No amount of retrying or clever ordering closes that gap — it is a fact about
       talking to another company over a network. It closes one way only: by going and
       looking, which is what chapter 08 does.</>,
  },
];

export function Execution() {
  const ref = useScene<HTMLElement>((q, root) => {
    /* THE AXIS IS THE BREAKPOINT'S. A wide screen has two columns, so the boundary is
       vertical and a request crosses it by travelling right. A phone has one column, so
       the boundary is a rule between two stacked blocks and a request crosses it by
       travelling DOWN. The choreography is identical either way — leave us, come back —
       and only the axis it plays on changes, which is what makes the small screen a
       different composition rather than a squashed one. */
    const mm = gsap.matchMedia();
    mm.add({ wide: '(min-width: 861px)', narrow: '(max-width: 860px)' }, (ctx) => {
      const wide = (ctx.conditions as { wide: boolean }).wide;
      const axis = wide ? 'x' : 'y';
      const lane = q('.xb__wire')[0] as HTMLElement;
      // re-measured on every ScrollTrigger.refresh, so a resize re-derives the travel
      // rather than leaving the packet stranded short of the boundary
      const span = (_i: number, t: Element) => (wide
        ? lane.offsetWidth - (t as HTMLElement).offsetWidth
        : lane.offsetHeight - (t as HTMLElement).offsetHeight);

      const st = q('.xb__st');
      // set-then-tween, never a staggered `from` — see the note in Governor.tsx
      gsap.set(q('.xb__side'), { opacity: 0, y: 16 });
      gsap.set(st, { opacity: 0, x: -16 });

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: root, start: 'top top', end: 'bottom bottom',
          scrub: 0.5, invalidateOnRefresh: true,
        },
      });
      tl.to({}, { duration: 1 }, 0);

      // the boundary is drawn first and never moves again: it is the frame, not an event
      tl.from(q('.xb__bound-l'), { [wide ? 'scaleY' : 'scaleX']: 0, duration: 0.07 }, 0)
        .from(q('.xb__bound-t'), { opacity: 0, duration: 0.05 }, 0.04)
        .to(q('.xb__side'), { opacity: 1, y: 0, duration: 0.06, stagger: 0.04 }, 0.02);

      // beat 1 — the write-ahead lands and stays lit for the rest of the chapter
      tl.to(st, { opacity: 1, x: 0, duration: 0.05, stagger: 0.03 }, 0.10)
        .from(st[1].querySelector('.xb__st-on'), { scaleY: 0, duration: 0.04 }, 0.20);

      // beat 2 — AWAY. the only thing on the page that travels away from the reader
      tl.fromTo(q('.xb__pkt--out'), { [axis]: 0, opacity: 0 },
        { [axis]: span, opacity: 1, duration: 0.10 }, 0.30)
        .to(q('.xb__pkt--out'), { opacity: 0, duration: 0.03 }, 0.41);

      // beat 3 — BACK. the answer returns along its own wire, and settles the row
      tl.fromTo(q('.xb__pkt--in'), { [axis]: span, opacity: 0 },
        { [axis]: 0, opacity: 1, duration: 0.10 }, 0.50)
        .from(st[2].querySelector('.xb__st-on'), { scaleY: 0, duration: 0.04 }, 0.62);

      // beat 4 — the window. what was settled is un-settled and the reservation is left
      // holding a question. The only reversal on the page that removes certainty.
      tl.to(q('.xb__field'), { opacity: 0.3, duration: 0.06 }, 0.78)
        .to(st[2].querySelector('.xb__st-on'), { scaleY: 0, duration: 0.04 }, 0.78)
        .from(q('.xb__q'), { opacity: 0, duration: 0.05 }, 0.80);

      // the copy: each beat hands over before the last one is gone, so no scroll
      // position is ever left holding an empty frame
      const beats = q('.xb__beat');
      gsap.set(beats[0], { opacity: 1, y: 0 });
      const AT = [0, 0.26, 0.46, 0.72];
      beats.forEach((b, i) => {
        if (!i) return;
        tl.to(beats[i - 1], { opacity: 0, y: -16, duration: 0.05 }, AT[i] - 0.04)
          .fromTo(b, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.05 }, AT[i] - 0.01);
      });
    });

    ScrollTrigger.create({
      trigger: root, start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => {
        const p = self.progress;
        root.dataset.beat = p < 0.26 ? 'WRITE-AHEAD' : p < 0.46 ? 'OUTBOUND'
          : p < 0.72 ? 'PROVIDER' : 'THE WINDOW';
      },
      onLeave: () => { delete root.dataset.beat; },
      onLeaveBack: () => { delete root.dataset.beat; },
    });
  });

  return (
    <section className="xb" id="execution" ref={ref}>
      <div className="xb__sticky">
        <ExecutionField sectionRef={ref} />
        <div className="wrap xb__wrap">
          <p className="eyebrow">06 — the only place Kavach touches money</p>

          <div className="xb__field">
            <div className="xb__side xb__side--us">
              <p className="xb__side-t mono">KAVACH</p>
              <ol className="xb__states">
                {INTENT_STATES.map((s) => (
                  <li className="xb__st" key={s.s}>
                    <i className="xb__st-on" aria-hidden />
                    <span className="xb__st-s mono">{s.s}</span>
                    <span className="xb__st-d">{s.d}</span>
                  </li>
                ))}
              </ol>
              <p className="xb__q mono">did ₹5,000 leave?</p>
            </div>

            <div className="xb__bound" aria-hidden>
              <i className="xb__bound-l" />
              <p className="xb__bound-t mono">trust boundary</p>
            </div>

            <div className="xb__side xb__side--them">
              <p className="xb__side-t mono">RAZORPAY</p>
              <p className="xb__them">
                The payment rail. We do not own it, and nothing on this page pretends we can
                see past it. What follows is the honest shape of that limit:
              </p>
              {/* Naming what we cannot observe is not an apology — it is the reason chapters 07 and 08
                  exists. `truth.py` returns these conditions as AMBIGUOUS with a stated reason
                  rather than inventing a value, and the empty half of this diagram is that
                  same refusal drawn at page scale. */}
              <ul className="xb__blind">
                {['the national payments network', 'the customer’s bank', 'when the money actually lands']
                  .map((t) => (
                    <li key={t}><span>{t}</span><span className="mono">not observable</span></li>
                  ))}
              </ul>
            </div>

            <div className="xb__wire" data-dir="out" aria-hidden>
              <span className="xb__pkt xb__pkt--out mono">
                POST /refunds · X-Refund-Idempotency: kavach-…
              </span>
            </div>
            <div className="xb__wire" data-dir="in" aria-hidden>
              <span className="xb__pkt xb__pkt--in mono">
                201 · {'{"id":"rfnd_Hx9pQ2"}'}
              </span>
            </div>
          </div>

          <div className="xb__copy">
            {BEATS.map((b, i) => (
              <div className="xb__beat" key={i}>
                <h2 className="h2 xb__beat-h">{b.h}</h2>
                <p className="body">{b.p}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* CHAPTER 08 — reconciliation, which has to FEEL different from chapter 06 or the
 * distinction it exists to draw is lost.
 *
 * Execution was one thing travelling in one direction. Reconciliation is three separate
 * records — our reservation, the provider's row, and the signed event — moving toward
 * each other and resolving into one. Nothing here goes outward. Everything converges,
 * and the convergence is computed from layout offsets so it lands on the centre at any
 * width rather than at a hardcoded distance.
 *
 * `pkg/kavach/reconciliation.py`: APPROVED intents older than the tolerance are looked
 * up against `GET /payments/{id}/refunds` and matched on `notes.intent_id` — the id we
 * put there ourselves on the way out, which is what makes the match a fact rather than
 * a guess about amounts and timestamps.
 *
 * The chapter deliberately does not end on a green tick. Reconciliation settles whether
 * the money MOVED. Whether the customer HAS it is a different question, still open, and
 * merging the two is the exact error the whole page is about.
 */

const FRAGS = [
  { k: 'steel', src: 'intents',   id: 'APPROVED',            d: 'our reservation, written before the call' },
  { k: 'bone',  src: 'provider',  id: 'rfnd_Hx9pQ2',         d: 'notes.intent_id matches the key we sent' },
  { k: 'steel', src: 'event log', id: 'seq 17',              d: 'refund.processed · HMAC verified' },
] as const;

const R_BEATS = [
  {
    h: <>The truth arrives on <em>its own schedule</em>.</>,
    p: <>Razorpay sends a <Term k="webhook">webhook</Term> — a “this happened” message — minutes
       or hours later. Before Kavach reads a single word of it, it checks the{' '}
       <Term k="hmac">signature</Term> proving the message really came from Razorpay. A message
       that fails that check never becomes trusted evidence; it is filed as an unverified claim
       and labelled as one.</>,
  },
  {
    h: <>And when nothing arrives, we <em>go and look</em>.</>,
    p: <>Anything still marked “about to pay” past its deadline gets swept up: Kavach asks
       Razorpay directly which refunds exist on that payment, and matches them using the id{' '}
       <em>we</em> attached on the way out. Matching on our own id is a fact. Matching on amount
       and timestamp would be a guess — and guessing is how you refund twice.</>,
  },
  {
    h: <>Three records. <em>One question settled — and one still open.</em></>,
    p: <>The request settles: the money did leave, and it stops counting as unknown exposure.
       The <em>debt</em> does not close, because still nothing says the customer was credited.
       Holding those two apart, instead of collapsing them into one “done”, is the entire
       product.</>,
  },
];

export function Reconcile() {
  const ref = useScene<HTMLElement>((q, root) => {
    gsap.set(q('.rc__frag'), { opacity: 0, y: 20 });   // see the note in Governor.tsx

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: root, start: 'top top', end: 'bottom bottom',
        scrub: 0.5, invalidateOnRefresh: true,
      },
    });
    tl.to({}, { duration: 1 }, 0);

    // the webhook comes back INWARD — the mirror of chapter 06's only outward move
    const lane = q('.rc__lane')[0] as HTMLElement;
    tl.fromTo(q('.rc__hook'),
      { x: (i, t) => lane.offsetWidth - (t as HTMLElement).offsetWidth, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.09 }, 0.06)
      .to(q('.rc__hook'), { opacity: 0.4, duration: 0.04 }, 0.20);

    tl.to(q('.rc__frag'), { opacity: 1, y: 0, duration: 0.05, stagger: 0.035 }, 0.30);

    /* THE CONVERGENCE. Each fragment travels to the centre of its own row — computed
       from layout offsets, so it is correct at every width and re-derived on refresh
       rather than baked in. They shrink slightly as they meet, which reads as three
       things becoming one rather than three things stacking. */
    const dx = (_i: number, t: Element) => {
      const el = t as HTMLElement;
      return el.parentElement!.offsetWidth / 2 - (el.offsetLeft + el.offsetWidth / 2);
    };
    const dy = (_i: number, t: Element) => {
      const el = t as HTMLElement;
      return el.parentElement!.offsetHeight / 2 - (el.offsetTop + el.offsetHeight / 2);
    };
    tl.to(q('.rc__frag'), { x: dx, y: dy, scale: 0.94, duration: 0.14 }, 0.60)
      .to(q('.rc__frag'), { opacity: 0, duration: 0.05 }, 0.71)
      .from(q('.rc__canon'), { opacity: 0, scale: 0.96, duration: 0.06 }, 0.72)
      .from(q('.rc__open'), { opacity: 0, y: 12, duration: 0.05 }, 0.82);

    const beats = q('.rc__beat');
    gsap.set(beats[0], { opacity: 1, y: 0 });
    const AT = [0, 0.34, 0.66];
    beats.forEach((b, i) => {
      if (!i) return;
      tl.to(beats[i - 1], { opacity: 0, y: -16, duration: 0.05 }, AT[i] - 0.04)
        .fromTo(b, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.05 }, AT[i] - 0.01);
    });

    ScrollTrigger.create({
      trigger: root, start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => {
        root.dataset.beat = self.progress < 0.34 ? 'WEBHOOK'
          : self.progress < 0.66 ? 'THE SWEEP' : 'RESOLVED';
      },
      onLeave: () => { delete root.dataset.beat; },
      onLeaveBack: () => { delete root.dataset.beat; },
    });
  });

  return (
    <section className="rc" id="reconcile" ref={ref}>
      <div className="rc__sticky">
        <div className="wrap rc__wrap">
          <p className="eyebrow">08 — don’t trust what you asked for; check what happened</p>

          <div className="rc__lane" aria-hidden>
            <span className="rc__hook mono">webhook · refund.processed · sig_verified</span>
          </div>

          <div className="rc__field">
            <ul className="rc__frags">
              {FRAGS.map((f) => (
                <li className="rc__frag" key={f.src} data-k={f.k}>
                  <span className="rc__frag-src mono">{f.src}</span>
                  <span className="rc__frag-id mono">{f.id}</span>
                  <span className="rc__frag-d">{f.d}</span>
                </li>
              ))}
            </ul>

            <div className="rc__resolved">
              <p className="rc__canon mono">
                intent <span data-bone>EXECUTED</span> · result_id{' '}
                <span data-steel>rfnd_Hx9pQ2</span> · reconciled against the rail
              </p>
              <p className="rc__open mono">
                obligation <span data-amber>OPEN · ₹5,000</span> — no event states the customer
                was credited
              </p>
            </div>
          </div>

          <div className="rc__copy">
            {R_BEATS.map((b, i) => (
              <div className="rc__beat" key={i}>
                <h2 className="h2 rc__beat-h">{b.h}</h2>
                <p className="body">{b.p}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
