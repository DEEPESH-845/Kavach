'use client';

/* The unified decision view.
 *
 * One layout, reached from the stream, the review queue, a payment, an agent or a
 * scenario. Its tabs are the decision's own order of operations -- truth, then risk, then
 * governor, then what the provider did, then the audit, then the proof -- so reading it
 * top to bottom is reading the decision being made.
 *
 * Detail is addressed by ?id= rather than a path segment because this app is a static
 * export: a dynamic route segment would need generateStaticParams, and the set of intent
 * ids is not knowable at build time. The trade is a slightly less pretty URL for a build
 * that cannot go stale.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Download, ExternalLink, FileWarning } from 'lucide-react';
import { api } from '@/lib/api';
import type { DecisionDetail } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { clock, duration, hash, iso, money, risk as fmtRisk, stamp } from '@/lib/format';
import {
  Async, Badge, Card, Copyable, Empty, GoLink, Json, KV, PageHead, Section, State, Td,
  Why, useRowNav,
} from '@/components/console/ui';
import { EventTable } from '@/components/console/EventTable';

const TABS = ['Overview', 'Truth', 'Risk', 'Governor', 'Integration', 'Audit', 'Proof'] as const;
type Tab = (typeof TABS)[number];

export default function DecisionPage() {
  const id = useSearchParams().get('id') ?? '';
  const [tab, setTab] = useState<Tab>('Overview');
  const detail = useApi(() => (id ? api.decision(id) : Promise.reject(new Error('no id'))), [id]);

  if (!id) {
    return (
      <>
        <PageHead title="Decision" />
        <Card>
          <Empty
            title="No decision selected"
            body="Open a decision from the stream, the review queue, or any payment."
            action={<GoLink href="/dashboard/stream">Decision stream</GoLink>}
          />
        </Card>
      </>
    );
  }

  return (
    <Async state={detail}>
      {(d) => (
        <>
          <PageHead
            title={`${d.intent.tool} · ${money(d.intent.amount_minor)}`}
            sub={<>
              Raised by <code className="mono">{d.intent.agent_id}</code> in session{' '}
              <code className="mono">{d.intent.session_id}</code> against{' '}
              <code className="mono">{d.intent.target_type}:{d.intent.target_id}</code>{' '}
              on {stamp(d.intent.created_at)}.
            </>}
            actions={
              <>
                <a
                  className="btn btn--sm"
                  href={api.disputeUrl(d.intent.intent_id)}
                  download={`kavach-dispute-${d.intent.intent_id}.json`}
                >
                  <Download size={12} /> Dispute pack
                </a>
                <Link
                  className="btn btn--sm"
                  href={`/dashboard/truth?type=${d.intent.target_type}&id=${encodeURIComponent(d.intent.target_id)}`}
                >
                  <ExternalLink size={12} /> Truth
                </Link>
              </>
            }
          />

          <Why
            verdict={d.governor.action}
            why={d.governor.reasons}
            risk={<RiskLine detail={d} />}
            evidence={<EvidenceLine detail={d} />}
            next={<NextLine detail={d} />}
            extra={<Copyable value={d.intent.intent_id} label={hash(d.intent.intent_id, 8, 4)} />}
          />

          <nav className="chipbar" style={{ margin: '22px 0 14px' }} aria-label="Decision sections">
            {TABS.map((t) => (
              <button key={t} className="chip" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>

          <div className="detail-panel" key={tab}>
            {tab === 'Overview' && <Overview d={d} />}
            {tab === 'Truth' && <Truth d={d} />}
            {tab === 'Risk' && <Risk d={d} />}
            {tab === 'Governor' && <Governor d={d} />}
            {tab === 'Integration' && <Integration d={d} />}
            {tab === 'Audit' && <Audit d={d} />}
            {tab === 'Proof' && <Proof d={d} />}
          </div>
        </>
      )}
    </Async>
  );
}

/* ── the four lines of the explanation ──────────────────────────────────────── */

