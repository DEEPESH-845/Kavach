'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import gsap from 'gsap';
import { T, E, useStill } from '@/lib/motion';
import { useScene } from '@/lib/useScene';
import { useMagnetic } from '@/lib/magnetic';
import { HeroCard } from '@/components/HeroCard';
import { Term } from '@/components/Term';

/* Layer 1 background · 2 ambient field · 3 the split cell · 4 typography · 5 nav · 6 cue.
   The only thing that moves on its own is the clock, because an obligation nobody closed
   getting older while you read is the entire complaint. */

/* "Agentic commerce" is the industry's word for this and nobody outside the industry
   knows it. The headline says the same thing in words a merchant, a judge or a customer
   can read at a glance; the lede below it does the positioning. */
const HEAD: [string, boolean][] = [
  ['The', false], ['authorization', false], ['layer', false], ['for', false],
  ['AI', true], ['that', true], ['spends', true], ['money.', true],
];

function AmbientField() {
  const still = useStill();
  const mx = useSpring(useMotionValue(0), { stiffness: 60, damping: 22 });
  const my = useSpring(useMotionValue(0), { stiffness: 60, damping: 22 });

  const cells = useMemo(() => {
    const n = 60, cols = Math.ceil(Math.sqrt(n * 1.7)), rows = Math.ceil(n / cols);
    // a jittered grid, not a scatter: random reads as noise, a grid under stress reads
    // as a system, and a system is what the section is about
    return Array.from({ length: n }, (_, i) => ({
      left: (((i % cols) + 0.5 + (((i * 37) % 100) / 100 - 0.5) * 0.8) / cols) * 100,
      top: ((((i / cols) | 0) + 0.5 + (((i * 61) % 100) / 100 - 0.5) * 0.8) / rows) * 100,
      opacity: 0.18 + (((i * 53) % 100) / 100) * 0.34,
      diverged: i % 17 === 2,
    }));
  }, []);

  useEffect(() => {
    if (still) return;
    const move = (e: PointerEvent) => {
      mx.set((e.clientX / innerWidth - 0.5) * -10);
      my.set((e.clientY / innerHeight - 0.5) * -8);
    };
    addEventListener('pointermove', move, { passive: true });
    return () => removeEventListener('pointermove', move);
  }, [mx, my, still]);

  // no early return: removing it from the tree would change the markup between the
  // server and a reduced-motion client. The stylesheet hides it instead.
  return (
    <motion.div className="hero__field" aria-hidden style={{ x: mx, y: my }}>
      {cells.map((c, i) => (
        <i key={i} style={{ left: `${c.left}%`, top: `${c.top}%`, opacity: c.opacity }}
           data-diverged={c.diverged || undefined} />
      ))}
    </motion.div>
  );
}

/** The fill starts where the pointer entered: the seam you opened yourself. */
export function SeamButton(
  { href, primary, children }: { href: string; primary?: boolean; children: React.ReactNode },
) {
  const ref = useRef<HTMLAnchorElement>(null);
  // only the primary call leans toward the pointer; the secondary one just fills
  const mag = useMagnetic<HTMLSpanElement>();
  return (
    <span className="mag" ref={primary ? mag : undefined}>
      <a ref={ref} className={'btn' + (primary ? ' btn--primary' : '')} href={href}
         onPointerEnter={(e) => {
           const r = ref.current!.getBoundingClientRect();
           ref.current!.style.setProperty('--ox', `${((e.clientX - r.left) / r.width) * 100}%`);
         }}>
        <span>{children}</span>
      </a>
    </span>
  );
}

const OPENED_MS = 4 * 3600e3 + 12 * 60e3;   // the demo refund, four hours past its last event
const hhmmss = (ms: number) =>
  [ms / 3600e3, (ms / 60e3) % 60, (ms / 1e3) % 60]
    .map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');

function Clock() {
  // Server and client cannot agree on Date.now(), so the first render is the fixed
  // opening value on both and the clock only starts once mounted. Anything else is a
  // hydration mismatch, and a page about verifiable state should not have one.
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const t0 = Date.now() - OPENED_MS;
    const tick = () => setMs(Date.now() - t0);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span data-amber>{hhmmss(ms ?? OPENED_MS)}</span>;
}

