'use client';

import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PLANES } from '@/lib/data';
import { T, E, settle, useStill } from '@/lib/motion';
import gsap from 'gsap';
import { useScene } from '@/lib/useScene';

/* Layer three of the disclosure: what each plane catches, what it cannot, and the trust
   boundary it depends on. A button rather than <details> so the open state can drive the
   row's accent bar and the seam affordance from one place. */

export function Planes() {
  const still = useStill();
  const [open, setOpen] = useState<number | null>(null);
  let half = '';

  // the ladder the canvas just resolved into, landing rung by rung
  const ref = useScene<HTMLElement>((q) => {
    gsap.from(q('.plane, .planes > .eyebrow'), {
      scrollTrigger: { trigger: '.planes', start: 'top 82%' },
      opacity: 0, y: 18, duration: 0.55, stagger: 0.055, ease: 'power2.out',
    });
  });

  return (
    <section className="sec sec--planes" id="gradient" ref={ref}>
      <div className="wrap">
        <motion.p className="legend" {...settle}>
          <span className="legend__k"><i data-swatch="steel" />deterministic — no model, ever</span>
          <span className="legend__k"><i data-swatch="amber" />learned — advisory only</span>
          <span className="legend__k"><i data-swatch="bone" />policy — chooses the action</span>
          <span className="legend__k legend__hint">open a plane for what it cannot do</span>
        </motion.p>

        <ol className="planes">
          {PLANES.map((p, i) => {
            const head = p.half !== half ? (half = p.half) : null;
            const isOpen = open === i;
            return (
              <Fragment key={p.t}>
                {head && <li className="eyebrow" style={{ padding: '26px 0 10px', margin: 0 }}>{head}</li>}
                <li className="plane" data-k={p.k} data-open={isOpen || undefined}>
                  <button className="plane__row" aria-expanded={isOpen} aria-controls={`plane-${i}`}
                          onClick={() => setOpen(isOpen ? null : i)}>
                    <span className="plane__n">{p.n}</span>
                    <span className="plane__t">{p.t}</span>
                    <span className="plane__m">{p.m}</span>
                    <span className="plane__ai">{p.ai}</span>
                    <span className="plane__ms">{p.ms}</span>
                    <span className="plane__st" data-built={p.built || undefined}>
                      {p.built ? 'built' : 'planned'}
                    </span>
                    <span className="plane__x" aria-hidden />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.dl id={`plane-${i}`} className="plane__body"
                        initial={still ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: T.normal, ease: E.reveal }}
                        style={{ overflow: 'hidden' }}>
                        <div><dt>what it catches</dt><dd dangerouslySetInnerHTML={{ __html: p.catches }} /></div>
                        <div><dt>what it cannot</dt><dd dangerouslySetInnerHTML={{ __html: p.cannot }} /></div>
                        <div><dt>trust boundary</dt><dd dangerouslySetInnerHTML={{ __html: p.boundary }} /></div>
                        <div><dt>implementation</dt><dd>
                          <span className="mono">pkg/kavach/{p.src}</span> — {p.built
                            ? 'in the tree and under test.'
                            : 'not written yet; the design is in documents/specs/.'}
                        </dd></div>
                      </motion.dl>
                    )}
                  </AnimatePresence>
                </li>
              </Fragment>
            );
          })}
        </ol>

        <motion.p className="note" {...settle}>
          Nothing below a layer imports anything above it. That ordering is also the determinism
          gradient.
        </motion.p>
        <motion.p className="note" {...settle}>
          <em>State, stated.</em>{' '}
          {PLANES.filter((p) => p.built).map((p) => p.n).join('')} are in the tree and under test.{' '}
          {PLANES.filter((p) => !p.built).map((p) => p.n).join('')} are specified and not written
          yet — the design is in <span className="mono">documents/specs/</span>. The latencies are
          per-plane <em>budgets</em>, not measurements; the only measured numbers on this page are
          in <a className="link" href="#evidence">Evidence</a>.
        </motion.p>
      </div>
    </section>
  );
}