function RiskLine({ detail: d }: { detail: DecisionDetail }) {
  if (!d.risk.assessed) {
    return <span style={{ color: 'var(--fog2)' }}>
      Not assessed — no estimator ran for this intent. An unassessed intent is never
      treated as a safe one.
    </span>;
  }
  return (
    <>
      <span style={{ color: d.risk.score! >= 0.5 ? 'var(--amber)' : 'var(--bone)' }}>
        {fmtRisk(d.risk.score)}
      </span>
      <span style={{ color: 'var(--fog2)' }}> duplicate-obligation probability · advisory only</span>
      {d.risk.factors.length ? (
        <div style={{ marginTop: 5, fontSize: 12, color: 'var(--fog2)' }} className="mono">
          {d.risk.factors.join('  ·  ')}
        </div>
      ) : null}
    </>
  );
}

function EvidenceLine({ detail: d }: { detail: DecisionDetail }) {
  // The seqs must come from the SAME array as the count. `proof.event_seqs` is the wider
  // set the chain was verified over -- cited events plus the audit and provider events --
  // so pairing that list with this count read "1 cited event (seq 84, 91)".
  const cited = d.truth.evidence.map((e) => e.seq);
  const fact = d.truth.fact;
  return (
    <>
      {fact ? <>Target is <State value={fact.rail_state} /> with obligation{' '}
        <State value={fact.obligation_open ? 'OPEN' : 'CLOSED'} />. {fact.because}. </> : null}
      {cited.length
        ? <>Decided on {cited.length} cited event{cited.length === 1 ? '' : 's'} (seq{' '}
          {cited.slice(0, 6).join(', ')}{cited.length > 6 ? '…' : ''}).</>
        : <>No open obligation existed on this target at the time, so no event was cited.</>}
      {d.truth.exposure_minor > 0
        ? <> {money(d.truth.exposure_minor)} was already committed against it.</>
        : null}
    </>
  );
}

function NextLine({ detail: d }: { detail: DecisionDetail }) {
  const s = d.intent.status;
  if (s === 'ESCALATE') return <>Waiting for a human. <Link href="/dashboard/review">Open the review queue</Link>.</>;
  if (s === 'DENY') return <>Closed. No reviewer can release a refusal made by an invariant or a permission tier.</>;
  if (s === 'EXECUTED') return <>The provider returned <code className="mono">{d.integration.result_id}</code>.
    Its own obligation state is tracked separately.</>;
  if (s === 'APPROVED') return <>Released for execution. No provider call has been observed yet;
    the reconciler settles it either way.</>;
  return <>Recorded.</>;
}

/* ── tabs ───────────────────────────────────────────────────────────────────── */

function Overview({ d }: { d: DecisionDetail }) {
  return (
    <div className="grid grid--2">
      <Card>
        <KV rows={[
          ['Intent', <code className="mono" key="i">{d.intent.intent_id}</code>],
          ['Agent', <Link className="mono" key="a" href={`/dashboard/agents?id=${encodeURIComponent(d.intent.agent_id)}`}>{d.intent.agent_id}</Link>],
          ['Session', <code className="mono" key="s">{d.intent.session_id}</code>],
          ['Tool', <code className="mono" key="t">{d.intent.tool}</code>],
          ['Target', <Link className="mono" key="g" href={`/dashboard/${d.intent.target_type}s?id=${encodeURIComponent(d.intent.target_id)}`}>{d.intent.target_id}</Link>],
          ['Amount', <span className="mono" key="m">{money(d.intent.amount_minor)}</span>],
          ['Raised', <span key="r">{stamp(d.intent.created_at)} <span style={{ color: 'var(--fog2)' }}>({iso(d.intent.created_at)})</span></span>],
          ['Status', <State value={d.intent.status} key="st" />],
        ]} />
      </Card>
      <Card>
        <div className="stat__label" style={{ marginBottom: 8 }}>Stated reason</div>
        <p style={{ margin: 0, color: 'var(--bone)', fontSize: 13.5, lineHeight: 1.55 }}>
          “{d.intent.reason_text || 'no reason given'}”
        </p>
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: 'var(--fog2)' }}>
          The reason is the agent&rsquo;s own words and is treated as untrusted input. It is a
          feature of the duplicate-risk estimator, never an instruction.
        </p>
      </Card>
    </div>
  );
}

