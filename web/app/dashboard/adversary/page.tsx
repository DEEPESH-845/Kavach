'use client';

/* Adversary Lab.
 *
 * Each scenario runs the real decision code in a fresh in-memory database seeded at a fixed
 * epoch. Two runs are identical, the judge's run matches ours, and nothing touches the
 * operator's ledger — so the lab cannot be used to inflate the numbers on the command
 * centre.
 *
 * The important detail is the OUTCOME column. A scenario declares what it expects the
 * system to do before it runs, and reports HELD or BROKEN against what actually happened.
 * If someone regresses the governor, this page turns red. A lab that can only ever say
 * "defended" is a screensaver.
 */

import { useCallback, useState } from 'react';
import {
  Bug, CircleAlert, FlaskConical, Play, ShieldAlert, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ScenarioResult, ScenarioSpec, Stage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { money, risk as fmtRisk } from '@/lib/format';
import {
  Async, Badge, Card, Json, Ladder, PageHead, Section, Skeleton, State, Why,
} from '@/components/console/ui';

type RunState = { pending: boolean; result?: ScenarioResult; error?: string };

export default function AdversaryLab() {
  const catalogue = useApi(() => api.scenarios(), []);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const run = useCallback(async (id: string) => {
    setRuns((r) => ({ ...r, [id]: { pending: true } }));
    setOpenId(id);
    try {
      const result = await api.runScenario(id);
      setRuns((r) => ({ ...r, [id]: { pending: false, result } }));
    } catch (e) {
      setRuns((r) => ({ ...r, [id]: { pending: false, error: (e as Error).message } }));
    }
  }, []);

  const runAll = useCallback(async (specs: ScenarioSpec[]) => {
    // Sequential, not parallel. Each one is milliseconds, and watching them land in order
    // is the point — a burst of eleven simultaneous results reads as a page load.
    for (const s of specs) await run(s.id);
  }, [run]);

  return (
    <>
      <PageHead
        title="Adversary Lab"
        sub="Attacks against the real decision code, in an isolated sandbox. Every scenario states what it expects Kavach to do, then reports what Kavach actually did — so a regression shows up here as a failing scenario rather than a passing animation."
        actions={
          <Async state={catalogue} skeleton={<span />}>
            {(c) => (
              <button className="btn btn--primary" onClick={() => runAll(c.items)}>
                <Zap size={13} /> Run everything
              </button>
            )}
          </Async>
        }
      />

      <Async state={catalogue} skeleton={<Skeleton rows={6} />}>
        {(c) => (
          <>
            <Card>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone="info"><FlaskConical size={11} aria-hidden /> ISOLATED SANDBOX</Badge>
                <span style={{ fontSize: 13, color: 'var(--fog)' }}>{c.note}.</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <Badge tone={c.models.duplicate_risk ? 'info' : 'warn'}>
                    duplicate-risk model {c.models.duplicate_risk ? 'loaded' : 'absent'}
                  </Badge>
                  <Badge tone={c.models.entailment ? 'info' : 'warn'}>
                    entailment model {c.models.entailment ? 'loaded' : 'absent'}
                  </Badge>
                </div>
              </div>
            </Card>

            {(['outbound', 'inbound'] as const).map((plane) => {
              const items = c.items.filter((s) => s.plane === plane);
              if (!items.length) return null;
              return (
                <Section
                  key={plane}
                  title={plane === 'outbound' ? 'Outbound — agents moving our money' : 'Inbound — agents spending someone else\'s'}
                  note={plane === 'outbound'
                    ? 'refunds and payouts, governed by truth, exposure and the duplicate-risk estimator'
                    : 'delegated carts, governed by the envelope, the mandate and the entailment model'}
                >
                  <div className="stack stack--wide">
                    {items.map((s) => (
                      <ScenarioCard
                        key={s.id}
                        spec={s}
                        state={runs[s.id]}
                        open={openId === s.id}
                        onRun={() => run(s.id)}
                        onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                      />
                    ))}
                  </div>
                </Section>
              );
            })}
          </>
        )}
      </Async>
    </>
  );
}

function ScenarioCard({ spec, state, open, onRun, onToggle }: {
  spec: ScenarioSpec; state?: RunState; open: boolean; onRun: () => void; onToggle: () => void;
}) {
  const r = state?.result;
  const outcomeTone = r?.outcome === 'HELD' ? 'allow'
    : r?.outcome === 'BROKEN' ? 'deny' : 'warn';

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ color: 'var(--bone)', fontSize: 14.5, fontWeight: 500 }}>{spec.title}</span>
            <Badge tone={spec.severity === 'critical' ? 'deny'
              : spec.severity === 'control' ? 'info' : 'warn'}>
              {spec.severity}
            </Badge>
            {r ? <Badge tone={outcomeTone}>{r.outcome}</Badge> : null}
          </div>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--fog)' }}>{spec.question}</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--fog2)' }}>
            Defence: {spec.defence} · expects {spec.expect.join(' or ')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {r ? (
            <button className="btn btn--sm btn--ghost" onClick={onToggle}>
              {open ? 'Hide' : 'Show'}
            </button>
          ) : null}
          <button className="btn" onClick={onRun} disabled={state?.pending}>
            {state?.pending ? <><Bug size={13} /> Attacking…</> : <><Play size={13} /> Attack</>}
          </button>
        </div>
      </div>

      {state?.error ? (
        <p style={{ marginTop: 12, color: 'var(--oxide)', fontSize: 13 }}>{state.error}</p>
      ) : null}

      {r && open ? <ScenarioResultView r={r} /> : null}
    </Card>
  );
}