export function Hero() {
  const still = useStill();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setOpen(true), still ? 0 : 1100);
    return () => clearTimeout(id);
  }, [still]);

  /* Leaving the hero does not fade it out — it pulls the cell apart. The seam that
     opened while you read keeps opening as you scroll, and the section below inherits
     a divergence already in progress rather than starting a new one. */
  // gsap.context scopes selector strings to the root's descendants, so the root itself
  // has to be passed as the element — '#counter' from inside would match nothing.
  const ref = useScene<HTMLElement>((q, root) => {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.7 },
      defaults: { ease: 'none' },
    })
      .to(q('.hero__body'), { y: -90, opacity: 0.14 }, 0)
      .to(q('.hero__field'), { opacity: 0 }, 0);   // transform belongs to the springs

    /* The cell only tears sideways where the layout has two columns to tear. Below that
       the halves are stacked, so a horizontal pull means nothing — and at 9% of a
       full-width half it pushes the document some thirty pixels past the viewport,
       which `overflow-x: hidden` hides rather than fixes. Below the breakpoint the hero
       simply rises and fades: the seam has already opened on load, and a phone does not
       need the same gesture performed twice. */
    const mm = gsap.matchMedia();
    mm.add('(min-width: 861px)', () => {
      tl.to(q('.cell__half--l'), { xPercent: -9 }, 0)
        .to(q('.cell__half--r'), { xPercent: 9 }, 0)
        .to(q('.cell__seam'), { scaleY: 2.4 }, 0);   // grows downward, into what it explains
    });
  });

  return (
    <section className="sec hero" id="counter" ref={ref}>
      <AmbientField />
      <div className="wrap hero__body">
        <motion.p className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: T.slow, ease: E.reveal }}>
          KAVACH · merchant-side trust layer · Razorpay Buildathon
        </motion.p>

        {/* words, not letters: letter-by-letter turns a thesis into an effect */}
        <h1 className="display">
          {/* the space lives outside the mask, or overflow:hidden eats it */}
          {HEAD.map(([w, accent], i) => (
            <Fragment key={i}>
              <span className="w">
                <motion.i
                  initial={still ? false : { y: '108%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: T.slow, ease: E.proven, delay: i * 0.045 }}
                  style={accent ? { color: 'var(--steel)' } : undefined}
                >{w}</motion.i>
              </span>{' '}
            </Fragment>
          ))}
        </h1>

        <motion.p className="lede" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: T.slow, ease: E.reveal, delay: 0.34 }}>
          <em>AI agents have started spending money for people. Kavach decides what they are
          allowed to do — and proves it afterwards.</em>{' '}
          An <Term k="agent">agent</Term> now turns up on both sides of the counter: one arrives
          at your checkout holding a <Term k="mandate">permission slip</Term> you have no way to
          check, and one sits inside your own dashboard issuing refunds. Razorpay solved how an
          agent <em>pays</em>. Kavach answers the question that comes first — <em>should it?</em>
        </motion.p>

        <motion.figure className="hero__cell" initial={{ opacity: 0, y: 16 }}
                       animate={{ opacity: 1, y: 0 }}
                       transition={{ duration: T.slow, ease: E.reveal, delay: 0.5 }}>
          <figcaption className="cell__caption">
            refund <span className="mono">rfnd_Hx9pQ2</span> — one refund, two different answers.
            The gap between them is where the same ₹5,000 gets paid out twice.
          </figcaption>
          <div className="cell" data-open={open || undefined}>
            <div className="cell__half cell__half--l">
              <p className="cell__label">what the <Term k="rail">rail</Term> says</p>
              <p className="cell__value mono" data-steel>PROCESSING</p>
              <p className="cell__note">Razorpay took the instruction and sent it onward</p>
              <p className="cell__clock mono">
                settled by <span data-steel>seq 17</span> · webhook, HMAC verified
              </p>
            </div>
            <div className="cell__seam"><span className="cell__seam-line" /></div>
            <div className="cell__half cell__half--r">
              <p className="cell__label">what is still <Term k="obligation">owed</Term></p>
              <p className="cell__value mono" data-amber>OPEN · ₹5,000</p>
              <p className="cell__note">nothing yet confirms the customer actually got the money</p>
              <p className="cell__clock mono">
                open for <Clock /> · staleness tolerance 06:00:00
              </p>
            </div>
          </div>
        </motion.figure>

        <motion.div className="hero__acts" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: T.slow, ease: E.reveal, delay: 0.66 }}>
          <SeamButton href="/tour" primary>See Kavach in action</SeamButton>
          <SeamButton href="#divergence">Explore the architecture</SeamButton>
        </motion.div>

        {/* the right column, which only exists above 1180px — see .hero__gl */}
        <HeroCard />
      </div>
      <p className="hero__cue" aria-hidden>scroll</p>
    </section>
  );
}
