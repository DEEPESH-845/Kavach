'use client';

/* Proof & Audit.
 *
 * The most important thing on this page is the paragraph stating what the chain does NOT
 * prove. A hash chain is tamper-EVIDENT, not tamper-proof; it says nothing about who wrote
 * an event; and an attacker with write access could rewrite it from the point of an edit
 * forward. Those limits come from the backend in every response rather than being written
 * here, so the UI cannot overstate the claim by forgetting to mention them.
 *
 * `sig_verified` is shown as a separate column for the same reason. The chain says the row
 * has not changed. The HMAC says Razorpay actually sent it. Merging them into one green
 * tick would overstate both.
 */

import { useCallback, useState } from 'react';
import { Link2, RefreshCw, ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '@/lib/api';
import type { EventRow } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { count, hash, stamp } from '@/lib/format';
import {
  Async, Badge, Card, Empty, GoLink, KV, PageHead, Section, Skeleton, Stat,
} from '@/components/console/ui';
import { Tamper } from '@/components/proof/Tamper';

export default function ProofPage() {
  const [limit, setLimit] = useState(60);
  const chain = useApi(() => api.chain(limit), [limit]);
  const reload = useCallback(() => chain.reload(), [chain.reload]);

  return (
    <>
      <PageHead
        title="Proof & Audit"
        sub="Every event carries a SHA-256 over its own immutable fields and its predecessor's hash. Verification recomputes the whole chain — it does not read a stored flag."
        actions={
          <button className="btn btn--sm" onClick={reload} disabled={chain.loading}>
            <RefreshCw size={12} /> Re-verify
          </button>
        }
      />

      <Async state={chain} skeleton={<Skeleton rows={8} />}>
        {(c) => (
          <>
            <div className="grid grid--stats">
              <Card>
                <div className="stat">
                  <span className="stat__label">
                    {c.status.ok ? <ShieldCheck size={13} /> : <ShieldX size={13} />}
                    Chain integrity
                  </span>
                  <span className={`stat__value stat__value--${c.status.ok ? 'steel' : 'oxide'}`}
                    style={{ fontSize: 20 }}>
                    {c.status.ok ? 'VERIFIED' : 'BROKEN'}
                  </span>
                  <span className="stat__note">
                    {c.status.ok
                      ? 'every event reproduces its stored hash'
                      : c.status.detail}
                  </span>
                </div>
              </Card>
              <Stat label="Events checked" value={count(c.status.checked)}
                note={`of ${count(c.status.events)} in the log`} />
              <Stat label="Broken links" value={c.status.ok ? '0' : '1+'}
                tone={c.status.ok ? 'bone' : 'oxide'}
                note={c.status.ok ? 'the sequence is unaltered' : `first break at seq ${c.status.broken_at}`} />
              <Card>
                <div className="stat">
                  <span className="stat__label"><Link2 size={13} /> Head</span>
                  <span className="stat__value" style={{ fontSize: 14 }}>
                    {hash(c.status.head, 12, 8)}
                  </span>
                  <span className="stat__note">the tip of the chain right now</span>
                </div>
              </Card>
            </div>

            <Section title="Break it yourself" note="the edit lands in a copy; verification fails at the exact row">
              <Tamper onRestore={reload} />
            </Section>

            <Section title="What this proves — and what it does not"
              note="shipped with every proof response, so it cannot be dropped from the UI">
              <Card>
                <KV rows={[
                  ['Proves', c.claims.proves],
                  ['Does not prove', c.claims.does_not_prove],
                  ['Known limit', c.claims.limit],
                  ['Algorithm', <code className="mono" key="a">{c.claims.algorithm}</code>],
                ]} />
              </Card>
            </Section>

            <Section
              title="The chain"
              note="newest first — each event's hash covers the one before it"
              actions={
                <div className="chipbar">
                  {[60, 150, 200].map((n) => (
                    <button key={n} className="chip" aria-pressed={limit === n}
                      onClick={() => setLimit(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              }
            >
              <Card flush>
                {c.items.length === 0 ? (
                  <Empty
                    title="The log is empty"
                    body="Kavach derives everything it believes from this log. With no events there are no facts, and none are invented to fill the gap."
                    action={<GoLink href="/dashboard/adversary">Produce some</GoLink>}
                  />
                ) : (
                  <div className="chain">
                    {c.items.map((e) => <ChainLink key={e.seq} event={e} />)}
                  </div>
                )}
              </Card>
              {c.next_before ? (
                <p className="section__note" style={{ marginTop: 12 }}>
                  Showing the newest {count(c.items.length)} of {count(c.status.events)} events.
                </p>
              ) : null}
            </Section>
          </>
        )}
      </Async>
    </>
  );
}

function ChainLink({ event: e }: { event: EventRow }) {
  return (
    <div className="link">
      <div className="link__seq">
        {e.seq}
        <div style={{ marginTop: 4 }}>
          <Badge tone={e.verified ? 'info' : 'deny'} bare>
            {e.verified ? 'ok' : 'break'}
          </Badge>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="link__type">{e.event_type}</span>
          <Badge tone="mute" bare>{e.source}</Badge>
          <Badge
            tone={e.sig_verified ? 'info' : 'mute'}
            title={e.sig_verified
              ? 'HMAC-SHA256 verified over the raw webhook body: the rail actually sent this'
              : 'not a signature-verified webhook, so it can never yield DERIVED_CERTAIN'}
          >
            {e.sig_verified ? 'HMAC verified' : 'unsigned source'}
          </Badge>
          <a
            className="cell__id"
            href={`/dashboard/${e.entity_type === 'intent' ? 'decisions' : `${e.entity_type}s`}?id=${encodeURIComponent(e.entity_id)}`}
            style={{ color: 'var(--steel)', textDecoration: 'none' }}
          >
            {e.entity_type}:{e.entity_id}
          </a>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fog2)' }} className="mono">
            {stamp(e.occurred_at)}
          </span>
        </div>
        <div className="link__hash">
          prev <b>{hash(e.previous_event_hash, 10, 6)}</b>
          {'  →  '}
          this <b>{hash(e.event_hash, 10, 6)}</b>
        </div>
      </div>
    </div>
  );
}