function ScenarioResultView({ r }: { r: ScenarioResult }) {
  const verdict = r.actual;
  const reasons = r.admission?.reasons ?? r.decision?.reasons ?? [];
  const risk = r.admission ? r.admission.purpose_risk : (r.decision?.duplicate_risk ?? null);
  const factors = r.admission?.risk_factors ?? r.decision?.risk_factors ?? [];

  return (
    <div className="detail-panel stack" style={{ marginTop: 16 }}>
      <div>
        <div className="stat__label" style={{ marginBottom: 8 }}>What was set up</div>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13, color: 'var(--fog)' }}>
          {r.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>

      <Why
        verdict={verdict}
        why={reasons}
        risk={risk === null || risk === undefined
          ? <span style={{ color: 'var(--fog2)' }}>
              not scored — a deterministic layer decided before any model was consulted
            </span>
          : <>{fmtRisk(risk)}
              {factors.length
                ? <div className="mono" style={{ marginTop: 4, fontSize: 12, color: 'var(--fog2)' }}>
                    {factors.join('  ·  ')}
                  </div>
                : null}</>}
        evidence={<Outcome r={r} />}
        next={r.outcome === 'HELD'
          ? 'The defence named above is what stopped it. Nothing was simulated.'
          : r.outcome === 'BROKEN'
            ? 'The system did NOT do what this scenario expected. That is a real regression, reported rather than hidden.'
            : 'The model this scenario needs is not loaded, so the question could not be answered. Reported rather than passed.'}
        extra={<span className="mono" style={{ fontSize: 11.5, color: 'var(--fog2)' }}>
          {r.elapsed_ms} ms
        </span>}
      />

      {r.admission?.stages ? (
        <div>
          <div className="stat__label" style={{ marginBottom: 10 }}>Admission ladder</div>
          <Ladder rungs={r.admission.stages as Stage[]} />
        </div>
      ) : null}

      {r.admission?.cart ? (
        <div>
          <div className="stat__label" style={{ marginBottom: 8 }}>
            The cart · {money(r.admission.cart.total_minor)}
          </div>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Item</th><th>Category</th><th className="r">Qty</th><th className="r">Total</th></tr></thead>
              <tbody>
                {r.admission.cart.lines.map((l) => (
                  <tr key={l.sku}>
                    <td>
                      <span className="cell__id cell__strong">{l.description}</span>
                      {l.liquid ? <div className="cell__sub">liquid — trivially resaleable</div> : null}
                    </td>
                    <td><span className="cell__id">{l.category}</span></td>
                    <td className="r"><span className="cell__id">{l.quantity}</span></td>
                    <td className="r"><span className="cell__amount">{money(l.total_minor)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone="info">epoch {r.sandbox.epoch}</Badge>
        <span style={{ fontSize: 12, color: 'var(--fog2)' }}>{r.sandbox.note}.</span>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--fog)' }}>
          Raw result
        </summary>
        <div style={{ marginTop: 10 }}>
          <Json value={r} max={340} />
        </div>
      </details>
    </div>
  );
}

function Outcome({ r }: { r: ScenarioResult }) {
  if (r.outcome === 'BROKEN') {
    return (
      <span style={{ color: 'var(--oxide)' }}>
        <ShieldAlert size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} aria-hidden />
        Expected {r.expected.join(' or ')}, got <b>{r.actual}</b>.
      </span>
    );
  }
  if (r.outcome === 'MODEL_UNAVAILABLE') {
    return (
      <span style={{ color: 'var(--amber)' }}>
        <CircleAlert size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} aria-hidden />
        This scenario needs a trained model that is not loaded in this environment. Run{' '}
        <code className="mono">make bench</code> and <code className="mono">make gate-bench</code>.
      </span>
    );
  }
  return (
    <>
      Expected <State value={r.expected[0]} />
      {r.expected.length > 1 ? ` (or ${r.expected.slice(1).join(', ')})` : ''}, got{' '}
      <State value={r.actual} />.
    </>
  );
}
