'use client';

/* The cart, and the one button that matters: present the mandate to Kavach. */

import { ShieldCheck, ShoppingBag, Trash2 } from 'lucide-react';
import { money } from '@/lib/format';
import { cartTotal, journey, useJourney } from '@/lib/journey';

export function CartPanel({ focus }: { focus?: boolean }) {
  const j = useJourney();
  const total = cartTotal(j.lines);
  const cap = j.mandate?.per_txn_cap_minor ?? 0;
  const inScope = new Set(j.mandate?.categories ?? []);
  const busy = j.phase === 'admitting' || j.phase === 'paying' || j.phase === 'planning';

  return (
    <div className="card" data-focus={focus || undefined}>
      <div className="stat__label" style={{ marginBottom: 8 }}>
        <ShoppingBag size={13} /> Cart
        {j.cartId ? <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--fog2)' }}>{j.cartId}</span> : null}
      </div>
      {j.lines.length === 0 ? (
        <p className="field__hint">Empty. The agent has not shopped yet.</p>
      ) : (
        <div className="bz-cart">
          {j.lines.map((l) => (
            <div className="bz-line" key={l.sku}>
              <div>
                <b>{l.name ?? l.description}</b>
                <small data-liquid={l.liquid || undefined} data-out={!inScope.has(l.category) || undefined}>
                  {l.liquid ? 'stored value · ' : ''}{!inScope.has(l.category) ? 'outside mandate · ' : ''}{money(l.unit_amount_minor, { round: true })} each
                </small>
              </div>
              <span className="bz-qty" aria-label={`Quantity of ${l.name ?? l.description}`}>
                <button onClick={() => journey.setQuantity(l.sku, l.quantity - 1)} disabled={busy} aria-label="Decrease">−</button>
                <span>{l.quantity}</span>
                <button onClick={() => journey.setQuantity(l.sku, l.quantity + 1)} disabled={busy} aria-label="Increase">+</button>
              </span>
              <span className="cell__amount">{money(l.unit_amount_minor * l.quantity, { round: true })}</span>
            </div>
          ))}
          <div className="bz-total">
            <small>{cap ? `${Math.round((total / cap) * 100)}% of the per-order cap` : ''}</small>
            <b>{money(total)}</b>
          </div>
        </div>
      )}

      <div className="bz-ctx">
        <label className="field__label" htmlFor="bz-ctx">What the agent read</label>
        <textarea id="bz-ctx" className="textarea" placeholder="(nothing untrusted)" value={j.untrusted}
          onChange={(e) => journey.setUntrusted(e.target.value)} />
        <span className="field__hint">Reviews and page text enter the provenance plane as data, never as instructions.</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn--primary" style={{ flex: 1 }} disabled={busy || j.lines.length === 0 || !j.mandate}
          onClick={() => journey.submit()}>
          <ShieldCheck size={13} /> {j.phase === 'admitting' ? 'Kavach is deciding…' : 'Present mandate & buy'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => journey.clear()} disabled={busy || j.lines.length === 0} aria-label="Clear cart">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
