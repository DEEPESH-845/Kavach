'use client';

/* The full decision stream.
 *
 * Live means polled, and the UI says so rather than implying a socket it does not have.
 * Polling is paused while the tab is hidden (usePoll) and while the operator is reading a
 * page of history, because a stream that reorders under a cursor is a stream nobody can
 * read.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, usePoll } from '@/lib/useApi';
import { count } from '@/lib/format';
import { Async, Card, Empty, GoLink, PageHead, Skeleton } from '@/components/console/ui';
import { StreamTable } from '@/components/console/StreamTable';

const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'ESCALATE', label: 'Escalated' },
  { key: 'DENY', label: 'Refused' },
  { key: 'EXECUTED', label: 'Executed' },
  { key: 'APPROVED', label: 'Approved' },
] as const;

export default function StreamPage() {
  const [filter, setFilter] = useState<string>('');
  const [live, setLive] = useState(true);

  const stream = useApi(() => api.stream(120), []);
  usePoll(useCallback(() => stream.reload(), [stream.reload]), 8_000, live);

  const filtered = useMemo(() => {
    const items = stream.data?.items ?? [];
    return filter ? items.filter((i) => i.status === filter) : items;
  }, [stream.data, filter]);

  return (
    <>
      <PageHead
        title="Decision Stream"
        sub="Every intent Kavach has governed, newest first. Each row opens the decision, the truth it was decided against, and the events that prove it."
        actions={
          <>
            <button
              className="btn btn--sm"
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              title={live ? 'Polling every 8 seconds' : 'Polling paused'}
            >
              {live ? <Pause size={12} /> : <Play size={12} />}
              {live ? 'Live' : 'Paused'}
            </button>
            <button className="btn btn--sm" onClick={stream.reload} disabled={stream.loading}>
              <RefreshCw size={12} /> Refresh
            </button>
          </>
        }
      />

      <div className="chipbar" style={{ marginBottom: 14 }} role="group" aria-label="Filter by outcome">
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            className="chip"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {stream.data && f.key ? (
              <span style={{ marginLeft: 6, opacity: 0.6 }}>
                {stream.data.items.filter((i) => i.status === f.key).length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <Card flush>
        <Async state={stream} skeleton={<Skeleton rows={9} />}>
          {(s) => filtered.length === 0 ? (
            s.items.length === 0 ? (
              <Empty
                title="Nothing has been governed yet"
                body="Kavach records a decision for every intent an agent raises. Run a scenario to produce one, or seed the reference ledger."
                action={<GoLink href="/dashboard/adversary">Open the Adversary Lab</GoLink>}
              />
            ) : (
              <Empty
                title={`No ${filter} decisions`}
                body={`${count(s.items.length)} decisions loaded, none with this outcome.`}
                action={<button className="btn btn--sm" onClick={() => setFilter('')}>Show everything</button>}
              />
            )
          ) : (
            <StreamTable items={filtered} />
          )}
        </Async>
      </Card>

      {stream.data ? (
        <p className="section__note" style={{ marginTop: 12 }}>
          Showing {count(filtered.length)} of {count(stream.data.items.length)} loaded decisions.
          {live ? ' Refreshing every 8 seconds while this tab is visible.' : ' Polling paused.'}
        </p>
      ) : null}
    </>
  );
}
