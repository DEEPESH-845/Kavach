'use client';

/* Unresolved outcomes: intents Kavach committed to and holds no provider result for.
 *
 * This is not an error list. It is the honest name for the window between deciding to move
 * money and observing that it moved — the window a naive agent fills by retrying, which is
 * how one obligation becomes two refunds. Kavach counts this window as exposure rather than
 * pretending it is closed.
 */

import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ago, count, money, stamp } from '@/lib/format';
import {
  Async, Card, Empty, GoLink, PageHead, Section, Skeleton, State, Td,
} from '@/components/console/ui';

export default function ReconciliationPage() {
  const list = useApi(() => api.reconciliation(), []);

  return (
    <>
      <PageHead
        title="Reconciliation"
        sub="Intents that were committed to but whose provider result has not been observed. The reconciler polls Razorpay and settles each one as EXECUTED or FAILED; until it does, the amount stays counted as exposure."
        actions={
          <button className="btn btn--sm" onClick={list.reload} disabled={list.loading}>
            <RefreshCw size={12} /> Refresh
          </button>
        }
      />

      <Async state={list} skeleton={<Skeleton rows={4} />}>
        {(d) => d.items.length === 0 ? (
          <Card>
            <Empty
              title="Every committed intent has an outcome"
              body="Nothing is stuck between a decision and its result. This is the state the reconciler exists to restore, and right now there is nothing to restore."
              action={<GoLink href="/dashboard/obligations">Obligation ledger</GoLink>}
            />
          </Card>
        ) : (
          <>
            <p className="section__note" style={{ marginBottom: 14 }}>
              {count(d.total)} unresolved outcome{d.total === 1 ? '' : 's'}.
            </p>
            <Card flush>
              <div className="tablewrap">
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th>Raised</th><th>Agent</th><th>Target</th>
                      <th className="r">Amount</th><th>Status</th><th>Waiting</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((i) => (
                      <tr key={i.intent_id}>
                        <Td label="Raised"><span className="cell__id">{stamp(i.created_at)}</span></Td>
                        <Td label="Agent">
                          <span className="cell__id">{i.agent_id}</span>
                          <div className="cell__sub">{i.session_id}</div>
                        </Td>
                        <Td label="Target"><span className="cell__id">{i.target_id}</span></Td>
                        <Td label="Amount" right><span className="cell__amount">{money(i.amount_minor)}</span></Td>
                        <Td label="Status"><State value={i.status} /></Td>
                        <Td label="Waiting"><span className="cell__id">{ago(i.created_at)}</span></Td>
                        <Td label="">
                          <GoLink href={`/dashboard/decisions?id=${encodeURIComponent(i.intent_id)}`}>
                            Decision
                          </GoLink>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Section title="How these resolve">
              <Card>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Run <code className="mono">python apps/reconciler.py</code>. It polls the
                  provider for refunds carrying the intent id in their notes, settles matches
                  as <code className="mono">EXECUTED</code>, and settles the rest as{' '}
                  <code className="mono">FAILED</code>. Nothing on this screen calls the
                  provider — the reconciler owns that, because it is the component that can
                  do it safely.
                </p>
              </Card>
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
