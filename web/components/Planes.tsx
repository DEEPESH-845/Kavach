'use client';

import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PLANES } from '@/lib/data';
import { T, E, settle, useStill } from '@/lib/motion';
import { useScene } from '@/lib/useScene';
import { rise } from '@/lib/scroll';

/* Layer three of the disclosure: what each plane catches, what it cannot, and the trust
   boundary it depends on. A button rather than <details> so the open state can drive the
   row's accent bar and the seam affordance from one place. */

export function Planes() {
  const still = useStill();
  const [open, setOpen] = useState<number | null>(null);
  let half = '';

  // the ladder the canvas just resolved into, landing rung by rung
  const ref = useScene<HTMLElement>((q) => {
    rise(q('.plane, .planes > .eyebrow'), { trigger: '.planes', stagger: 0.055 });
  });

  const builtNs = PLANES.filter((p) => p.built).map((p) => p.n).join('');
  const plannedNs = PLANES.filter((p) => !p.built).map((p) => p.n).join('');

  return (
    <section className="sec sec--planes" id="gradient" ref={ref}>
      <div className="wrap">
        <motion.p className="legend" {...settle}>
          <span className="legend__k"><i data-swatch="steel" />fixed rules — no AI, ever</span>
          <span className="legend__k"><i data-swatch="amber" />AI — can advise, cannot decide</span>
          <span className="legend__k"><i data-swatch="bone" />policy — makes the final call</span>
          <span className="legend__k legend__hint">open any layer for what it cannot do</span>
        </motion.p>

        <p className="plain">
          <b>How to read this</b>
          Eight layers of checking, in the order they run. Each row gives the layer’s name, what
          it looks at, whether AI is involved, roughly how long it takes, and whether it is
          already written. Click any row to see what that layer <em>cannot</em> do — because a
          layer whose limits are hidden is a layer nobody should trust.
        </p>

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
          The order is strict: no layer is allowed to depend on one further down the list. That
          is also the order of how provable each layer is — certainty first, judgement last.
        </motion.p>
        <motion.p className="note" {...settle}>
          <em>State, stated.</em>{' '}
          {builtNs} are in the tree and under test.
          {plannedNs !== '' && (
            <> {plannedNs} are specified and not written yet — the design is in{' '}
              <span className="mono">documents/specs/</span>.</>
          )}{' '}
          The timings are <em>targets</em> we designed to, not stopwatch readings. The only
          measured numbers on this page are in <a className="link" href="#evidence">Evidence</a>.
        </motion.p>
      </div>
    </section>
  );
}
