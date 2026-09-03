'use client';

/* The principal's phone. One question, two buttons, then the outcome.
 *
 * Everything shown comes from /api/stepup/{token}: the amount, the items, who is asking,
 * why Kavach stopped. The envelope never reaches this page. Expired, invalid, already
 * resolved and a double tap each get their own honest screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { ApiError, journeyApi } from '@/lib/api';
import type { StepUpResolved, StepUpView } from '@/lib/api';
import { useAction, useApi } from '@/lib/useApi';
import { money, risk as fmtRisk } from '@/lib/format';

export function ApproveClient() {
  const token = useSearchParams().get('t') ?? '';
  const view = useApi(() => token ? journeyApi.stepUpView(token) : Promise.reject(new ApiError(404, 'not_found', 'No approval token in this link.')), [token]);
  const act = useAction((action: 'approve' | 'deny') => journeyApi.stepUpResolve(token, action, 'priya-phone'));
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const v = view.data;
    if (!v || v.status !== 'PENDING') return;
    const end = v.expires_at;
    const tick = () => setLeft(Math.max(0, end - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [view.data]);

  const decide = useCallback(async (a: 'approve' | 'deny') => {
    const out = await act.call(a);
    if (out) view.reload();
  }, [act, view]);

  return (
    <main className="console bazaar approve">
      <div className="ap-card">
        <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: '.2em', color: 'var(--fog2)' }}>
          KAVACH · RE-CONSENT
        </p>
        {view.error ? <Problem error={view.error} /> : null}
        {!view.data && !view.error ? <div className="skeleton" style={{ height: 200 }} /> : null}
        {view.data ? <Body v={view.data} left={left} pending={act.pending} result={act.result} error={act.error} onDecide={decide} /> : null}
      </div>
    </main>
  );
}

function Problem({ error }: { error: ApiError }) {
  const expired = error.status === 410;
  return (
    <div className="ap-big" data-t={expired ? 'warn' : 'deny'}>
      {expired ? <Clock /> : <ShieldAlert />}
      <h1>{expired ? 'This request has expired' : error.status === 404 ? 'This link is not one Kavach issued' : error.message}</h1>
      <p>{expired ? 'The agent must ask again. Nothing was charged.' : error.status === 404 ? 'Approval links are single-use and carry a random token. Nothing was decided.' : error.remedy}</p>
    </div>
  );
}

function Body({ v, left, pending, result, error, onDecide }: {
  v: StepUpView; left: number | null; pending: boolean; result: StepUpResolved | null;
  error: ApiError | null; onDecide: (a: 'approve' | 'deny') => void;
}) {
  if (v.status === 'APPROVED' || v.status === 'DENIED' || v.status === 'EXPIRED') {
    const ok = v.status === 'APPROVED';
    return (
      <>
        <div className="ap-big" data-t={ok ? 'allow' : v.status === 'EXPIRED' ? 'warn' : 'deny'}>
          {ok ? <CheckCircle2 /> : v.status === 'EXPIRED' ? <Clock /> : <XCircle />}
          <h1>{ok ? 'Approved' : v.status === 'EXPIRED' ? 'Expired' : 'Denied'}</h1>
          <p>
            {ok ? `${money(v.amount_minor)} admitted against your mandate and charged. The agent may now pay.`
              : v.status === 'EXPIRED' ? 'No answer arrived in time. Nothing was charged.'
              : 'The cart is refused. Nothing was charged against your mandate.'}
          </p>
          {result && !result.applied ? <p className="ap-ttl">Already {v.status.toLowerCase()} — this tap changed nothing.</p> : null}
          {(v.result?.audit_event_seq as number | undefined) ? <p className="ap-ttl">audit event seq {String(v.result.audit_event_seq)} · resolved by {v.resolved_by}</p> : null}
        </div>
        <p className="field__hint" style={{ textAlign: 'center' }}>You can close this page. The desktop updates on its own.</p>
      </>
    );
  }

  return (
    <>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <p style={{ margin: '0 0 4px', color: 'var(--fog)', fontSize: 13 }}>
            Your agent <span className="mono" style={{ color: 'var(--bone)' }}>{v.agent_id}</span> wants to spend
          </p>
          <div className="ap-amount">{money(v.amount_minor)}</div>
          <p className="ap-ttl" style={{ marginTop: 6 }}>at {v.merchant_id} · cap {money(v.per_txn_cap_minor, { round: true })} per order</p>
        </div>
        <div className="ap-items" aria-label="Items">
          {v.items.map((it) => (
            <div className="ap-item" key={it.description}>
              <span>{it.name}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</span>
              <span>{money(it.total_minor, { round: true })}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--amber-wash)', border: '1px solid var(--amber)' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--bone)' }}>
            <b style={{ fontWeight: 500 }}>Why Kavach stopped:</b> your mandate says{' '}
            <em style={{ fontStyle: 'normal', color: 'var(--amber)' }}>“{v.purpose}”</em>. The model is not sure this cart is that
            {v.purpose_risk !== null ? ` (purpose-mismatch risk ${fmtRisk(v.purpose_risk)})` : ''}. Every cap and category passed.
          </p>
        </div>
        {left !== null ? <p className="ap-ttl" style={{ margin: 0 }}>expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p> : null}
      </div>

      {error ? <p style={{ color: 'var(--oxide)', fontSize: 13, margin: 0 }}>{error.message}</p> : null}

      <div className="ap-acts">
        <button className="btn btn--danger" onClick={() => onDecide('deny')} disabled={pending || left === 0}>
          <XCircle size={16} /> Deny
        </button>
        <button className="btn btn--primary" onClick={() => onDecide('approve')} disabled={pending || left === 0}>
          <CheckCircle2 size={16} /> {pending ? 'Working…' : 'Approve'}
        </button>
      </div>
      <p className="field__hint" style={{ textAlign: 'center' }}>
        Approving re-runs admission at this moment — a revoked or expired mandate is still refused. Only then is your mandate charged.
      </p>
    </>
  );
}
