'use client';

/* The MCP surface, driven from the console.
 *
 * Every call here goes to /api/mcp/{tool}, which dispatches to the SAME function objects
 * the stdio server registers -- there is no HTTP re-implementation of a tool. The
 * transcript shows the chain a judge should see: request -> tool -> Kavach's decision ->
 * the evidence it cited -> what the provider did.
 *
 * WHY THE DUPLICATE IS DEMONSTRATED ON A DIFFERENT PAYMENT FROM THE ONE YOU JUST PAID.
 * A duplicate obligation is a RE-DECISION minutes to hours later -- a customer complains,
 * an agent forms a new intent. A repeat ten seconds later is a REPLAYED request, which
 * Razorpay's own idempotency key already refuses, and the estimator scores it low on
 * purpose (`log_time_gap` is its largest positive coefficient). So the duplicate is asked
 * against an obligation that is genuinely in flight, chosen by the backend from the ledger
 * rather than named here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, Bot, Landmark, Play, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react';
import { ApiError, journeyApi } from '@/lib/api';
import type { McpCall, McpTools } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { duration, money } from '@/lib/format';
import { Async, Badge, Card, Json, Skeleton, State, Why } from '@/components/console/ui';

type Entry = {
  id: number; at: number; say: string; tool: string; args: Record<string, unknown>;
  out?: McpCall; err?: ApiError; pending?: boolean;
};

type Preset = { say: string; tool: string; args: Record<string, unknown>; write?: boolean };

export function McpConsole({ compact }: { compact?: boolean }) {
  const tools = useApi(() => journeyApi.mcpTools(), []);
  const [log, setLog] = useState<Entry[]>([]);
  const [tool, setTool] = useState('check_refund');
  const [raw, setRaw] = useState('{}');

  const call = useCallback(async (say: string, name: string, args: Record<string, unknown>) => {
    const id = Date.now() + Math.random();
    setLog((l) => [...l, { id, at: Date.now(), say, tool: name, args, pending: true }]);
    try {
      const out = await journeyApi.mcpCall(name, args);
      setLog((l) => l.map((e) => (e.id === id ? { ...e, out, pending: false } : e)));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e));
      setLog((l) => l.map((e2) => (e2.id === id ? { ...e2, err, pending: false } : e2)));
    }
    tools.reload();
  }, [tools]);

  const dup = tools.data?.duplicate_target ?? null;
  const real = tools.data?.suggested_target ?? null;

  const presets: Preset[] = useMemo(() => {
    const out: Preset[] = [];
    if (dup) {
      const rupees = String(Math.round(dup.amount_minor / 100));
      out.push(
        { say: '“What is still in flight on this payment?”', tool: 'list_open_obligations',
          args: { payment_id: dup.payment_id } },
        { say: `“The customer says the parcel never arrived — would refunding ₹${rupees} again be a duplicate?”`,
          tool: 'check_refund',
          args: { payment_id: dup.payment_id, amount: rupees,
                  reason: 'Customer says the parcel never arrived, refunding it',
                  session_id: 'sess_evening', agent_id: 'agent_cx_tier2' } },
        { say: `“Do it anyway — refund ₹${rupees}.”`, tool: 'create_refund', write: true,
          args: { payment_id: dup.payment_id, amount: rupees,
                  reason: 'Customer says the parcel never arrived, refunding it',
                  session_id: 'sess_evening', agent_id: 'agent_cx_tier2' } },
        { say: '“Show me the audit trail.”', tool: 'audit_trail',
          args: { payment_id: dup.payment_id } },
      );
    }
    if (real) {
      out.push({ say: '“Refund ₹50 of the payment I just made.”', tool: 'create_refund',
        write: true,
        args: { payment_id: real.payment_id, amount: '50',
                reason: 'Goodwill refund on the order placed through the Shop',
                session_id: 'sess_bazaar', agent_id: 'agent_cx_tier1' } });
    }
    out.push({ say: '“Has the log been tampered with?”', tool: 'verify_audit_trail', args: {} });
    return out;
  }, [dup, real]);

  return (
    <Async state={tools} skeleton={<Skeleton rows={6} />}>
      {(t) => (
        <div className={compact ? 'stack' : 'grid grid--2'} style={{ alignItems: 'start' }}>
          <div className="stack">
            <Card>
              <div className="stat__label" style={{ marginBottom: 10 }}>
                <Bot size={13} /> The operator asks an agent
              </div>
              <Targets t={t} />
              <div className="stack stack--tight" style={{ marginTop: 12 }}>
                {presets.map((p) => (
                  <button key={p.say} className="btn" style={{ justifyContent: 'space-between', textAlign: 'left' }}
                    onClick={() => call(p.say, p.tool, p.args)}>
                    <span>{p.say}</span>
                    <span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap',
                      color: p.write ? 'var(--oxide)' : 'var(--steel)' }}>
                      {p.tool}{p.write ? ' · write' : ''}
                    </span>
                  </button>
                ))}
              </div>
              <p className="field__hint" style={{ marginTop: 10 }}>
                Ask in order. The obligation is already in flight from an earlier session, and
                the new ask is worded differently — so no cap, no idempotency key and no string
                match can see the collision. Only the ledger and the estimator can.
              </p>
            </Card>

            {!compact ? (
              <Card>
                <div className="stat__label" style={{ marginBottom: 10 }}>
                  <TerminalSquare size={13} /> Raw tool call
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                  <div className="field">
                    <label className="field__label" htmlFor="mcp-tool">tool</label>
                    <select id="mcp-tool" className="select" value={tool} onChange={(e) => setTool(e.target.value)}>
                      {t.tools.filter((x) => x.enabled).map((x) => (
                        <option key={x.name} value={x.name}>{x.name} · {x.toolset}{x.write ? ' · write' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn--primary" onClick={() => {
                    let args: Record<string, unknown> = {};
                    try { args = JSON.parse(raw || '{}'); } catch { args = {}; }
                    void call(`raw ${tool}`, tool, args);
                  }}><Play size={13} /> Call</button>
                </div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label className="field__label" htmlFor="mcp-args">arguments (JSON)</label>
                  <textarea id="mcp-args" className="textarea mono" value={raw}
                    onChange={(e) => setRaw(e.target.value)} rows={3} />
                </div>
                <p className="field__hint">{t.tools.find((x) => x.name === tool)?.summary}</p>
              </Card>
            ) : null}

            <Card>
              <div className="stat__label" style={{ marginBottom: 8 }}>Parity with razorpay-mcp-server</div>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--fog)' }}>
                Same tool names, the same toolsets (<span className="mono">{t.parity.toolsets.join(', ')}</span>)
                and the same flags (<span className="mono">{t.parity.flags.join(' ')}</span>). {t.parity.note}.
              </p>
              <Json value={t.config} />
              <p className="field__hint" style={{ marginTop: 6 }}>
                {t.status.tools} tools enabled · {t.status.read_only ? 'read-only' : 'read/write'} · Razorpay {t.status.mode} mode
              </p>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span className="stat__label" style={{ margin: 0 }}>Transcript</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn--ghost btn--sm" onClick={tools.reload} aria-label="Refresh targets"><RefreshCw size={12} /></button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setLog([])} disabled={!log.length} aria-label="Clear transcript"><Trash2 size={12} /></button>
                </span>
              </div>
              {log.length === 0 ? (
                <p className="field__hint" style={{ margin: 0 }}>Nothing asked yet. Start at the top of the list on the left.</p>
              ) : (
                <div className="stack stack--wide">{log.map((e) => <Turn key={e.id} e={e} />)}</div>
              )}
            </Card>
          </div>
        </div>
      )}
    </Async>
  );
}

function Targets({ t }: { t: McpTools }) {
  const dup = t.duplicate_target;
  const real = t.suggested_target;
  return (
    <div className="stack stack--tight" style={{ marginBottom: 4 }}>
      {dup ? (
        <div style={{ padding: '10px 11px', borderRadius: 8, background: 'var(--raise)', border: '1px solid var(--seam)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <Badge tone="warn"><Landmark size={11} /> OBLIGATION IN FLIGHT</Badge>
            <span className="mono" style={{ fontSize: 12, color: 'var(--bone)' }}>{dup.payment_id}</span>
            <State value={dup.confidence} />
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fog)' }}>
            {money(dup.amount_minor)} was dispatched {duration(dup.intent_age_seconds)} ago —{' '}
            <span className="mono">{dup.rail_state}</span> on the rail, no ARN, so the customer is{' '}
            <b style={{ color: 'var(--bone)', fontWeight: 500 }}>not credited yet</b>. The earlier agent said:{' '}
            <em style={{ fontStyle: 'normal', color: 'var(--bone)' }}>“{dup.reason_text}”</em>.
          </p>
        </div>
      ) : (
        <p className="field__hint" style={{ margin: 0 }}>
          Nothing is in flight in this ledger, so there is no duplicate to demonstrate. Press{' '}
          <b>Reset demo</b> to restore the reference ledger.
        </p>
      )}
      {real ? (
        <div style={{ padding: '10px 11px', borderRadius: 8, background: 'var(--raise)', border: '1px solid var(--seam)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <Badge tone="allow">YOUR REAL TEST PAYMENT</Badge>
            <span className="mono" style={{ fontSize: 12, color: 'var(--bone)' }}>{real.payment_id}</span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fog)' }}>
            {money(real.amount_minor)} paid through the Shop. A refund against it reaches Razorpay&apos;s
            test API for real — a small partial amount, because a test account refunds out of its own balance.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Turn({ e }: { e: Entry }) {
  const r = e.out?.result as Record<string, unknown> | undefined;
  const action = (r?.action ?? r?.would) as string | undefined;
  const reasons = (r?.reasons as string[] | undefined) ?? [];
  const evidence = (r?.evidence_events as number[] | undefined) ?? [];
  const risk = r?.duplicate_risk as number | null | undefined;
  const truth = r?.truth as Record<string, unknown> | undefined;
  return (
    <div className="detail-panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--bone)', fontSize: 14 }}>{e.say}</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fog2)' }}>
          {new Date(e.at).toLocaleTimeString('en-IN', { hour12: false })}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <ArrowDown size={12} style={{ color: 'var(--fog2)' }} aria-hidden />
        <Badge tone={e.out?.write ? 'deny' : 'info'}>{e.tool}</Badge>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fog2)' }}>{JSON.stringify(e.args)}</span>
        {e.out ? <span className="mono" style={{ fontSize: 11, color: 'var(--fog2)' }}>{e.out.elapsed_ms} ms</span> : null}
      </div>
      {e.pending ? <div className="skeleton skeleton--row" /> : null}
      {e.err ? (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--oxide-wash)', border: '1px solid var(--oxide)', fontSize: 13 }}>
          <b style={{ fontWeight: 500, color: 'var(--oxide)' }}>{e.err.code}</b> — {e.err.message}
        </div>
      ) : null}
      {r && action ? (
        <Why verdict={action} why={reasons}
          risk={risk === null || risk === undefined
            ? <span style={{ color: 'var(--fog2)' }}>not assessed — nothing prior to duplicate, or a deterministic layer decided first</span>
            : <>{risk.toFixed(2)} duplicate-obligation probability
                {(r.risk_factors as string[] | undefined)?.length
                  ? <div className="mono" style={{ marginTop: 4, fontSize: 12, color: 'var(--fog2)' }}>{(r.risk_factors as string[]).join('  ·  ')}</div>
                  : null}</>}
          evidence={<>
            {evidence.length ? <span className="mono">events seq {evidence.join(', ')}</span>
              : <span style={{ color: 'var(--fog2)' }}>no open obligation cited</span>}
            {truth?.fact ? (
              <div style={{ marginTop: 4 }}>
                payment <State value={String((truth.fact as Record<string, unknown>).rail_state)} /> ·
                confidence <State value={String(truth.confidence)} />
              </div>
            ) : null}
          </>}
          next={r.executed === true
            ? <>Executed on the provider: refund <code className="mono">{String(r.refund_id)}</code>. The obligation is now OPEN until an ARN arrives.</>
            : r.dry_run ? 'Dry run: nothing recorded, nothing moved.'
            : action === 'ESCALATE' ? 'Held for a human in the review queue. No money moved, and no provider call was made.'
            : action === 'DENY' ? 'Refused outright. No human can release it here.'
            : r.reserved ? 'Reserved and written ahead; the provider call follows.' : undefined}
        />
      ) : null}
      {r && !action ? <Json value={r} max={260} /> : null}
      {r && action ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--fog)' }}>Raw tool result</summary>
          <div style={{ marginTop: 6 }}><Json value={r} max={260} /></div>
        </details>
      ) : null}
    </div>
  );
}
