'use client';

/* Evaluations: the measured numbers, and the baselines they had to beat.
 *
 * These are read from evals/*.json, written by `make bench` and `make gate-bench` in CI —
 * not computed on request, and not typed into a slide. The baselines matter more than the
 * headline: "our model scores 0.81 precision" means nothing without "and the rule a
 * competent engineer would write scores 0.19 on the same split".
 *
 * The base rate is an ASSUMPTION and is labelled as one everywhere it appears. A leaked
 * amount computed against an assumed 12% duplicate rate is a projection, not a measurement.
 */

import { FlaskConical } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { money, pct } from '@/lib/format';
import {
  Async, Badge, Card, Empty, PageHead, Section, Skeleton, Td,
} from '@/components/console/ui';

type Row = {
  name: string; precision: number; recall: number;
  leaked_minor: number; review_rate: number; gloss?: string; hero?: boolean;
};

export default function EvaluationsPage() {
  const evals = useApi(() => api.evaluations(), []);

  return (
    <>
      <PageHead
        title="Evaluations"
        sub="Written by the benchmarks in CI, not computed on request. A regression in model quality fails the build the same way a broken test does."
      />

      <Async state={evals} skeleton={<Skeleton rows={6} />}>
        {(d) => {
          const risk = d.risk as {
            threshold?: number; duplicate_rate_assumption?: number; exposure_minor?: number;
            results?: Row[]; budget_sweep?: Record<string, number>[];
          } | null;
          const gate = d.gate as { results?: Row[] } | null;

          if (!risk && !gate) {
            return (
              <Card>
                <Empty
                  title="No benchmark reports found"
                  body="Run `make bench` and `make gate-bench` to train the estimators and write evals/risk_report.json and evals/gate_report.json. Nothing is substituted for a missing report."
                />
              </Card>
            );
          }

          return (
            <>
              {risk ? (
                <>
                  <Card>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone="info"><FlaskConical size={11} aria-hidden /> DUPLICATE RISK</Badge>
                      <span style={{ fontSize: 13 }}>
                        Frozen threshold <code className="mono">{risk.threshold?.toFixed(4)}</code>
                      </span>
                      <Badge tone="warn">
                        base rate {pct(risk.duplicate_rate_assumption ?? 0, 0)} — ASSUMED
                      </Badge>
                      {risk.exposure_minor ? (
                        <span style={{ fontSize: 13, color: 'var(--fog2)' }}>
                          {money(risk.exposure_minor, { round: true })} of duplicate exposure in the held-out split
                        </span>
                      ) : null}
                    </div>
                  </Card>

                  <Section title="Against every feasible baseline"
                    note="same split, same threshold budget — the comparison is the claim">
                    <Card flush><ResultsTable rows={risk.results ?? []} /></Card>
                  </Section>

                  {risk.budget_sweep?.length ? (
                    <Section title="Review-budget sweep"
                      note="how much a merchant catches for how much human review they buy">
                      <Card flush>
                        <div className="tablewrap">
                          <table className="table table--stack">
                            <thead>
                              <tr>
                                <th className="r">Budget</th><th className="r">Escalated</th>
                                <th className="r">Recall</th><th className="r">Precision</th>
                                <th className="r">Leaked</th><th className="r">Prevented</th>
                              </tr>
                            </thead>
                            <tbody>
                              {risk.budget_sweep.map((p, i) => (
                                <tr key={i}>
                                  <Td label="Budget" right><span className="cell__id">{pct(p.budget, 0)}</span></Td>
                                  <Td label="Escalated" right><span className="cell__id">{pct(p.escalated)}</span></Td>
                                  <Td label="Recall" right><span className="cell__id">{pct(p.recall)}</span></Td>
                                  <Td label="Precision" right><span className="cell__id">{pct(p.precision)}</span></Td>
                                  <Td label="Leaked" right>
                                    <span className="cell__amount" style={{ color: 'var(--oxide)' }}>
                                      {money(p.leaked_minor, { round: true })}
                                    </span>
                                  </Td>
                                  <Td label="Prevented" right>
                                    <span className="cell__amount" style={{ color: 'var(--jade)' }}>
                                      {money(p.prevented_minor, { round: true })}
                                    </span>
                                  </Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                      <p className="section__note" style={{ marginTop: 12 }}>
                        Rupee figures are projections against the assumed base rate, not
                        observed losses. They move linearly with that assumption, which is why
                        it is stated on every screen that quotes them.
                      </p>
                    </Section>
                  ) : null}
                </>
              ) : null}

              {gate?.results?.length ? (
                <Section title="Gate — cart entailment"
                  note="does the cart entail the mandate's stated purpose?">
                  <Card flush><ResultsTable rows={gate.results} /></Card>
                </Section>
              ) : null}

              <p className="section__note" style={{ marginTop: 16 }}>{d.note}.</p>
            </>
          );
        }}
      </Async>
    </>
  );
}

function ResultsTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty title="No results in this report" />;
  return (
    <div className="tablewrap">
      <table className="table table--stack">
        <thead>
          <tr>
            <th>System</th><th className="r">Precision</th><th className="r">Recall</th>
            <th className="r">Leaked</th><th className="r">Review rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} style={r.hero ? { background: 'rgba(127,168,201,0.07)' } : undefined}>
              <Td label="System">
                <span className="cell__id cell__strong">{r.name}</span>
                {r.gloss ? <div className="cell__sub">{r.gloss}</div> : null}
              </Td>
              <Td label="Precision" right><span className="cell__id">{pct(r.precision)}</span></Td>
              <Td label="Recall" right><span className="cell__id">{pct(r.recall)}</span></Td>
              <Td label="Leaked" right>
                <span className="cell__amount"
                  style={{ color: r.leaked_minor ? 'var(--oxide)' : 'var(--jade)' }}>
                  {money(r.leaked_minor, { round: true })}
                </span>
              </Td>
              <Td label="Review rate" right><span className="cell__id">{pct(r.review_rate)}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
