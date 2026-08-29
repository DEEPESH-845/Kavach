'use client';

/* Command centre. Answers "what is happening?" above the fold, then shows the last
 * decisions Kavach made and why.
 *
 * Every tile is a query result. There is no seeded number here, and a tile whose value is
 * zero says what zero means rather than showing a bare 0 next to an alarming label.
 */

import Link from 'next/link';
import { useCallback } from 'react';
import {
  Activity, ArrowRight, Boxes, Gauge, ShieldCheck, ShieldX, TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, usePoll } from '@/lib/useApi';
import { count, duration, moneyShort, pct } from '@/lib/format';
import {
  Async, Card, Empty, GoLink, PageHead, Section, Stat, StatSkeleton,
} from '@/components/console/ui';
import { StreamTable } from '@/components/console/StreamTable';

export default function CommandCentre() {
  const overview = useApi(() => api.overview(), []);
  const stream = useApi(() => api.stream(12), []);

  const refresh = useCallback(() => { overview.reload(); stream.reload(); },
    [overview.reload, stream.reload]);
  usePoll(refresh, 15_000);

  return (
    <>
      <PageHead
        title="Command Centre"
        sub="Kavach governs what agents do with money and proves every decision either way. Everything below is derived from the event log at the moment you asked."
        actions={<GoLink href="/dashboard/adversary">Try to break it</GoLink>}
      />

      <Async state={overview} skeleton={<StatSkeleton n={4} />}>
        {(o) => (
          <>
            <div className="grid grid--stats">
              <Stat
                icon={<Boxes size={13} />}
                label="Open obligation"
                tone={o.exposure.open_minor > 0 ? 'steel' : 'bone'}
                value={moneyShort(o.exposure.open_minor)}
                note={o.exposure.open_count === 0
                  ? 'Nothing is in flight. Every obligation Kavach holds has been credited or closed.'
                  : `${o.exposure.open_count} obligation${o.exposure.open_count === 1 ? '' : 's'} in flight · oldest ${duration(o.exposure.oldest_seconds)}`}
              />
              <Stat
                icon={<ShieldX size={13} />}
                label="Refused or held"
                tone={o.refused.protected_minor > 0 ? 'oxide' : 'bone'}
                value={moneyShort(o.refused.protected_minor)}
                note={`${o.refused.denied} denied by invariant · ${o.refused.escalated} escalated to a human`}
              />
              <Stat
                icon={<Gauge size={13} />}
                label="Duplicate risk flagged"
                tone={o.refused.duplicate_flagged > 0 ? 'amber' : 'bone'}
                value={count(o.refused.duplicate_flagged)}
                note={o.refused.duplicate_flagged
                  ? 'intents the estimator scored at or above the governor threshold'
                  : 'no intent has scored above the threshold in this ledger'}
              />
              <Stat
                icon={<ShieldCheck size={13} />}
                label="Governed"
                value={count(o.governed.intents)}
                note={<>
                  {moneyShort(o.governed.amount_minor)} requested ·{' '}
                  {o.agents.admission_rate === null
                    ? 'no intents yet'
                    : `${pct(o.agents.admission_rate, 0)} admitted without a human`}
                </>}
              />
            </div>

            <Section title="Where attention is needed">
              <div className="grid grid--3">
                <Attention
                  href="/dashboard/review"
                  icon={<TriangleAlert size={14} />}
                  n={o.review_queue}
                  label="waiting on a human"
                  zero="Nothing is escalated. The governor released everything it saw."
                  some="Kavach stopped these rather than guess. Each says why."
                />
                <Attention
                  href="/dashboard/reconciliation"
                  icon={<Activity size={14} />}
                  n={o.unresolved_outcomes}
                  label="unresolved outcomes"
                  zero="Every committed intent has a provider result."
                  some="Committed, but no provider result has been observed yet."
                />
                <Attention
                  href="/dashboard/agents"
                  icon={<ShieldCheck size={14} />}
                  n={o.agents.active}
                  label="agents acting"
                  zero="No agent has acted against this merchant."
                  some="Identity, volume and refusal rate per agent."
                />
              </div>
            </Section>

            <Section
              title="Integrity"
              note="the event log is hash-chained; this is a recomputation, not a stored flag"
            >
              <Card>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`badge badge--${o.integrity.chain_verified ? 'info' : 'deny'}`}>
                    {o.integrity.chain_verified ? 'VERIFIED' : 'BROKEN'}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--fog)' }}>{o.integrity.message}</span>
                  <div style={{ marginLeft: 'auto' }}>
                    <GoLink href="/dashboard/proof">Inspect the chain</GoLink>
                  </div>
                </div>
              </Card>
            </Section>
          </>
        )}
      </Async>

      <Section
        title="Latest decisions"
        actions={
          <Link className="btn btn--sm" href="/dashboard/stream">
            Full stream <ArrowRight size={12} />
          </Link>
        }
      >
        <Card flush>
          <Async
            state={stream}
            skeleton={<div style={{ padding: 12 }}><StatSkeleton n={1} /></div>}
            empty={(s) => s.items.length === 0 ? (
              <Empty
                title="No decisions yet"
                body="Kavach has not been asked to govern anything against this ledger. Seed the demo with `make seed`, or send an intent from the Adversary Lab."
                action={<GoLink href="/dashboard/adversary">Open the lab</GoLink>}
              />
            ) : null}
          >
            {(s) => <StreamTable items={s.items} />}
          </Async>
        </Card>
      </Section>
    </>
  );
}

function Attention({ href, icon, n, label, zero, some }: {
  href: string; icon: React.ReactNode; n: number; label: string; zero: string; some: string;
}) {
  return (
    <Link href={href} className="card" style={{ textDecoration: 'none', display: 'block' }}>
      <div className="stat">
        <span className="stat__label">{icon}{label}</span>
        <span className={`stat__value${n > 0 ? ' stat__value--amber' : ''}`}>{count(n)}</span>
        <span className="stat__note">{n > 0 ? some : zero}</span>
      </div>
    </Link>
  );
}
