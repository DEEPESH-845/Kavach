'use client';

/* The Governor: what is allowed, in what order, and by whose authority.
 *
 * The page is mostly one diagram, because the ordering IS the product. A cap knows the
 * amount; this knows the obligation. And nothing below a rung can reach past it — the
 * model cannot turn a DENY into an ALLOW, and neither can a human, here.
 *
 * There are no editable policy controls. That is a decision, not an omission, and the page
 * says so: a limit an operator can raise from the screen where it is failing them is not a
 * limit. The backend has no endpoint that would accept the edit.
 */

import { Lock, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { count, money } from '@/lib/format';
import {
  Async, Badge, Card, GoLink, PageHead, Section, Skeleton, Stat, State, Td,
} from '@/components/console/ui';

const KIND_TONE: Record<string, 'info' | 'warn'> = {
  deterministic: 'info',
  'learned, advisory': 'warn',
};

export default function GovernorPage() {
  const policy = useApi(() => api.policy(), []);
  const overview = useApi(() => api.overview(), []);

  return (
    <>
      <PageHead
        title="Governor"
        sub="May this agent move this money, right now? Authority runs strongest first, and anything the model says can make the outcome more cautious and nothing else."
        actions={<GoLink href="/dashboard/review">Review queue</GoLink>}
      />

      <Async state={policy} skeleton={<Skeleton rows={6} />}>
        {(p) => (
          <>
            <Section title="Order of authority" note="strongest first; nothing below a rung reaches past it">
              <div className="stack stack--tight">
                {p.authority_order.map((rung) => (
                  <Card key={rung.rank}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <span className="mono" style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        display: 'grid', placeItems: 'center', fontSize: 12,
                        border: '1px solid var(--seam2)', color: 'var(--fog)',
                      }}>{rung.rank}</span>
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
                          <span style={{ color: 'var(--bone)', fontSize: 14, fontWeight: 500 }}>
                            {rung.layer}
                          </span>
                          <Badge tone={KIND_TONE[rung.kind] ?? 'mute'}>{rung.kind}</Badge>
                          <State value={rung.outcome} />
                        </div>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--fog)' }}>{rung.note}.</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>

            <Section title="Limits in force" note={p.threshold_source}>
              <div className="grid grid--stats">
                <Stat
                  label="Autonomous refund limit"
                  value={money(p.limits.max_auto_refund_minor as number, { round: true })}
                  note="above this, a human approves — regardless of risk score"
                />
                <Stat
                  label="Session cap"
                  value={money(p.limits.session_cap_minor as number, { round: true })}
                  note="a new session is exactly how a duplicate is born, so sessions are capped"
                />
                <Stat
                  label="Daily cap"
                  value={money(p.limits.daily_cap_minor as number, { round: true })}
                  note="across every agent and session"
                />
                <Stat
                  label="Risk threshold"
                  value={(p.limits.risk_threshold as number).toFixed(3)}
                  note="at or above this the estimator escalates; it never denies"
                />
              </div>
            </Section>

            <Section title="Policy mutability">
              <Card>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Lock size={16} style={{ color: 'var(--steel)', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 6 }}>
                      <Badge tone="info">IMMUTABLE AT RUNTIME</Badge>
                    </div>
                    <p style={{ margin: 0, fontSize: 13 }}>{p.mutability_note}</p>
                    <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--fog2)' }}>
                      There is no API that edits these values, so this screen has no controls
                      to disable. Changing a limit is a code change with a review and a
                      deploy, which is the audit trail a financial control needs.
                    </p>
                  </div>
                </div>
              </Card>
            </Section>
          </>
        )}
      </Async>

      <Async state={overview} skeleton={<span />}>
        {(o) => (
          <Section title="What the ladder has done here" note="outcomes across every intent in this ledger">
            <Card flush>
              <div className="tablewrap">
                <table className="table table--stack">
                  <thead>
                    <tr><th>Outcome</th><th className="r">Intents</th><th>Meaning</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(o.by_status)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, n]) => (
                        <tr key={status}>
                          <Td label="Outcome"><State value={status} /></Td>
                          <Td label="Intents" right><span className="cell__id">{count(n)}</span></Td>
                          <Td label="Meaning">
                            <span style={{ color: 'var(--fog)' }}>{MEANING[status] ?? '—'}</span>
                          </Td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="section__note" style={{ marginTop: 12 }}>
              <ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} aria-hidden />
              Degradation only ever raises the floor. There is no failure path in this system
              that ends somewhere more permissive than the healthy one — a missing model
              widens caution, an unknown truth state escalates, and an unreachable provider
              leaves an intent unresolved rather than assumed successful.
            </p>
          </Section>
        )}
      </Async>
    </>
  );
}

const MEANING: Record<string, string> = {
  ALLOW: 'permitted without a human',
  APPROVED: 'released for execution; the provider has not been called yet',
  EXECUTED: 'the provider was called and returned a result',
  ESCALATE: 'held for a human — the governor refused to guess',
  DENY: 'refused by an invariant or a permission tier; not releasable by review',
  FAILED: 'the provider call failed; the reconciler owns resolving it',
  PROPOSED: 'recorded ahead of a decision (write-ahead), not yet settled',
};
