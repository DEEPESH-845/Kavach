'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView } from 'motion/react';
import { REPORT } from '@/lib/data';
import { inr, pct } from '@/lib/util';
import { T, E, settle, useStill } from '@/lib/motion';
import gsap from 'gsap';
import { useScene } from '@/lib/useScene';
import { Kinetic } from '@/components/Kinetic';
import { inward, rise } from '@/lib/scroll';
import { Term } from '@/components/Term';

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
    rise(q('.results tbody tr'), { trigger: '.results', start: 'top 80%', stagger: 0.08 });
    // the bars are the row's claim, so they grow from the number rather than fading in
    gsap.fromTo(q('.leak__bar'), { scaleX: 0 }, {
      scrollTrigger: { trigger: '.results', start: 'top 72%' },
      scaleX: 1, duration: 0.9, stagger: 0.08, ease: 'power3.out',
    });
    inward(q('.limits li'), { trigger: '.limits', stagger: 0.09, d: 12 });
  });

  return (
    <section className="sec" id="evidence" ref={ref}>
      <div className="wrap">
        <motion.p className="eyebrow" {...settle}>
          09 — measured, on cases the model had never seen
        </motion.p>
        <Kinetic text="Same human cost. Thirteen times less money out the door." />
        <motion.p className="body" {...settle}>
          Any system can catch every duplicate by sending every request to a human — and no
          merchant would run it. So this test forces all five systems to interrupt exactly the
          same number of people, and then asks the only question left: with the same staff cost,
          how much money still walked out the door?
        </motion.p>
        <motion.p className="plain" {...settle}>
          <b>Reading the table</b>
          <Term k="precision">Precision</Term> — of everything it flagged, how much really was a
          duplicate (higher is fewer false alarms). <Term k="recall">Recall</Term> — of the real
          duplicates, how many it caught (higher is less missed). <em>Escalated</em> — how often a
          human is interrupted, held equal on purpose. <em>Leaked</em> — the money that got paid
          twice anyway. That last column is the one that matters.
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
                <td>{r.name}<small className="results__gloss">{r.gloss}</small></td>
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
          <p className="eyebrow">
            how many customers you are willing to interrupt — and what it buys you
          </p>
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
            <li>The test data is <em>made up</em>. It was built to be hard — duplicates reworded
              so no text match finds them, near-identical amounts designed to fool a rule — but it
              is not real merchant traffic.</li>
            <li>“12% of requests are duplicates” is an <em>assumption</em>, not a measurement. No
              public figure exists. The slider above exists so you can see what happens if we
              guessed wrong.</li>
            <li>Precision 0.813 means roughly <em>one escalation in five delays a perfectly good
              refund</em>. That is a real cost to a real customer, and it is why the system asks a
              human rather than refusing outright.</li>
            <li><span className="mono">B1</span> scoring zero is the test working as designed:
              duplicates here are reworded, so matching text letter-for-letter finds nothing. We
              get no credit for beating a deliberately weak opponent.</li>
          </ul>
        </motion.div>
      </div>
    </section>
  );
}
