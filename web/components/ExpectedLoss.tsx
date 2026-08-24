'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { inr } from '@/lib/util';
import { T, E, settle } from '@/lib/motion';
import type { Admission } from '@/lib/data';

/* gate/admission.decide: argmin expected loss over costs the merchant supplies.

   Margin lost on a good cart wrongly refused scales with the cart, and the cost of a
   step-up is dominated by the checkout it interrupts rather than the message. Pricing
   c_step at the message alone left STEP_UP losing at every setting, which is a broken
   instrument rather than a cautious one. */
const C = { c_step: 45, c_hold: 140, r_step: 0.7, r_hold: 0.95, margin: 0.18 };

export function ExpectedLoss() {
  const [p, setP] = useState(0.06);
  const [L, setL] = useState(2000);

  const { el, win, max } = useMemo(() => {
    const el: Record<Admission, number> = {
      ALLOW: p * L,
      STEP_UP: C.c_step + p * (1 - C.r_step) * L,
      HOLD: C.c_hold + p * (1 - C.r_hold) * L,
      DENY: (1 - p) * C.margin * L,
    };
    const keys = Object.keys(el) as Admission[];
    return { el, win: keys.reduce((a, b) => (el[a] <= el[b] ? a : b)), max: Math.max(...keys.map(k => el[k]), 1) };
  }, [p, L]);

  return (
    <>
      <motion.hr className="rule" {...settle} />
      <motion.p className="eyebrow" {...settle}>and how the deterministic half chooses</motion.p>
      <motion.h3 className="h3" {...settle}>Four verdicts, one argmin.</motion.h3>
      <motion.p className="body" {...settle}>
        Gate picks the admission verdict by minimising expected loss over costs the{' '}
        <em>merchant</em> supplies — not by thresholding a score. Move the risk and the cart
        value and watch the winner change.
      </motion.p>

      <motion.div className="rig rig--el" {...settle}>
        <div className="rig__controls">
          <label className="ctl">
            <span className="ctl__label">entailment risk
              <span className="mono ctl__val">{p.toFixed(2)}</span></span>
            <input type="range" min={0} max={1} step={0.01} value={p}
                   onChange={(e) => setP(+e.target.value)} />
          </label>
          <label className="ctl">
            <span className="ctl__label">cart value
              <span className="mono ctl__val">{inr(L)}</span></span>
            <input type="range" min={200} max={50000} step={100} value={L}
                   onChange={(e) => setL(+e.target.value)} />
          </label>
        </div>

        <div className="rig__out">
          <ol className="bars">
            {(Object.keys(el) as Admission[]).map((k) => (
              <li key={k} data-win={k === win || undefined}>
                <span className="bar__k mono">{k}</span>
                <span className="bar__t">
                  <motion.i animate={{ width: `${(el[k] / max) * 100}%` }}
                            transition={{ duration: T.slow, ease: E.reveal }} />
                </span>
                <span className="bar__v mono">{inr(el[k])}</span>
              </li>
            ))}
          </ol>
          <p className="formula mono">EL(step_up) = c_step + p · (1 − r_step) · L</p>
        </div>

        <p className="assume">
          <span className="mono">c_step ₹45</span> — message, plus the checkout it interrupts<br />
          <span className="mono">c_hold ₹140</span> — review minutes, plus a delayed order<br />
          <span className="mono">r_step 0.70</span> · <span className="mono">r_hold 0.95</span> — share of bad carts each actually catches<br />
          <span className="mono">margin 18% of cart</span> — lost when a good cart is refused<br /><br />
          Stated assumptions with no public source, recorded as assumptions — not measurements.
        </p>
      </motion.div>
    </>
  );
}
