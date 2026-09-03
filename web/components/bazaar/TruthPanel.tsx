'use client';

/* What the rail said, and how much it can be believed. Three columns -- observed source,
 * signature, truth state -- and a preview of what a configured webhook would make of the
 * same events, labelled simulated. Kavach does not confuse "we saw something" with "we
 * can prove it". */

import { ArrowRight, Landmark } from 'lucide-react';
import type { CheckoutStatus } from '@/lib/api';
import { hash, money } from '@/lib/format';
import { useJourney } from '@/lib/journey';
import { Badge, GoLink } from '@/components/console/ui';

export function TruthPanel({ status, focus }: { status?: CheckoutStatus; focus?: boolean }) {
  const j = useJourney();
  const s = status ?? j.checkout?.status;
  if (!s) return null;
  const conf = s.observed?.confidence ?? s.fact?.confidence ?? 'UNKNOWN';
  const tone = conf === 'DERIVED_CERTAIN' ? 'allow' : conf === 'DERIVED_PROBABLE' ? 'info' : 'warn';

  return (
    <div className="card" data-focus={focus || undefined} id="bz-truth">
      <div className="stat__label" style={{ marginBottom: 10 }}>
        <Landmark size={13} /> What Kavach believes about {s.payment_id ? <span className="mono" style={{ marginLeft: 4 }}>{s.payment_id}</span> : 'the payment'}
      </div>

      {!s.payment_id ? (
        <p className="field__hint">No payment observed yet for order <span className="mono">{s.order_id}</span>.</p>
      ) : (
        <>
          <div className="bz-truth">
            <div>
              <small>payment observed</small>
              <b>{s.observed?.source ?? '—'}</b>
            </div>
            <div data-tone={s.observed?.signature === 'verified' ? 'allow' : 'warn'}>
              <small>rail signature</small>
              <b>{s.observed?.signature ?? '—'}</b>
            </div>
            <div data-tone={tone}>
              <small>truth state</small>
              <b>{conf}</b>
            </div>
          </div>
          <p className="field__hint" style={{ marginTop: 10 }}>
            Rail state <span className="mono">{String(s.fact?.rail_state)}</span> · {money(s.amount_minor)} · {String(s.fact?.because)}.
            {' '}The checkout signature (<span className="mono">HMAC over order_id|payment_id</span>) is {s.signature_verified ? 'verified' : 'not verified'};
            it proves the binding of the two ids, not the payment&apos;s status — that came from an API fetch, which the truth plane grades as probable.
          </p>

          {s.preview_with_webhook ? (
            <div className="bz-upgrade">
              <div>
                <small className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--fog2)' }}>NOW · API response</small>
                <div><b style={{ color: 'var(--steel)' }}>{conf}</b></div>
              </div>
              <ArrowRight size={16} aria-hidden />
              <div>
                <small className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--fog2)' }}>WITH A SIGNED WEBHOOK · simulated preview</small>
                <div><b style={{ color: 'var(--jade)' }}>{s.preview_with_webhook.confidence}</b> <Badge tone="warn" bare>SIMULATED</Badge></div>
                <span className="field__hint" style={{ fontSize: 11 }}>
                  {s.webhook_configured ? 'a secret is configured; the next webhook upgrades this for real' : 'set RAZORPAY_WEBHOOK_SECRET and point Razorpay at /api/webhooks/razorpay'}
                </span>
              </div>
            </div>
          ) : null}

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--fog)' }}>Evidence rows ({s.checkout_events.length + s.payment_events.length})</summary>
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12 }}>
              {[...s.checkout_events, ...s.payment_events].map((e) => (
                <li key={e.seq} className="mono" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: 'var(--fog2)' }}>seq {e.seq}</span>
                  <span style={{ color: 'var(--bone)' }}>{e.event_type}</span>
                  <Badge tone={e.sig_verified ? 'info' : 'mute'} bare>{e.sig_verified ? 'HMAC' : 'unsigned'}</Badge>
                  <span style={{ color: 'var(--fog2)' }}>{hash(e.event_hash)}</span>
                </li>
              ))}
            </ul>
          </details>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {s.payment_id ? <GoLink href={`/dashboard/truth?type=payment&id=${encodeURIComponent(s.payment_id)}`}>Watch the derivation</GoLink> : null}
            <GoLink href="/dashboard/proof">Verify the chain</GoLink>
            <GoLink href="/dashboard/mcp">Refund it through MCP</GoLink>
          </div>
        </>
      )}
    </div>
  );
}
