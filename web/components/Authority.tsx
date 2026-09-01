'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { POLICY, type Verdict } from '@/lib/data';
import { inr, money } from '@/lib/util';
import { T, E, settle } from '@/lib/motion';

/* A faithful port of governor.decide. Authority runs strongest-first, Decision.reasons is a
   list that accumulates, and _deny clears it outright — all three of which the page has to
   reproduce or it is showing a different system than the one in the tree. */

const PAYMENT = 50_000_00, PRIOR_EXPOSURE = 48_000_00;
const SESSION_SPEND = 3_200_00, DAY_SPEND = 22_400_00;

type Rung = 'pass' | 'escalate' | 'deny';

type Outcome = { action: Verdict; reasons: string[]; rungs: { fired: Rung; note: string }[] };

function decide(amountMinor: number, score: number, w: {
  captured: boolean; write: boolean; exposed: boolean; unknown: boolean;
}): Outcome {
  const fired: Rung[] = ['pass', 'pass', 'pass', 'pass', 'pass'];
  const note = ['clear', 'write tier', 'certain', 'below threshold', 'within caps'];
  const reasons: string[] = [];
  let action: Verdict = 'ALLOW';
  const exposure = w.exposed ? PRIOR_EXPOSURE : 0;

  const deny = (r: number, why: string, short: string) => {
    action = 'DENY'; reasons.length = 0;                // _deny replaces the reason list
    fired[r] = 'deny'; note[r] = short; reasons.push(why);
  };
  const escalate = (r: number, why: string, short: string) => {
    if (action !== 'DENY') action = 'ESCALATE';
    fired[r] = 'escalate'; note[r] = short; reasons.push(why);
  };

  // 1. Accounting invariants. Not negotiable, not model-influenced, not approvable.
  if (!w.captured) {
    deny(0, 'payment is not captured; there are no funds to refund', 'not captured');
  } else if (exposure + amountMinor > PAYMENT) {
    deny(0, `would refund ${money(exposure + amountMinor)} against a payment of ${money(PAYMENT)}; `
          + 'refunds may not exceed the captured amount', 'over-refund');
  } else if (!w.write) {
    deny(1, 'agent holds a read-only tier for money-moving tools', 'read-only');   // 2. tier
  } else {
    // 3. Truth-plane confidence. Unknown is a reason to stop, not to proceed carefully.
    if (w.unknown) {
      escalate(2, '1 open obligation(s) on this payment are in an AMBIGUOUS state, so the '
             + 'effect of this refund cannot be predicted', 'UNKNOWN');
    }
    // 4. Duplicate risk. ESCALATE only — a low score never unlocks anything.
    if (score >= POLICY.risk_threshold) {
      escalate(3, `duplicate-risk ${score.toFixed(2)} >= ${POLICY.risk_threshold.toFixed(2)}: `
             + 'this intent resembles an obligation already in flight',
        `${score.toFixed(2)} ≥ ${POLICY.risk_threshold.toFixed(2)}`);
    }
    // 5. Caps. Three independent checks; each escalates on its own and they stack.
    const caps: [string, string][] = [];
    if (amountMinor > POLICY.max_auto_refund_minor)
      caps.push([`amount ${money(amountMinor)} exceeds the autonomous limit of `
               + `${money(POLICY.max_auto_refund_minor)}`, 'autonomous limit']);
    if (SESSION_SPEND + amountMinor > POLICY.session_cap_minor)
      caps.push([`session would reach ${money(SESSION_SPEND + amountMinor)} against a cap of `
               + `${money(POLICY.session_cap_minor)}`, 'session cap']);
    if (DAY_SPEND + amountMinor > POLICY.daily_cap_minor)
      caps.push([`daily spend would reach ${money(DAY_SPEND + amountMinor)} against a cap of `
               + `${money(POLICY.daily_cap_minor)}`, 'daily cap']);
    caps.forEach(([why]) => escalate(4, why, caps.length === 1 ? caps[0][1] : `${caps.length} caps`));
  }

  if (action === 'ALLOW' && !reasons.length)
    reasons.push('no open obligation matches this intent and all caps are satisfied');

  const stop = fired.indexOf('deny');
  const rungs = fired.map((f, i) => {
    const reached = stop === -1 || i <= stop;
    return { fired: reached ? f : ('pass' as Rung), note: reached ? note[i] : 'not reached' };
  });
  return { action, reasons, rungs };
}

