'use client';

/* The review queue: what Kavach stopped, and why it stopped it.
 *
 * The action buttons do exactly what the backend does and say so. Approving releases the
 * intent for execution and writes an audit event; it does NOT call Razorpay from a click,
 * because a provider call behind a button whose failure mode is a duplicate refund is the
 * wrong place for it. The response text comes from the server, so the UI cannot drift into
 * implying money moved.
 *
 * DENY is absent from the queue by construction -- a refusal by an accounting invariant is
 * not an escalation and no reviewer can release it here.
 */

import { useCallback, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Intent } from '@/lib/api';
import { useAction, useApi, usePoll } from '@/lib/useApi';
import { count, money, risk as fmtRisk, stamp } from '@/lib/format';
import {
  Async, Card, Empty, ErrorState, GoLink, PageHead, Skeleton, State, Why,
} from '@/components/console/ui';

export default function ReviewPage() {
  const queue = useApi(() => api.reviewQueue(), []);
  usePoll(useCallback(() => queue.reload(), [queue.reload]), 20_000);

  return (
    <>
      <PageHead
        title="Review Queue"
        sub="Intents the governor escalated rather than guess about. Each one says which rung of the authority ladder stopped it, and what the reviewer is being asked to decide."
        actions={
          <button className="btn btn--sm" onClick={queue.reload} disabled={queue.loading}>
            <RefreshCw size={12} /> Refresh
          </button>
        }
      />

      <Async state={queue} skeleton={<Skeleton rows={4} />}>
        {(q) => q.items.length === 0 ? (
          <Card>
            <Empty
              title="Nothing is waiting on a human"
              body="Every intent the governor saw was either released or refused outright. An empty queue means the automatic layers were sufficient — not that review is switched off."
              action={<GoLink href="/dashboard/stream">See what was decided</GoLink>}
            />
          </Card>
        ) : (
          <>
            <p className="section__note" style={{ marginBottom: 14 }}>
              {count(q.total)} intent{q.total === 1 ? '' : 's'} awaiting a decision.
            </p>
            <div className="stack">
              {q.items.map((i) => (
                <ReviewItem key={i.intent_id} intent={i} onDone={queue.reload} />
              ))}
            </div>
          </>
        )}
      </Async>
    </>
  );
}

function ReviewItem({ intent, onDone }: { intent: Intent; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const act = useAction((action: 'approve' | 'reject') =>
    api.review(intent.intent_id, { action, reviewer: 'operator', note }));

  const done = act.result;

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="mono" style={{ color: 'var(--bone)', fontSize: 15 }}>
          {money(intent.amount_minor)}
        </span>
        <span style={{ fontSize: 13, color: 'var(--fog)' }}>
          {intent.tool} on <code className="mono">{intent.target_id}</code>
        </span>
        <State value={done ? done.status : intent.status} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fog2)' }} className="mono">
          {stamp(intent.created_at)}
        </span>
      </div>

      <Why
        verdict={intent.decision.action ?? intent.status}
        why={intent.decision.reasons ?? []}
        risk={intent.decision.duplicate_risk === null || intent.decision.duplicate_risk === undefined
          ? <span style={{ color: 'var(--fog2)' }}>not assessed for this intent</span>
          : <>{fmtRisk(intent.decision.duplicate_risk)} duplicate-obligation probability
              {intent.decision.risk_factors?.length
                ? <div className="mono" style={{ marginTop: 4, fontSize: 12, color: 'var(--fog2)' }}>
                    {intent.decision.risk_factors.join('  ·  ')}
                  </div>
                : null}</>}
        evidence={<>
          Raised by <code className="mono">{intent.agent_id}</code> in session{' '}
          <code className="mono">{intent.session_id}</code>. Stated reason: “{intent.reason_text}”.
          {intent.decision.open_exposure
            ? <> ₹{intent.decision.open_exposure.toFixed(2)} was already committed against this target.</>
            : null}
        </>}
        next={done
          ? <span style={{ color: 'var(--bone)' }}>{done.what_happens_next}</span>
          : 'A human decides. Approving releases it for execution; rejecting closes it.'}
        extra={<GoLink href={`/dashboard/decisions?id=${encodeURIComponent(intent.intent_id)}`}>
          Full decision
        </GoLink>}
      />

      {act.error ? (
        <div style={{ marginTop: 12 }}>
          <ErrorState error={act.error} compact />
        </div>
      ) : null}

      {done ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge badge--info">
            <ShieldCheck size={11} aria-hidden /> recorded as event {done.audit_event_seq}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--fog2)' }}>
            Provider call: {done.provider_call}.
          </span>
          <button className="btn btn--sm btn--ghost" onClick={onDone}>Refresh queue</button>
        </div>
      ) : (
        <div className="stack stack--tight" style={{ marginTop: 14 }}>
          {open ? (
            <div className="field">
              <label className="field__label" htmlFor={`note-${intent.intent_id}`}>
                Reviewer note
              </label>
              <textarea
                id={`note-${intent.intent_id}`}
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you check before deciding?"
              />
              <span className="field__hint">
                Stored on the audit event, so the reason a human overrode the machine is
                part of the record rather than tribal knowledge.
              </span>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--go" disabled={act.pending}
              onClick={() => act.call('approve')}>
              <Check size={13} /> {act.pending ? 'Recording…' : 'Approve'}
            </button>
            <button className="btn btn--danger" disabled={act.pending}
              onClick={() => act.call('reject')}>
              <X size={13} /> Reject
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide note' : 'Add a note'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
