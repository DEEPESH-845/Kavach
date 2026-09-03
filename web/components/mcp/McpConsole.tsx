'use client';

/* The MCP surface, driven from the console.
 *
 * Every call here goes to /api/mcp/{tool}, which dispatches to the SAME function objects
 * the stdio server registers -- there is no HTTP re-implementation of a tool. The
 * transcript shows the chain a judge should see: request -> tool -> Kavach's decision ->
 * the evidence it cited -> what the provider did.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, Bot, Play, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react';
import { ApiError, journeyApi } from '@/lib/api';
import type { McpCall, McpTools } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { money } from '@/lib/format';
import { Async, Badge, Card, ErrorState, Json, Skeleton, State, Why } from '@/components/console/ui';

type Entry = {
  id: number; at: number; say: string; tool: string; args: Record<string, unknown>;
  out?: McpCall; err?: ApiError; pending?: boolean;
};

const REASON_FIRST = 'Order never arrived, courier marked it delivered in error';
const REASON_SECOND = 'Customer says the package was never delivered, issuing a refund';

export function McpConsole({ compact }: { compact?: boolean }) {
  const tools = useApi(() => journeyApi.mcpTools(), []);
  const [target, setTarget] = useState('');
  const [rupees, setRupees] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [tool, setTool] = useState('check_refund');
  const [raw, setRaw] = useState('{}');

  useEffect(() => {
    const t = tools.data;
    if (!t || target) return;
    const pick = t.suggested_target?.payment_id ?? t.seeded_targets[0] ?? '';
    setTarget(pick);
    if (t.suggested_target) setRupees(String(Math.min(999, Math.round(t.suggested_target.amount_minor / 100))));
    else setRupees('849');
  }, [tools.data, target]);

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

  const presets = useMemo(() => [
    { say: `“Refund this customer ${rupees ? '₹' + rupees : ''}.”`, tool: 'create_refund', args: { payment_id: target, amount: rupees, reason: REASON_FIRST, session_id: 'sess_morning', agent_id: 'agent_cx_tier1' }, kind: 'write' as const },
    { say: '“The refund didn’t work — issue it again.”', tool: 'create_refund', args: { payment_id: target, amount: rupees, reason: REASON_SECOND, session_id: 'sess_afternoon', agent_id: 'agent_cx_tier2' }, kind: 'write' as const },
    { say: '“Would that be a duplicate?”', tool: 'check_refund', args: { payment_id: target, amount: rupees, reason: REASON_SECOND, session_id: 'sess_afternoon', agent_id: 'agent_cx_tier2' }, kind: 'read' as const },
    { say: '“What is still in flight on this payment?”', tool: 'list_open_obligations', args: { payment_id: target }, kind: 'read' as const },
    { say: '“Show me the audit trail.”', tool: 'audit_trail', args: { payment_id: target }, kind: 'read' as const },
    { say: '“Has the log been tampered with?”', tool: 'verify_audit_trail', args: {}, kind: 'read' as const },
  ], [target, rupees]);

  return (
    <Async state={tools} skeleton={<Skeleton rows={6} />}>
      {(t) => (
        <div className={compact ? 'stack' : 'grid grid--2'} style={{ alignItems: 'start' }}>
          <div className="stack">
            <Card>
              <div className="stat__label" style={{ marginBottom: 10 }}><Bot size={13} /> The operator asks an agent</div>
              <TargetPicker t={t} target={target} setTarget={setTarget} rupees={rupees} setRupees={setRupees} />
              <div className="stack stack--tight" style={{ marginTop: 12 }}>
                {presets.map((p) => (
                  <button key={p.say} className="btn" style={{ justifyContent: 'space-between' }} disabled={!target || (p.tool !== 'verify_audit_trail' && !rupees && p.tool !== 'list_open_obligations' && p.tool !== 'audit_trail')}
                    onClick={() => call(p.say, p.tool, p.args)}>
                    <span>{p.say}</span>
                    <span className="mono" style={{ fontSize: 11, color: p.kind === 'write' ? 'var(--oxide)' : 'var(--steel)' }}>{p.tool}{p.kind === 'write' ? ' · write' : ''}</span>
                  </button>
                ))}
              </div>
              <p className="field__hint" style={{ marginTop: 10 }}>
                Ask for the refund once, then again from a new session with different words. The first is a legitimate obligation; the second is the same obligation. Only the ledger and the estimator can tell.
              </p>
            </Card>

            {!compact ? (
              <Card>
                <div className="stat__label" style={{ marginBottom: 10 }}><TerminalSquare size={13} /> Raw tool call</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                  <div className="field">
                    <label className="field__label" htmlFor="mcp-tool">tool</label>
                    <select id="mcp-tool" className="select" value={tool} onChange={(e) => setTool(e.target.value)}>
                      {t.tools.filter((x) => x.enabled).map((x) => <option key={x.name} value={x.name}>{x.name} · {x.toolset}{x.write ? ' · write' : ''}</option>)}
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
                  <textarea id="mcp-args" className="textarea mono" value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} />
                </div>
                <p className="field__hint">{t.tools.find((x) => x.name === tool)?.summary}</p>
              </Card>
            ) : null}

            <Card>
              <div className="stat__label" style={{ marginBottom: 8 }}>Parity with razorpay-mcp-server</div>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--fog)' }}>
                Same tool names, toolsets <span className="mono">{t.parity.toolsets.join(', ')}</span>, and the flags <span className="mono">{t.parity.flags.join(' ')}</span>. {t.parity.note}.
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
                  <button className="btn btn--ghost btn--sm" onClick={tools.reload}><RefreshCw size={12} /></button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setLog([])} disabled={!log.length}><Trash2 size={12} /></button>
                </span>
              </div>
              {log.length === 0 ? (
                <p className="field__hint" style={{ margin: 0 }}>Nothing asked yet. Pick a line on the left.</p>
              ) : (
                <div className="stack stack--wide">
                  {log.map((e) => <Turn key={e.id} e={e} />)}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </Async>
  );
}

function TargetPicker({ t, target, setTarget, rupees, setRupees }: {
  t: McpTools; target: string; setTarget: (v: string) => void; rupees: string; setRupees: (v: string) => void;
}) {
  const real = t.suggested_target;
  return (
    <>
      {real ? (
        <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--fog)' }}>
          <Badge tone="allow">REAL TEST PAYMENT</Badge> <span className="mono">{real.payment_id}</span> for {money(real.amount_minor)} came from the Bazaar. Refunds against it reach Razorpay&apos;s test API.
        </p>
      ) : (
        <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--fog)' }}>
          <Badge tone="warn">SEEDED TARGETS</Badge> No real payment yet — buy something in the Bazaar and it appears here. Seeded payments exist only in this ledger, so an ALLOWed refund is refused by Razorpay itself, which the transcript will show.
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
        <div className="field">
          <label className="field__label" htmlFor="mcp-target">payment</label>
          <select id="mcp-target" className="select mono" value={target} onChange={(e) => setTarget(e.target.value)}>
            {real ? <option value={real.payment_id}>{real.payment_id} · real</option> : null}
            {t.seeded_targets.map((p) => <option key={p} value={p}>{p} · seeded</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="mcp-amt">₹ amount</label>
          <input id="mcp-amt" className="input mono" inputMode="numeric" value={rupees} onChange={(e) => setRupees(e.target.value.replace(/[^\d]/g, ''))} />
        </div>
      </div>
    </>
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
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fog2)' }}>{new Date(e.at).toLocaleTimeString('en-IN', { hour12: false })}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <ArrowDown size={12} style={{ color: 'var(--fog2)' }} />
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
          risk={risk === null || risk === undefined ? <span style={{ color: 'var(--fog2)' }}>not assessed — nothing prior to duplicate, or a deterministic layer decided first</span> : <>{risk.toFixed(2)} duplicate-obligation probability{(r.risk_factors as string[] | undefined)?.length ? <div className="mono" style={{ marginTop: 4, fontSize: 12, color: 'var(--fog2)' }}>{(r.risk_factors as string[]).join('  ·  ')}</div> : null}</>}
          evidence={<>
            {evidence.length ? <span className="mono">events seq {evidence.join(', ')}</span> : <span style={{ color: 'var(--fog2)' }}>no open obligation cited</span>}
            {truth?.fact ? <div style={{ marginTop: 4 }}>payment <State value={String((truth.fact as Record<string, unknown>).rail_state)} /> · confidence <State value={String(truth.confidence)} /></div> : null}
          </>}
          next={r.executed === true ? <>Executed on the provider: refund <code className="mono">{String(r.refund_id)}</code>. The obligation is now OPEN until an ARN arrives.</>
            : r.dry_run ? 'Dry run: nothing recorded, nothing moved.'
            : r.reserved ? 'Reserved and written ahead; the provider call follows.'
            : action === 'ESCALATE' ? 'Held for a human in the review queue. No money moved.'
            : action === 'DENY' ? 'Refused outright. No human can release it here.' : undefined}
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

export function McpUnavailable({ error }: { error: ApiError }) {
  return <ErrorState error={error} />;
}
