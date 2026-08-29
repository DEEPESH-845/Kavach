'use client';

/* The obligation ledger.
 *
 * A spend cap asks "is this under the limit?". An idempotency key asks "have I seen this
 * exact request?". Neither asks the question this page answers: is there already money in
 * flight for this obligation? That is what makes the duplicate visible, so it gets a page
 * rather than a widget.
 */

import Link from 'next/link';
import { Boxes, Clock, HelpCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { count, duration, money, moneyShort } from '@/lib/format';
import {
  Async, Card, Empty, GoLink, PageHead, Section, Skeleton, Stat, State, Td,
} from '@/components/console/ui';

export default function ObligationsPage() {
  const obs = useApi(() => api.obligations(), []);

  return (
    <>
      <PageHead
        title="Obligation Ledger"
        sub="Every entity Kavach holds whose obligation is still open — money owed, dispatched, or in flight but not yet credited. Recomputed from the event log on every request; there is no stored total that could drift from it."
      />

      <Async state={obs} skeleton={<Skeleton rows={7} />}>
        {(o) => o.count === 0 ? (
          <Card>
            <Empty
              title="No open obligations"
              body="Every obligation Kavach holds has been credited or terminally closed. The ledger is clear — this is the state you want, not an absence of data."
              action={<GoLink href="/dashboard/payments">Browse payments</GoLink>}
            />
          </Card>
        ) : (
          <>
            <div className="grid grid--stats">
              <Stat
                icon={<Boxes size={13} />}
                label="Total open exposure"
                tone="steel"
                value={moneyShort(o.total_minor)}
                note={`across ${count(o.count)} obligation${o.count === 1 ? '' : 's'}`}
              />
              <Stat
                icon={<Clock size={13} />}
                label="Oldest"
                tone={o.oldest_seconds > 6 * 3600 ? 'amber' : 'bone'}
                value={duration(o.oldest_seconds)}
                note="since the last state-changing event on that entity"
              />
              <Stat
                icon={<HelpCircle size={13} />}
                label="Ambiguous"
                tone={o.ambiguous > 0 ? 'amber' : 'bone'}
                value={count(o.ambiguous)}
                note={o.ambiguous
                  ? 'past the staleness tolerance: the state is unknown, not assumed unchanged'
                  : 'every open obligation has a state we can currently assert'}
              />
            </div>

            <Section title="Open obligations" note="oldest first — age is the signal that matters here">
              <Card flush>
                <div className="tablewrap">
                  <table className="table table--stack">
                    <thead>
                      <tr>
                        <th>Entity</th><th className="r">Amount</th><th>Rail state</th>
                        <th>Confidence</th><th className="r">Idle</th><th>Because</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((f) => (
                        <tr key={`${f.entity_type}:${f.entity_id}`} data-clickable=""
                          onClick={() => {
                            window.location.href =
                              `/dashboard/${f.entity_type}s?id=${encodeURIComponent(f.entity_id)}`;
                          }}>
                          <Td label="Entity">
                            <span className="cell__id cell__strong">{f.entity_id}</span>
                            <div className="cell__sub">{f.entity_type}</div>
                          </Td>
                          <Td label="Amount" right>
                            <span className="cell__amount">{money(f.amount_minor)}</span>
                          </Td>
                          <Td label="Rail state"><State value={f.rail_state} /></Td>
                          <Td label="Confidence"><State value={f.confidence} /></Td>
                          <Td label="Idle" right>
                            <span className="cell__id"
                              style={{ color: f.unresolved_for > 6 * 3600 ? 'var(--amber)' : undefined }}>
                              {duration(f.unresolved_for)}
                            </span>
                          </Td>
                          <Td label="Because">
                            <span className="cell__clip" title={f.because}>{f.because}</span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </Section>

            <p className="section__note" style={{ marginTop: 14 }}>
              Exposure counts open obligations plus intents Kavach committed to whose provider
              result has not been observed. That second half is the window every duplicate
              refund is born in — see the{' '}
              <Link href="/dashboard/reconciliation">reconciliation queue</Link>.
            </p>
          </>
        )}
      </Async>
    </>
  );
}
