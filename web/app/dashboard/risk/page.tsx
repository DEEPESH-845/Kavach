'use client';

/* Risk Intelligence.
 *
 * The vocabulary here is deliberate and load-bearing. This page never says "fraud detected"
 * or "confidence". It says risk score, model signal, estimated probability, decision
 * threshold, policy consequence — because the estimator answers exactly one question
 * ("is this intent the same obligation as something already in flight?") and every broader
 * claim would be one the evidence does not support.
 *
 * The precision number is stated as a COST, not a boast: roughly one in five escalations
 * delays a legitimate refund, and that cost is the reason the model escalates rather than
 * denies.
 */

import { useMemo } from 'react';
import { Gauge, Info } from 'lucide-react';
import { api } from '@/lib/api';
import type { StreamItem } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { count, money, pct, risk as fmtRisk, stamp } from '@/lib/format';
import {
  Async, Badge, Card, Empty, GoLink, KV, PageHead, Section, Skeleton, Stat, State, Td,
  useRowNav,
} from '@/components/console/ui';

export default function RiskPage() {
  const stream = useApi(() => api.stream(200), []);
  const policy = useApi(() => api.policy(), []);
  const health = useApi(() => api.health(), []);
  const row = useRowNav();

  const scored = useMemo(
    () => (stream.data?.items ?? []).filter((i) => i.risk !== null),
    [stream.data]);

  const threshold = (policy.data?.limits.risk_threshold as number) ?? 0.5;
  const above = scored.filter((i) => (i.risk ?? 0) >= threshold);
  const modelLoaded = health.data?.models.duplicate_risk;

  return (
    <>
      <PageHead
        title="Risk Intelligence"
        sub="One model, one question: is this new request asking for money we have already sent? It is not a fraud score and it cannot approve anything — the strongest thing it can do is push a decision toward a human."
      />

      {modelLoaded === false ? (
        <Card>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={16} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ color: 'var(--bone)', fontSize: 13.5, marginBottom: 4 }}>
                No duplicate-risk model is loaded in this environment.
              </div>
              <p style={{ margin: 0, fontSize: 13 }}>
                Intents are still governed — invariants, tiers, truth-plane confidence and caps
                all run. What is missing is the layer that recognises a paraphrased duplicate.
                Run <code className="mono">make bench</code> to train and write{' '}
                <code className="mono">data/risk_model.pkl</code>.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Async state={stream} skeleton={<Skeleton rows={6} />}>
        {() => (
          <>
            <div className="grid grid--stats">
              <Stat
                icon={<Gauge size={13} />}
                label="Intents scored"
                value={count(scored.length)}
                note="the question only makes sense where something was already asked for on the same payment"
              />
              <Stat
                label="At or above threshold"
                tone={above.length ? 'amber' : 'bone'}
                value={count(above.length)}
                note="each was sent to a human; the model refused nothing by itself"
              />
              <Stat
                label="Decision threshold"
                value={threshold.toFixed(3)}
                note={policy.data?.threshold_source ?? '—'}
              />
              <Stat
                label="Amount under flag"
                tone={above.length ? 'amber' : 'bone'}
                value={money(above.reduce((n, i) => n + i.amount_minor, 0), { round: true })}
                note="asked for by the requests the model flagged"
              />
            </div>

            <Section title="Score distribution" note="every scored intent in this ledger">
              <Card>
                {scored.length === 0 ? (
                  <Empty
                    title="Nothing has been scored"
                    body="The estimator only runs where a duplicate is possible — that is, where a prior intent already exists on the same target. A first-ever intent has nothing to duplicate, and scoring it would be inventing a number."
                  />
                ) : (
                  <Histogram items={scored} threshold={threshold} />
                )}
              </Card>
            </Section>

            <Section title="Flagged intents" note="ordered by score">
              <Card flush>
                {above.length === 0 ? (
                  <Empty
                    title="Nothing is above the threshold"
                    body="No intent in this ledger resembles an obligation already in flight closely enough to warrant a human."
                    action={<GoLink href="/dashboard/adversary">Try to produce one</GoLink>}
                  />
                ) : (
                  <div className="tablewrap">
                    <table className="table table--stack">
                      <thead>
                        <tr>
                          <th className="r">Score</th><th>Raised</th><th>Agent</th>
                          <th>Target</th><th className="r">Amount</th><th>Reason</th><th>Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...above].sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0)).map((i) => (
                          <tr key={i.intent_id}
                            {...row(`/dashboard/decisions?id=${encodeURIComponent(i.intent_id)}`,
                                    `Open decision on ${i.target_id}`)}>
                            <Td label="Score" right>
                              <span className="cell__amount" style={{ color: 'var(--amber)' }}>
                                {fmtRisk(i.risk)}
                              </span>
                            </Td>
                            <Td label="Raised"><span className="cell__id">{stamp(i.created_at)}</span></Td>
                            <Td label="Agent">
                              <span className="cell__id">{i.agent_id}</span>
                              <div className="cell__sub">{i.session_id}</div>
                            </Td>
                            <Td label="Target"><span className="cell__id">{i.target_id}</span></Td>
                            <Td label="Amount" right><span className="cell__amount">{money(i.amount_minor)}</span></Td>
                            <Td label="Reason"><span className="cell__clip" title={i.reason_text}>{i.reason_text}</span></Td>
                            <Td label="Outcome"><State value={i.status} /></Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </Section>
          </>
        )}
      </Async>

      <Section title="What this model may and may not do">
        <div className="grid grid--2">
          <Card>
            <KV rows={[
              ['Question', 'is this intent the same obligation as one already in flight?'],
              ['Output', 'an estimated probability in [0, 1] and a per-decision attribution'],
              ['Authority', <Badge tone="warn" key="a">ADVISORY ONLY</Badge>],
              ['Can escalate', 'yes — a score at or above the threshold pushes a decision to a human'],
              ['Can authorise', 'no. A score of 0.00 unlocks nothing on its own'],
              ['Can override an invariant', 'no. Accounting invariants sit above it in the ladder'],
            ]} />
          </Card>
          <Card>
            <div className="stat__label" style={{ marginBottom: 10 }}>The cost of being wrong</div>
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              At the reported operating point the estimator&rsquo;s precision is{' '}
              <b style={{ color: 'var(--bone)' }}>{pct(0.8131868131868132, 1)}</b> — roughly one
              in five escalations delays a legitimate refund for a real customer.
            </p>
            <p style={{ margin: 0, fontSize: 13 }}>
              That cost is exactly why the governor lets this model escalate and never deny.
              A layer that is wrong one time in five must not be the layer that closes a door.
              The measured numbers behind this live in{' '}
              <a href="/dashboard/evaluations">Evaluations</a>.
            </p>
          </Card>
        </div>
      </Section>
    </>
  );
}

/* A histogram of ten buckets. Deliberately not a line chart: these are independent
 * decisions, not a series over time, and drawing them as a trend would invent a
 * relationship between consecutive intents that does not exist. */
function Histogram({ items, threshold }: { items: StreamItem[]; threshold: number }) {
  const buckets = useMemo(() => {
    const b = Array.from({ length: 10 }, () => 0);
    for (const i of items) b[Math.min(9, Math.floor((i.risk ?? 0) * 10))] += 1;
    return b;
  }, [items]);
  const max = Math.max(...buckets, 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
        {buckets.map((n, i) => {
          const lo = i / 10;
          const flagged = lo + 0.05 >= threshold;
          return (
            <div key={i} style={{ flex: 1, display: 'grid', gap: 5, justifyItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--fog2)' }} className="mono">{n || ''}</span>
              <div
                title={`${n} intent${n === 1 ? '' : 's'} scored ${lo.toFixed(1)}–${(lo + 0.1).toFixed(1)}`}
                style={{
                  width: '100%',
                  height: `${Math.max(n ? 4 : 1, (n / max) * 86)}px`,
                  background: n === 0 ? 'var(--seam)' : flagged ? 'var(--amber)' : 'var(--steel)',
                  opacity: n === 0 ? 0.5 : 0.85,
                  borderRadius: '3px 3px 0 0',
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {buckets.map((_, i) => (
          <span key={i} className="mono"
            style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: 'var(--fog2)' }}>
            {(i / 10).toFixed(1)}
          </span>
        ))}
      </div>
      <p className="field__hint" style={{ marginTop: 12 }}>
        Blue is below the governor&rsquo;s threshold of {threshold.toFixed(3)}; amber is at or
        above it and was escalated. Buckets, not a trend line — these are independent
        decisions, not a series.
      </p>
    </div>
  );
}
