'use client';

/* Priya's mandate: what she delegated, and how much of it is left.
 *
 * Editable in the two places a judge will want to push on -- the purpose and the caps --
 * because the argument of the product is that the caps are the easy half. Everything the
 * card shows about spend comes from admissions the backend actually charged.
 */

import { KeyRound } from 'lucide-react';
import { money } from '@/lib/format';
import { cartTotal, journey, useJourney } from '@/lib/journey';

export function MandateCard({ focus }: { focus?: boolean }) {
  const j = useJourney();
  const m = j.mandate;
  if (!m || !j.store) return <div className="skeleton skeleton--card" />;

  const cap = m.per_txn_cap_minor;
  const total = cartTotal(j.lines);
  const share = cap > 0 ? total / cap : 0;
  const cumShare = m.cumulative_cap_minor > 0 ? j.spentMinor / m.cumulative_cap_minor : 0;
  const tone = share > 1 ? 'over' : share > 0.8 ? 'warn' : undefined;

  const setCap = (k: 'per_txn_cap_minor' | 'cumulative_cap_minor') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rupees = Number(e.target.value.replace(/[^\d]/g, '')) || 0;
      journey.setMandate({ [k]: rupees * 100 });
    };

  return (
    <div className="card" data-focus={focus || undefined}>
      <div className="bz-who">
        <span className="bz-avatar" aria-hidden>PS</span>
        <div>
          <b>{j.store.principal.name}</b>
          <span>principal · <span className="mono">{m.principal_id}</span></span>
        </div>
        <span style={{ marginLeft: 'auto' }} className="badge badge--info"><KeyRound size={11} /> MANDATE</span>
      </div>

      <label className="stat__label" htmlFor="bz-purpose" style={{ marginBottom: 6 }}>Purpose</label>
      <textarea
        id="bz-purpose"
        className="textarea bz-purpose"
        rows={2}
        value={m.purpose}
        onChange={(e) => journey.setMandate({ purpose: e.target.value })}
        aria-describedby="bz-purpose-hint"
      />
      <p id="bz-purpose-hint" className="field__hint" style={{ marginTop: -6, marginBottom: 10 }}>
        Free text. The entailment model scores every cart against this sentence, not against
        the category list.
      </p>

      <div className="bz-caps">
        <div className="bz-cap">
          <small>per order</small>
          <input aria-label="Per-order cap in rupees" inputMode="numeric" value={`₹${Math.round(cap / 100).toLocaleString('en-IN')}`}
            onChange={setCap('per_txn_cap_minor')} />
        </div>
        <div className="bz-cap">
          <small>over 7 days</small>
          <input aria-label="Cumulative cap in rupees" inputMode="numeric" value={`₹${Math.round(m.cumulative_cap_minor / 100).toLocaleString('en-IN')}`}
            onChange={setCap('cumulative_cap_minor')} />
        </div>
      </div>

      <div className="bz-meter" data-tone={tone} role="meter" aria-label="Cart against the per-order cap"
        aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(total, cap)}>
        <i style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <div className="bz-meter-l">
        <span>cart {money(total, { round: true })}</span>
        <span>{share > 1 ? `over by ${money(total - cap, { round: true })}` : `${money(cap - total, { round: true })} left this order`}</span>
      </div>

      <div className="bz-meter" style={{ marginTop: 10 }} role="meter" aria-label="Spent against the cumulative cap"
        aria-valuemin={0} aria-valuemax={m.cumulative_cap_minor} aria-valuenow={j.spentMinor}>
        <i style={{ width: `${Math.min(100, cumShare * 100)}%`, background: 'var(--fog2)' }} />
      </div>
      <div className="bz-meter-l">
        <span>spent {money(j.spentMinor, { round: true })}</span>
        <span>of {money(m.cumulative_cap_minor, { round: true })} this week</span>
      </div>

      <div className="bz-tags" aria-label="Delegated categories">
        {j.store.categories.map((c) => (
          <button key={c} type="button" className="bz-tag"
            data-on={m.categories.includes(c) || undefined}
            data-off={!m.categories.includes(c) || undefined}
            aria-pressed={m.categories.includes(c)}
            onClick={() => journey.setMandate({
              categories: m.categories.includes(c) ? m.categories.filter((x) => x !== c) : [...m.categories, c],
            })}>
            {c}
          </button>
        ))}
      </div>
      <p className="field__hint" style={{ marginTop: 8 }}>
        Merchant <span className="mono">{m.merchant_allowlist[0]}</span> · agent{' '}
        <span className="mono">{m.agent_id}</span> · signed Ed25519 by a simulated principal key;
        the signature check is real.
      </p>
    </div>
  );
}
