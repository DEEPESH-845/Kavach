'use client';

import { motion } from 'motion/react';
import { REPORT, TOOLS, TREE } from '@/lib/data';
import { settle } from '@/lib/motion';
import gsap from 'gsap';
import { useScene } from '@/lib/useScene';

const LOG = [
  { seq: 'seq 12', src: 'webhook · refund.created',   says: <>rail → <span className="mono" data-steel>ACCEPTED</span></>,   trust: 'HMAC verified', cited: true },
  { seq: 'seq 17', src: 'webhook · refund.processed', says: <>rail → <span className="mono" data-steel>PROCESSING</span></>, trust: 'HMAC verified', cited: true },
  { seq: 'seq 23', src: 'api · fetch refund',         says: <>no ARN present</>,                                            trust: 'unverified source', amber: true },
  { seq: '—',      src: 'nothing',                    says: <>no event states the customer was credited</>,                 trust: ' ', absent: true },
];

export function Proof() {
  const ref = useScene<HTMLElement>((q) => {
    gsap.from(q('.chain__log li'), {
      scrollTrigger: { trigger: '.chain__log', start: 'top 82%' },
      opacity: 0, x: -14, duration: 0.5, stagger: 0.11, ease: 'power2.out',
    });
    gsap.from(q('.chain__fact'), {
      scrollTrigger: { trigger: '.chain__log', start: 'top 60%' },
      opacity: 0, duration: 0.7, delay: 0.2, ease: 'power2.out',
    });
    gsap.from(q('.tools li'), {
      scrollTrigger: { trigger: '.tools', start: 'top 85%' },
      opacity: 0, y: 12, duration: 0.45, stagger: 0.045, ease: 'power2.out',
    });
  });

  return (
    <section className="sec sec--proof" id="proof" ref={ref}>
      <div className="wrap">
        <motion.p className="eyebrow" {...settle}>08 — the shared spine</motion.p>
        <motion.h2 className="h2" {...settle}>Every fact cites the events behind it.</motion.h2>
        <motion.p className="body" {...settle}>
          Facts are derived from an append-only log, never asserted. A decision replayed against
          the same events and the same clock returns the same verdict months later — which is what
          a chargeback on an agent-initiated order actually requires.
        </motion.p>

        <motion.figure className="chain" {...settle}>
          <figcaption className="cell__caption">the evidence behind the refund this page opened with</figcaption>
          <ol className="chain__log">
            {LOG.map((e) => (
              <li key={e.seq + e.src} data-cited={e.cited || undefined} data-absent={e.absent || undefined}>
                <span className="chain__seq mono">{e.seq}</span>
                <span className="chain__src mono">{e.src}</span>
                <span className="chain__says">{e.says}</span>
                <span className="chain__trust mono" data-amber={e.amber || undefined}>{e.trust}</span>
              </li>
            ))}
          </ol>
          <p className="chain__fact mono">
            FinancialFact(rfnd_Hx9pQ2) · rail <span data-steel>PROCESSING</span> · obligation{' '}
            <span data-amber>OPEN</span> · <span data-bone>DERIVED_CERTAIN</span> · evidence [12, 17]
          </p>
        </motion.figure>

        <motion.p className="body" {...settle}>
          The obligation is open because <em>no event closes it</em> — not because a model guessed.
          Replay those events against the same clock in six months and the verdict is identical,
          which is the only form a dispute can actually use.
        </motion.p>

        <motion.dl className="facts" {...settle}>
          <div><dt className="mono">DERIVED_CERTAIN</dt><dd>a signature-verified event states this directly</dd></div>
          <div><dt className="mono">DERIVED_PROBABLE</dt><dd>inferred, or from an unverified source</dd></div>
          <div><dt className="mono">UNKNOWN</dt><dd>contradicted, or stale past tolerance — never “unchanged”</dd></div>
        </motion.dl>

        <motion.div className="swap" {...settle}>
          <p className="eyebrow">the deployment vector</p>
          <p className="body body--tight">
            Kavach ships as an MCP server with Razorpay-compatible tool names. Swapping is one
            config line — same tools, same arguments. They return financial facts, and they can refuse.
          </p>
          <pre className="code mono"><code>{'{ "mcpServers": { "kavach": { "command": "kavach-mcp-server" } } }'}</code></pre>
          <ul className="tools">
            {TOOLS.map((t) => (
              <li key={t.n} data-write={t.w || undefined}>
                <span className="tools__n mono">{t.n}</span>
                <span className="tools__k mono">{t.w ? 'write' : 'read-only'}</span>
                <span className="tools__d">{t.d}</span>
              </li>
            ))}
          </ul>
          <p className="assume">
            Every one but <span className="mono">create_refund</span> is annotated read-only —
            admission and verification move no money. <span className="mono">create_refund</span> is
            the only tool that does, and the only one that can refuse.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* The sign-off: the project's name, and what is actually checked.
 *
 * The mark is the brand, set exactly as the header nav and the console sidebar set it, so
 * all three agree and the page is bookended rather than signed off with a different word at
 * each end. It used to read `proof.`, which is worse than a stray slogan: `proof` names a
 * plane in this system — the hash chain, section 08 — so reusing it here both repeated that
 * section and widened the word from "the chain verifies" into a general claim of confidence.
 *
 * The counts beside it are asserted against the tree by tests/test_site.py. Baselines are
 * derived from the report rather than typed, so a re-run that adds or drops one cannot leave
 * a stale count behind.
 */
export function Foot() {
  const baselines = REPORT.results.filter((r) => !r.hero).length;

  return (
    <footer className="foot">
      <div className="wrap foot__in">
        <p className="foot__mark">
          <span className="nav__glyph" aria-hidden />
          <span className="foot__name">KAVACH</span>
        </p>

        <dl className="foot__stats">
          <div>
            <dt>tests</dt>
            <dd className="mono">{TREE.tests}</dd>
          </div>
          <div>
            <dt>adversary scenarios</dt>
            <dd className="mono">{TREE.scenarios}</dd>
          </div>
          <div>
            <dt>baselines beaten</dt>
            <dd className="mono">{baselines}</dd>
          </div>
        </dl>

        <p className="foot__meta mono">
          test mode only · Razorpay AI Buildathon 2026
        </p>
      </div>
    </footer>
  );
}
