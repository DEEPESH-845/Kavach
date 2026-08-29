'use client';

/* The decision stream, as a table. Shared by the command centre and the stream page so
 * the two can never disagree about what a decision looks like.
 *
 * Every row links to the same unified decision view. That continuity is the point: a judge
 * moving dashboard -> decision -> evidence -> proof should never meet a second layout for
 * the same object.
 */

import { useRouter } from 'next/navigation';
import type { StreamItem } from '@/lib/api';
import { clock, money, risk as fmtRisk, shortId } from '@/lib/format';
import { State, Td } from './ui';

export function StreamTable({ items, showAgent = true }: {
  items: StreamItem[]; showAgent?: boolean;
}) {
  const router = useRouter();
  const open = (id: string) => router.push(`/dashboard/decisions?id=${encodeURIComponent(id)}`);

  return (
    <div className="tablewrap">
      <table className="table table--stack">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            {showAgent ? <th>Agent</th> : null}
            <th>Target</th>
            <th className="r">Amount</th>
            <th className="r">Risk</th>
            <th>Why</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr
              key={i.intent_id}
              data-clickable=""
              tabIndex={0}
              role="link"
              aria-label={`Decision on ${i.target} for ${money(i.amount_minor)}`}
              onClick={() => open(i.intent_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i.intent_id); }
              }}
            >
              <Td label="Time">
                <span className="cell__id">{clock(i.created_at)}</span>
              </Td>
              <Td label="Action">
                <State value={i.action ?? i.status} />
              </Td>
              {showAgent ? (
                <Td label="Agent">
                  <span className="cell__id">{i.agent_id}</span>
                  <div className="cell__sub">{i.session_id}</div>
                </Td>
              ) : null}
              <Td label="Target">
                <span className="cell__id">{shortId(i.target_id, 18)}</span>
                <div className="cell__sub">{i.tool}</div>
              </Td>
              <Td label="Amount" right>
                <span className="cell__amount">{money(i.amount_minor)}</span>
              </Td>
              <Td label="Risk" right>
                <span
                  className="cell__id"
                  style={{ color: i.risk !== null && i.risk >= 0.5 ? 'var(--amber)' : undefined }}
                  title={i.risk === null
                    ? 'the estimator did not run for this intent'
                    : 'duplicate-obligation probability; advisory only'}
                >
                  {fmtRisk(i.risk)}
                </span>
              </Td>
              <Td label="Why">
                <span className="cell__clip" title={i.headline ?? undefined}>
                  {i.headline ?? '—'}
                </span>
              </Td>
              <Td label="Status">
                <State value={i.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
