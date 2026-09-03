'use client';

/* The last screen. Visually loud, technically grounded: the three numbers at the bottom
 * are read from the API at the moment the screen opens. */

import Link from 'next/link';
import { api, journeyApi } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { count, moneyShort } from '@/lib/format';

export function Finale() {
  const overview = useApi(() => api.overview(), []);
  const health = useApi(() => journeyApi.health(), []);
  const o = overview.data;
  const h = health.data;
  const d = (i: number) => ({ animationDelay: `${i * 140}ms` });

  return (
    <section className="finale" aria-label="Thesis">
      <p className="fn-eyebrow" data-reveal style={d(0)}>05:00 · the thesis</p>
      <h1>
        <span data-reveal style={d(1)}>One agent.</span>
        <span data-reveal style={d(2)}>One mandate.</span>
        <span className="dim" data-reveal style={d(3)}>Many possible actions.</span>
      </h1>

      <div className="fn-tree">
        <div className="fn-root" data-reveal style={d(4)}>agent_desk_v1 · mandate mnd_home_office</div>
        <div className="fn-branches">
          <div className="fn-branch" data-v="ALLOW" data-reveal style={d(5)}><b>ALLOW</b><small>signature, scope, caps and purpose all hold; the mandate is charged</small></div>
          <div className="fn-branch" data-v="STEP-UP" data-reveal style={d(6)}><b>STEP-UP</b><small>the model is unsure; the principal decides on their own device</small></div>
          <div className="fn-branch" data-v="DENY" data-reveal style={d(7)}><b>DENY</b><small>arithmetic, scope, or a model that read the cart; no human waves it through</small></div>
        </div>
        <div className="fn-pillars">
          <div className="fn-pillar" data-reveal style={d(8)}><small>authority</small><b>An Ed25519 mandate</b><span>verified over the raw bytes before anything is parsed</span></div>
          <div className="fn-pillar" data-reveal style={d(9)}><small>policy</small><b>A fixed order</b><span>invariants, tiers, confidence, model, caps — a model may only widen caution</span></div>
          <div className="fn-pillar" data-reveal style={d(10)}><small>evidence</small><b>Facts, not statuses</b><span>rail state ≠ obligation state; unverified is never certain</span></div>
          <div className="fn-pillar" data-reveal style={d(11)}><small>proof</small><b>A hash chain</b><span>tamper-evident, replayable, exportable as a dispute pack</span></div>
        </div>
      </div>

      <div className="fn-close">
        <p data-reveal style={d(12)}>Agents need authority. Authority needs boundaries. Boundaries need evidence.</p>
        <p data-reveal style={d(13)}>Autonomy without governance is exposure.</p>
        <p className="dim" data-reveal style={d(14)}>Kavach turns autonomous action into accountable action.</p>
      </div>

      <div className="fn-live" data-reveal style={d(15)}>
        {o ? <><span><b>{count(o.governed.intents)}</b> decisions governed in this ledger</span><span><b>{moneyShort(o.refused.protected_minor)}</b> refused or held</span></> : null}
        {h ? <span><b>{count(h.integrity.events)}</b> events, chain {h.integrity.chain_intact ? 'verified' : 'BROKEN'}</span> : null}
        {h ? <span>Razorpay <b>{h.mode}</b> · webhook {h.webhook.configured ? 'verified' : 'not configured'}</span> : null}
      </div>

      <div className="fn-acts" data-reveal style={d(16)}>
        <Link className="btn btn--primary" href="/shop">Open the Bazaar</Link>
        <Link className="btn" href="/dashboard">Operator console</Link>
        <Link className="btn" href="/duel">Run the duel again</Link>
        <Link className="btn btn--ghost" href="/#divergence">Read the argument</Link>
      </div>
    </section>
  );
}
