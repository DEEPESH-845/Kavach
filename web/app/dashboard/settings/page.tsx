'use client';

/* Settings — which is mostly a page about what this environment IS.
 *
 * Read-only on purpose. Everything that could be configured here is either a policy limit
 * (compiled in, see /dashboard/governor) or a credential (an environment variable that
 * must never reach a browser bundle). A settings page whose only honest content is "there
 * is nothing to set here" is more useful than one with disabled toggles.
 */

import { AlertTriangle, KeyRound, Server, TerminalSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { count } from '@/lib/format';
import {
  Async, Badge, Card, KV, PageHead, Section, Skeleton,
} from '@/components/console/ui';

const COMMANDS: [string, string][] = [
  ['make demo', 'seed the ledger, build the UI, and serve everything on one port'],
  ['make seed', 're-seed the demo ledger deterministically'],
  ['make api', 'run the API alone against the current database'],
  ['make bench', 'train the duplicate-risk estimator and write evals/risk_report.json'],
  ['make gate-bench', 'train the entailment estimator and write evals/gate_report.json'],
  ['make test', 'the full Python suite'],
  ['python apps/reconciler.py', 'settle intents that have no observed provider result'],
  ['python apps/webhook_server.py', 'receive Razorpay webhooks with HMAC verification'],
  ['python apps/mcp_server.py', 'the MCP tool surface an agent connects to'],
];

export default function SettingsPage() {
  const health = useApi(() => api.health(), []);

  return (
    <>
      <PageHead
        title="Settings"
        sub="What this environment is running, and how to change it. Nothing on this screen is editable — see below for why."
      />

      <Async state={health} skeleton={<Skeleton rows={5} />}>
        {(h) => (
          <>
            <Section title="Environment">
              <Card>
                <KV rows={[
                  ['Mode', <span key="m" style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge tone={h.mode === 'live' ? 'deny' : 'info'}>{h.mode.toUpperCase()}</Badge>
                    <span style={{ color: 'var(--fog)' }}>{h.mode_note}</span>
                  </span>],
                  ['Version', <code className="mono" key="v">{h.version}</code>],
                  ['Database', <code className="mono" key="d">{h.database}</code>],
                  ['Events in log', count(h.integrity.events)],
                  ['Chain', <Badge tone={h.integrity.chain_intact ? 'info' : 'deny'} key="c">
                    {h.integrity.chain_intact ? 'INTACT' : `BROKEN AT ${h.integrity.broken_at}`}
                  </Badge>],
                  ['Built UI served by the API', h.ui ? 'yes' : 'no — running against the dev server'],
                ]} />
              </Card>
            </Section>

            <Section title="Models" note="a missing model widens caution; it is never substituted">
              <div className="grid grid--2">
                <Card>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    <Badge tone={h.models.duplicate_risk ? 'info' : 'warn'}>
                      {h.models.duplicate_risk ? 'LOADED' : 'ABSENT'}
                    </Badge>
                    <span style={{ color: 'var(--bone)', fontSize: 13.5 }}>Duplicate risk</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    {h.models.duplicate_risk
                      ? 'Scoring outbound intents against prior intents on the same target. Advisory only — it can escalate and never authorise.'
                      : 'Not loaded. Outbound intents are still governed by invariants, tiers, truth confidence and caps; what is missing is duplicate recognition. Run `make bench`.'}
                  </p>
                </Card>
                <Card>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    <Badge tone={h.models.entailment ? 'info' : 'warn'}>
                      {h.models.entailment ? 'LOADED' : 'ABSENT'}
                    </Badge>
                    <span style={{ color: 'var(--bone)', fontSize: 13.5 }}>Cart entailment</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    {h.models.entailment
                      ? 'Scoring inbound carts against the mandate’s stated purpose.'
                      : 'Not loaded. With no entailment model the gate floors every cart at STEP_UP rather than admitting it — ALLOW is only reachable through a model that actually read the cart. Run `make gate-bench`.'}
                  </p>
                </Card>
              </div>
            </Section>
          </>
        )}
      </Async>

      <Section title="Why nothing here is editable">
        <div className="grid grid--2">
          <Card>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <AlertTriangle size={15} style={{ color: 'var(--amber)' }} />
              <span style={{ color: 'var(--bone)', fontSize: 13.5 }}>Policy limits</span>
            </div>
            <p style={{ margin: 0, fontSize: 13 }}>
              Caps and thresholds are compiled into <code className="mono">governor.Policy</code>.
              A limit an operator can raise from the screen where it is failing them is not a
              limit — changing one is a code change with a review and a deploy, which is the
              audit trail a financial control needs. The backend has no endpoint that would
              accept the edit.
            </p>
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <KeyRound size={15} style={{ color: 'var(--steel)' }} />
              <span style={{ color: 'var(--bone)', fontSize: 13.5 }}>Credentials</span>
            </div>
            <p style={{ margin: 0, fontSize: 13 }}>
              Razorpay keys and the webhook secret are read from the server environment
              (<code className="mono">RAZORPAY_KEY_ID</code>,{' '}
              <code className="mono">RAZORPAY_KEY_SECRET</code>,{' '}
              <code className="mono">RAZORPAY_WEBHOOK_SECRET</code>) and are never sent to the
              browser. There is no API that returns them, so there is nothing here to show or
              edit.
            </p>
          </Card>
        </div>
      </Section>

      <Section title="Operating this environment">
        <Card flush>
          <div className="tablewrap">
            <table className="table table--stack">
              <thead>
                <tr><th>Command</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {COMMANDS.map(([cmd, what]) => (
                  <tr key={cmd}>
                    <td data-label="Command">
                      <span className="cell__id cell__strong">
                        <TerminalSquare size={12} style={{ verticalAlign: '-2px', marginRight: 6, opacity: 0.6 }} aria-hidden />
                        {cmd}
                      </span>
                    </td>
                    <td data-label="What it does"><span style={{ color: 'var(--fog)' }}>{what}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="section__note" style={{ marginTop: 12 }}>
          <Server size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} aria-hidden />
          Switching to live mode is <code className="mono">KAVACH_MODE=live</code> with real
          credentials present. The badge in the sidebar turns red, because at that point every
          decision on these screens can move real money.
        </p>
      </Section>
    </>
  );
}