function Truth({ d }: { d: DecisionDetail }) {
  return (
    <>
      {d.truth.fact ? (
        <Card>
          <KV rows={[
            ['Rail state', <State value={d.truth.fact.rail_state} key="r" />],
            ['Obligation', <State value={d.truth.fact.obligation_open ? 'OPEN' : 'CLOSED'} key="o" />],
            ['Confidence', <State value={d.truth.fact.confidence} key="c" />],
            ['Amount', <span className="mono" key="a">{money(d.truth.fact.amount_minor)}</span>],
            ['Because', d.truth.fact.because],
            ['Exposure', <span className="mono" key="e">{money(d.truth.exposure_minor)}</span>],
          ]} />
        </Card>
      ) : (
        <Card><Empty title="No fact for this target" body="Kavach holds no events for it, so the governor decided with no truth to read — which is itself a reason to refuse." /></Card>
      )}

      <Section title="Cited evidence" note="the exact events the governor read, fetched by the seqs it recorded">
        <Card flush>
          {d.truth.evidence.length ? <EventTable events={d.truth.evidence} />
            : <Empty title="No events were cited" body="There was no open obligation on this target to cite." />}
        </Card>
      </Section>

      {d.truth.open_obligations.length ? (
        <Section title="Open obligations at decision time">
          <Card><Json value={d.truth.open_obligations} max={280} /></Card>
        </Section>
      ) : null}
    </>
  );
}

function Risk({ d }: { d: DecisionDetail }) {
  if (!d.risk.assessed) {
    return <Card><Empty
      title="The estimator did not run"
      body="Either no model is loaded, or this intent had no prior intent on the same target — the duplicate task is only defined where a duplicate is possible. An unscored intent is never treated as a low-risk one."
    /></Card>;
  }
  const over = (d.risk.score ?? 0) >= 0.5;
  return (
    <div className="grid grid--2">
      <Card>
        <div className="stat">
          <span className="stat__label">Duplicate-obligation probability</span>
          <span className={`stat__value ${over ? 'stat__value--amber' : ''}`}>{fmtRisk(d.risk.score)}</span>
          <span className="stat__note">
            {over
              ? 'At or above the governor threshold, so this intent was pushed toward a human.'
              : 'Below the governor threshold. A low score authorises nothing on its own.'}
          </span>
        </div>
      </Card>
      <Card>
        <div className="stat__label" style={{ marginBottom: 10 }}>Attribution</div>
        {d.risk.factors.length ? (
          <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 6, fontSize: 12.5 }} className="mono">
            {d.risk.factors.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        ) : <p style={{ margin: 0, color: 'var(--fog2)', fontSize: 13 }}>No factor cleared the reporting floor.</p>}
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 11.5, color: 'var(--fog2)' }}>
          Contributions are on standardised features, so a value means &ldquo;this feature,
          relative to its typical value, pushed the decision this far&rdquo;.
        </p>
      </Card>
    </div>
  );
}

function Governor({ d }: { d: DecisionDetail }) {
  return (
    <>
      <Card>
        <KV rows={[
          ['Action', <State value={d.governor.action} key="a" />],
          ['Open exposure', d.governor.open_exposure !== null
            ? <span className="mono" key="e">₹{d.governor.open_exposure.toFixed(2)}</span> : '—'],
        ]} />
      </Card>
      <Section title="Reasons, in the order authority runs">
        <Card>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13, color: 'var(--bone)' }}>
            {d.governor.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ol>
        </Card>
      </Section>
      <p className="section__note" style={{ marginTop: 12 }}>
        The governor reads invariants, then permission tier, then truth-plane confidence, then
        the model, then caps. Nothing below a rung can reach past it —{' '}
        <Link href="/dashboard/governor">see the full ladder</Link>.
      </p>
    </>
  );
}

