'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView } from 'motion/react';
import { REPORT } from '@/lib/data';
import { inr, pct } from '@/lib/util';
import { T, E, settle, useStill } from '@/lib/motion';
import gsap from 'gsap';
import { useScene } from '@/lib/useScene';

/** Numbers travel to their value. Only the payoff column counts — four counters a row
 *  would be a slot machine, and the point is the rupees, not the animation. */
function Counted({ to, format }: { to: number; format: (n: number) => string }) {
  const still = useStill();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '0px 0px -20% 0px' });
  const [text, setText] = useState(() => format(0));

  useEffect(() => {
    if (!seen || still) { setText(format(to)); return; }
    const stop = animate(0, to, {
      duration: 0.95, ease: E.reveal, onUpdate: (v) => setText(format(v)),
    });
    return () => stop.stop();
  }, [seen, to, still, format]);

  return <span ref={ref}>{text}</span>;
}

/* The leaked column carries the whole result, so it gets a length as well as a number.
   Thirteen times is a sentence; this is the same claim at a glance. */
const WORST = Math.max(...REPORT.results.map((r) => r.leaked_minor));

export function Evidence() {
  const [budget, setBudget] = useState(2);
  const s = REPORT.budget_sweep[budget];

  const ref = useScene<HTMLElement>((q) => {
    gsap.from(q('.results tbody tr'), {
      scrollTrigger: { trigger: '.results', start: 'top 80%' },
      opacity: 0, y: 14, duration: 0.5, stagger: 0.08, ease: 'power2.out',
    });
    gsap.fromTo(q('.leak__bar'), { scaleX: 0 }, {
      scrollTrigger: { trigger: '.results', start: 'top 72%' },
      scaleX: 1, duration: 0.9, stagger: 0.08, ease: 'power3.out',
    });
    gsap.from(q('.limits li'), {
      scrollTrigger: { trigger: '.limits', start: 'top 82%' },
      opacity: 0, x: -12, duration: 0.5, stagger: 0.09, ease: 'power2.out',
    });
  });

  return (
    <section className="sec" id="evidence" ref={ref}>
      <div className="wrap">
        <motion.p className="eyebrow" {...settle}>07 — measured, on a held-out split</motion.p>
        <motion.h2 className="h2" {...settle}>Same human cost. Thirteen times less money out the door.</motion.h2>
        <motion.p className="body" {...settle}>
          Every system below escalates the identical share of intents, because “escalate
          everything” is otherwise optimal and operationally useless. Hold the friction fixed,
          then count the rupees that leaked.
        </motion.p>

        <table className="results">
          <caption className="sr">
            Duplicate-obligation detection on 925 held-out intents at a fixed review budget
          </caption>
          <thead>
            <tr>
              <th scope="col">system</th><th scope="col">precision</th><th scope="col">recall</th>
              <th scope="col">escalated</th><th scope="col">leaked</th>
            </tr>
          </thead>
          <tbody>
            {REPORT.results.map((r) => (
              <tr key={r.name} data-hero={('hero' in r && r.hero) || undefined}>
                <td>{r.name}<span className="sr"> — {r.gloss}</span></td>
                <td>{r.precision.toFixed(3)}</td>
                <td>{r.recall.toFixed(3)}</td>
                <td>{pct(r.review_rate)}</td>
                <td data-leak={r.leaked_minor ? '' : undefined}>
                  <span className="leak">
                    <i className="leak__bar" style={{ width: `${(r.leaked_minor / WORST) * 100}%` }} />
                    <Counted to={r.leaked_minor / 100} format={inr} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <motion.p className="punch" {...settle}>
          <span className="mono" data-steel>B2</span> and <span className="mono" data-bone>B4</span>{' '}
          escalate the <em>same 19.7%</em> — identical human cost. The rule leaks{' '}
          <span className="mono" data-oxide>₹1,84,636</span>. The model leaks{' '}
          <span className="mono" data-bone>₹14,257</span>.
        </motion.p>

        <motion.div className="sweep" {...settle}>
          <p className="eyebrow">how much friction you are willing to buy</p>
          <div className="sweep__ctl" role="group" aria-label="Review budget">
            {REPORT.budget_sweep.map((b, i) => (
              <button key={b.budget} type="button" className="sweep__btn"
                      aria-pressed={i === budget} onClick={() => setBudget(i)}>
                review budget {b.budget * 100}%
              </button>
            ))}
          </div>
          <motion.dl className="sweep__out" key={budget}
                     initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
                     transition={{ duration: T.fast, ease: E.reveal }}>
            <div><dt>escalated</dt><dd><Counted to={s.escalated} format={pct} /></dd></div>
            <div><dt>recall</dt><dd><Counted to={s.recall} format={(v) => v.toFixed(3)} /></dd></div>
            <div><dt>precision</dt><dd><Counted to={s.precision} format={(v) => v.toFixed(3)} /></dd></div>
            <div><dt>still leaked</dt><dd><Counted to={s.leaked_minor / 100} format={inr} /></dd></div>
          </motion.dl>
        </motion.div>

        <motion.div className="limits" {...settle}>
          <h3 className="h3">What these numbers are not.</h3>
          <ul>
            <li>Both corpora are <em>synthetic</em>. Built to be hard — paraphrased duplicates,
              identical-amount hard negatives, held-out attack families — but not production traffic.</li>
            <li>The 12% duplicate base rate is a <em>stated assumption</em>. No public figure exists;
              the sensitivity sweep above is why it is stated rather than hidden.</li>
            <li>Precision 0.813 means roughly <em>one in five escalations delays a legitimate
              refund</em>. That cost is real, and it is why the system escalates rather than denies.</li>
            <li><span className="mono">B1</span> scoring exactly zero is the corpus working as
              designed: duplicates are paraphrases, so string equality is worthless and no model is
              credited for beating a strawman.</li>
          </ul>
        </motion.div>
      </div>
    </section>
  );
}
