'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { KINDS, POLICY, REPORT } from '@/lib/data';
import { inr, seeded } from '@/lib/util';
import { T, E, settle, useStill } from '@/lib/motion';

/* The same authority ladder, at volume. A faithful port of corpus.generate(): a payment
   carries 1-3 obligations whose amounts fit inside it with headroom, and 12% of intents
   re-decide one already acted on. Seeded, so the replay is identical on every load. */

const MAX = 8;
type Row = { key: number; id: string; what: string; risk: number | null; v: 'ALLOW' | 'ESCALATE' | 'DENY'; ms: string };

function useReplay() {
  return useRef(
    (() => {
      const rnd = seeded(7);
      const pick = <A,>(a: A[]) => a[(rnd() * a.length) | 0];
      let minted = 0, key = 0;

      const mint = () => {
        const amount = pick([49900, 129900, 249900, 500000, 1250000]);
        const kinds: typeof KINDS = [], n = pick([1, 1, 2, 2, 3]);
        while (kinds.length < n) { const k = pick(KINDS); if (!kinds.includes(k)) kinds.push(k); }
        let shares = kinds.map((k) => k.share[0] + rnd() * (k.share[1] - k.share[0]));
        const sum = shares.reduce((a, b) => a + b, 0), cap = 0.45 + rnd() * 0.53;
        // obligations fit the payment and usually leave headroom; that headroom is what
        // makes a duplicate interesting, because arithmetic alone will not catch it
        if (sum > cap) shares = shares.map((v) => (v * cap) / sum);
        return {
          id: 'pay_' + (10237 + ((minted++ * 613) % 8900)),
          amount, captured: rnd() > 0.04, exposure: 0,
          done: [] as { kind: typeof KINDS[number]; amount: number }[],
          queue: kinds.map((k, i) => ({ kind: k, amount: Math.max(100, Math.round((amount * shares[i]) / 100) * 100) })),
        };
      };

      const pays = Array.from({ length: 9 }, mint);

      return (): Row => {
        const idx = (rnd() * pays.length) | 0;
        let p = pays[idx];
        // ADR-014: a duplicate is only possible where something is already open
        const dup = p.done.length > 0 && rnd() < REPORT.duplicate_rate_assumption;
        if (!dup && !p.queue.length) { pays[idx] = mint(); p = pays[idx]; }
        const ob = dup ? pick(p.done) : p.queue.shift()!;
        const risk = p.done.length === 0 ? null : dup ? 0.58 + rnd() * 0.41 : rnd() * 0.44;

        let v: Row['v'];
        if (!p.captured) v = 'DENY';                                     // 1. invariant
        else if (p.exposure + ob.amount > p.amount) v = 'DENY';          // 1. invariant
        else if (rnd() < 0.05) v = 'ESCALATE';                           // 3. UNKNOWN
        else if (risk !== null && risk >= POLICY.risk_threshold) v = 'ESCALATE';  // 4. model
        else { v = 'ALLOW'; p.exposure += ob.amount; p.done.push(ob); }
        if (!p.captured) pays[idx] = mint();

        return {
          key: key++, id: p.id, risk, v,
          what: `${inr(ob.amount / 100)} · “${pick(ob.kind.texts)}”`,
          ms: `${1 + Math.floor(rnd() * 3)} ms`,
        };
      };
    })(),
  ).current;
}

export function Stream() {
  const still = useStill();
  const next = useReplay();
  const host = useRef<HTMLDivElement>(null);
  const seen = useInView(host, { margin: '0px 0px -10% 0px' });
  const [rows, setRows] = useState<Row[]>([]);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [tally, setTally] = useState({ ALLOW: 0, ESCALATE: 0, DENY: 0 });
  const warmed = useRef(false);

  useEffect(() => {
    // With nothing open, no intent can be a duplicate, so a cold stream is a wall of
    // ALLOWs that misrepresents the system. The replay joins a merchant already mid-day.
    if (warmed.current) return;
    warmed.current = true;
    for (let i = 0; i < 18; i++) next();

    if (still) {
      // a still page gets a still stream: the eight rows are the tail of a longer run and
      // the tally carries the actual mix, rather than eight rows chosen to look balanced
      const t = { ALLOW: 0, ESCALATE: 0, DENY: 0 };
      for (let i = 0; i < 52; i++) t[next().v]++;
      const tail = Array.from({ length: MAX }, () => next());
      tail.forEach((r) => t[r.v]++);
      setRows(tail.reverse()); setTally(t);
    }
  }, [next, still]);

  useEffect(() => {
    if (still || !seen) return;
    const add = () => {
      const r = next();
      setRows((prev) => [r, ...prev].slice(0, MAX));
      setDeciding(r.key);
      setTimeout(() => {
        setDeciding((d) => (d === r.key ? null : d));
        setTally((t) => ({ ...t, [r.v]: t[r.v] + 1 }));
      }, 340);
    };
    add();
    const id = setInterval(add, 700);
    return () => clearInterval(id);
  }, [seen, next, still]);

  return (
    <motion.div className="stream" ref={host} {...settle}>
      <div className="stream__head">
        <p className="eyebrow">the same five checks, running at speed</p>
        <p className="stream__src mono">replay · made-up test data · not real traffic</p>
      </div>

      <ol className="stream__rows">
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const open = deciding === r.key;
            return (
              <motion.li key={r.key} layout data-v={open ? undefined : r.v}
                initial={still ? false : { opacity: 0, y: -7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: T.fast } }}
                transition={{ duration: T.normal, ease: E.reveal }}>
                {open && <i className="s__scan" />}
                <span className="s__id mono">{r.id}</span>
                <span className="s__what">{r.what}</span>
                <span className="s__risk mono">{r.risk === null ? '—' : r.risk.toFixed(2)}</span>
                <span className="s__v mono">{open ? 'deciding' : r.v}</span>
                <span className="s__ms mono">{open ? '' : r.ms}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      <dl className="stream__tally">
        <div><dt>allowed</dt><dd data-steel>{tally.ALLOW}</dd></div>
        <div><dt>escalated</dt><dd data-amber>{tally.ESCALATE}</dd></div>
        <div><dt>denied</dt><dd data-oxide>{tally.DENY}</dd></div>
        <div><dt>decided in this replay</dt><dd>{tally.ALLOW + tally.ESCALATE + tally.DENY}</dd></div>
      </dl>

      <p className="stream__note">
        These are invented refunds, not real ones — but the wording, the mix, and every rule
        being applied come straight from the shipped code. Roughly{' '}
        <span className="mono">12%</span> of them are money already owed. A line travels across
        each row while the decision is open, and closes the moment the verdict lands.
      </p>
    </motion.div>
  );
}
