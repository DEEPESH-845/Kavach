'use client';

/* Raw event rows. Used wherever the log itself is on screen.
 *
 * `sig_verified` is rendered as a distinct badge rather than folded into a generic
 * "verified" tick, because it answers a different question from the hash chain:
 * the chain says the row has not been altered, the HMAC says Razorpay actually sent it.
 * Collapsing the two would overstate both.
 */

import type { EventRow } from '@/lib/api';
import { duration, hash, stamp } from '@/lib/format';
import { Badge, Td } from './ui';

export function EventTable({ events, showEntity }: { events: EventRow[]; showEntity?: boolean }) {
  return (
    <div className="tablewrap">
      <table className="table table--stack">
        <thead>
          <tr>
            <th className="r">Seq</th>
            <th>Type</th>
            {showEntity ? <th>Entity</th> : null}
            <th>Source</th>
            <th>Occurred</th>
            <th>Provenance</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq}>
              <Td label="Seq" right><span className="cell__id">{e.seq}</span></Td>
              <Td label="Type"><span className="cell__id cell__strong">{e.event_type}</span></Td>
              {showEntity ? (
                <Td label="Entity">
                  <span className="cell__id">{e.entity_id}</span>
                  <div className="cell__sub">{e.entity_type}</div>
                </Td>
              ) : null}
              <Td label="Source"><span className="cell__id">{e.source}</span></Td>
              <Td label="Occurred">
                <span className="cell__id">{stamp(e.occurred_at)}</span>
                <div className="cell__sub">
                  {duration(Math.max(0, e.received_at - e.occurred_at))} to reach us
                </div>
              </Td>
              <Td label="Provenance">
                <Badge
                  tone={e.sig_verified ? 'info' : 'mute'}
                  title={e.sig_verified
                    ? 'HMAC-SHA256 verified over the raw webhook body: Razorpay sent this'
                    : 'not a signature-verified webhook, so it can never yield DERIVED_CERTAIN'}
                >
                  {e.sig_verified ? 'HMAC' : 'unsigned'}
                </Badge>
              </Td>
              <Td label="Hash">
                <span className="cell__id" title={e.event_hash}>{hash(e.event_hash)}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