function Integration({ d }: { d: DecisionDetail }) {
  return (
    <>
      <Card>
        <KV rows={[
          ['Settled as', <State value={d.integration.settled} key="s" />],
          ['Provider result', d.integration.result_id
            ? <code className="mono" key="r">{d.integration.result_id}</code>
            : <span style={{ color: 'var(--fog2)' }}>no provider call has been observed</span>],
        ]} />
      </Card>
      <Section title="Provider events" note="what the rail told us about the result, after the fact">
        <Card flush>
          {d.integration.provider_events.length
            ? <EventTable events={d.integration.provider_events} />
            : <Empty
                title="Nothing from the provider"
                body="Either no call was made, or its result has not been observed. An intent in that state is the reconciler's job, not a failure."
              />}
        </Card>
      </Section>
    </>
  );
}

function Audit({ d }: { d: DecisionDetail }) {
  const row = useRowNav();
  return (
    <>
      <Section title="Events about this decision">
        <Card flush>
          {d.audit.events.length ? <EventTable events={d.audit.events} />
            : <Empty title="No audit events" />}
        </Card>
      </Section>
      <Section title="Other intents against the same target"
        note="the context that makes a duplicate visible at all">
        <Card flush>
          {d.audit.sibling_intents.length ? (
            <div className="tablewrap">
              <table className="table table--stack">
                <thead>
                  <tr><th>Time</th><th>Agent</th><th>Session</th><th className="r">Amount</th><th>Reason</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {d.audit.sibling_intents.map((s) => (
                    <tr key={s.intent_id}
                      {...row(`/dashboard/decisions?id=${encodeURIComponent(s.intent_id)}`,
                              `Open sibling decision by ${s.agent_id}`)}>
                      <Td label="Time"><span className="cell__id">{clock(s.created_at)}</span></Td>
                      <Td label="Agent"><span className="cell__id">{s.agent_id}</span></Td>
                      <Td label="Session"><span className="cell__id">{s.session_id}</span></Td>
                      <Td label="Amount" right><span className="cell__amount">{money(s.amount_minor)}</span></Td>
                      <Td label="Reason"><span className="cell__clip" title={s.reason_text}>{s.reason_text}</span></Td>
                      <Td label="Status"><State value={s.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="This is the only intent against that target" />}
        </Card>
      </Section>
    </>
  );
}

function Proof({ d }: { d: DecisionDetail }) {
  return (
    <>
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge tone={d.proof.verified ? 'info' : 'deny'}>
            {d.proof.verified ? 'VERIFIED' : 'BROKEN'}
          </Badge>
          <span style={{ fontSize: 13 }}>{d.proof.message}</span>
        </div>
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12.5, color: 'var(--fog2)' }}>
          This proves the cited events have not been altered since they were written. It does
          not prove who wrote them — provenance for rail events comes from the HMAC check on
          the webhook, recorded separately as <code className="mono">sig_verified</code>.
        </p>
      </Card>
      <Section title="Export" note="machine-readable, re-verifiable without this codebase">
        <Card>
          <p style={{ margin: '0 0 12px', fontSize: 13 }}>
            The dispute pack carries the intent, the truth it was decided against, the risk
            assessment, the governor&rsquo;s reasons, the provider outcome, every audit event,
            and the hashes needed to recompute the chain.
          </p>
          <a className="btn btn--primary" href={api.disputeUrl(d.intent.intent_id)}
             download={`kavach-dispute-${d.intent.intent_id}.json`}>
            <FileWarning size={13} /> Download dispute pack
          </a>
        </Card>
      </Section>
    </>
  );
}