const RUNGS = ['accounting invariants', 'permission tier', 'truth confidence',
               'duplicate-risk model', 'caps'];

export function Authority() {
  const [amt, setAmt] = useState(800);
  const [score, setScore] = useState(0);
  const [w, setW] = useState({ captured: true, write: true, exposed: false, unknown: false });
  const d = useMemo(() => decide(amt * 100, score, w), [amt, score, w]);
  const flip = (k: keyof typeof w) => setW((s) => ({ ...s, [k]: !s[k] }));

  return (
    <>
      <motion.p className="eyebrow" {...settle}>05 — and what the model is allowed to do</motion.p>
      <motion.h2 className="h2" {...settle}>A wrong model may only widen caution.</motion.h2>
      <motion.p className="body" {...settle}>
        The duplicate-risk model returns a number between 0 and 1. Drag it. It can raise the
        decision toward a human, and it can do nothing else — no score unlocks a cap, an
        invariant, or a permission tier.
      </motion.p>

      <motion.div className="rig" {...settle}>
        <div className="rig__controls">
          <label className="ctl">
            <span className="ctl__label">refund amount
              <span className="mono ctl__val">{inr(amt)}</span></span>
            <input type="range" min={100} max={30000} step={100} value={amt}
                   onChange={(e) => setAmt(+e.target.value)} />
          </label>
          <label className="ctl">
            <span className="ctl__label">duplicate-risk score
              <span className="mono ctl__val">{score.toFixed(2)}</span></span>
            <input type="range" min={0} max={1} step={0.01} value={score}
                   onChange={(e) => setScore(+e.target.value)} />
          </label>
          <fieldset className="ctl ctl__set">
            <legend className="ctl__label">state of the world</legend>
            <label className="chk"><input type="checkbox" checked={w.captured}
              onChange={() => flip('captured')} /> the payment is captured</label>
            <label className="chk"><input type="checkbox" checked={w.write}
              onChange={() => flip('write')} /> the agent holds a write tier</label>
            <label className="chk"><input type="checkbox" checked={w.exposed}
              onChange={() => flip('exposed')} /> <span className="mono">₹48,000</span> is already refunded against it</label>
            <label className="chk"><input type="checkbox" checked={w.unknown}
              onChange={() => flip('unknown')} /> an open obligation is <span className="mono">AMBIGUOUS</span></label>
          </fieldset>
          <p className="assume assume--ctx">
            <span className="mono">pay_Nx3f9K2</span> · ₹50,000 captured · this session has spent{' '}
            <span className="mono">₹3,200</span> · today <span className="mono">₹22,400</span><br />
            Policy defaults from <span className="mono">governor.Policy</span>: autonomous limit{' '}
            <span className="mono">₹1,000</span> · session cap <span className="mono">₹5,000</span> ·
            daily cap <span className="mono">₹25,000</span>.
          </p>
        </div>

        <div className="rig__out">
          <ol className="ladder">
            {RUNGS.map((t, i) => (
              <motion.li key={t} data-fired={d.rungs[i].fired}
                         animate={{ opacity: 1 }} transition={{ duration: T.fast }}>
                <span className="rung__n mono">{i + 1}</span>
                <span className="rung__t">{t}</span>
                <span className="rung__s mono">{d.rungs[i].note}</span>
              </motion.li>
            ))}
          </ol>
          <output className="verdict" data-v={d.action}>
            <span className="verdict__k">Decision</span>
            <motion.span className="verdict__v mono" key={d.action}
                         initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                         transition={{ duration: T.fast, ease: d.action === 'DENY' ? E.refuse : E.wary }}>
              {d.action}
            </motion.span>
            <ul className="verdict__why mono">
              {d.reasons.map((r) => (
                <motion.li key={r} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                           transition={{ duration: T.fast, ease: E.reveal }}>{r}</motion.li>
              ))}
            </ul>
          </output>
        </div>
      </motion.div>
    </>
  );
}
