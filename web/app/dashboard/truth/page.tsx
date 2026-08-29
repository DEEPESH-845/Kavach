'use client';

/* Truth Explorer: watch a fact being derived, one event at a time.
 *
 * The trace is produced by re-deriving after each event rather than by instrumenting the
 * derivation, so the last row of the trace IS the fact the governor read. An explanation
 * built by a separate code path is an explanation that can be wrong about the thing it is
 * explaining.
 *
 * The four provenance labels are the reason this page exists. Merging "a webhook said so"
 * with "we concluded it from silence" into one green tick is how a dashboard starts lying
 * politely.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { duration, hash, money, stamp } from '@/lib/format';
import {
  Async, Badge, Card, Empty, Flow, KV, PageHead, Section, State,
} from '@/components/console/ui';

type Kind = 'payment' | 'refund';

export default function TruthPage() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = (params.get('type') === 'refund' ? 'refund' : 'payment') as Kind;
  const id = params.get('id') ?? '';

  const [draftKind, setDraftKind] = useState<Kind>(kind);
  const [draftId, setDraftId] = useState(id);

  const trace = useApi(
    () => (id ? api.truth(kind, id) : Promise.reject(new Error('no id'))), [kind, id]);

  const lookup = (
    <form
      className="card"
      style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (draftId.trim()) {
          router.push(`/dashboard/truth?type=${draftKind}&id=${encodeURIComponent(draftId.trim())}`);
        }
      }}
    >
      <div className="field" style={{ width: 130 }}>
        <label className="field__label" htmlFor="truth-kind">Entity</label>
        <select id="truth-kind" className="select" value={draftKind}
          onChange={(e) => setDraftKind(e.target.value as Kind)}>
          <option value="payment">payment</option>
          <option value="refund">refund</option>
        </select>
      </div>
      <div className="field" style={{ flex: '1 1 260px' }}>
        <label className="field__label" htmlFor="truth-id">Identifier</label>
        <input id="truth-id" className="input mono" value={draftId} placeholder="pay_… or rfnd_…"
          onChange={(e) => setDraftId(e.target.value)} />
      </div>
      <button className="btn btn--primary" type="submit" disabled={!draftId.trim()}>
        <Search size={13} /> Derive
      </button>
    </form>
  );

  if (!id) {
    return (
      <>
        <PageHead
          title="Truth Explorer"
          sub="Raw events fold into one financial fact. This shows the fold happening — which event moved the state, what it changed to, and what no single event ever said."
        />
        {lookup}
        <Section title="How to read it">
          <Card>
            <Flow nodes={[
              { k: 'Observed', v: 'a status carried by a source event', state: 'idle' },
              { k: 'Derived', v: 'the fold of every observed status, in causal order', state: 'idle' },
              { k: 'Inferred', v: 'staleness, contradiction, or an ARN closing an obligation', state: 'idle' },
              { k: 'Policy', v: 'not here — the governor decides separately, over this fact', state: 'idle' },
            ]} />
            <p style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
              Open a payment or refund and choose <b>Derivation</b>, or enter an identifier above.
            </p>
          </Card>
        </Section>
      </>
    );
  }

  return (
    <Async state={trace}>
      {(t) => (
        <>
          <PageHead
            title="Truth Explorer"
            sub={<>Deriving <code className="mono">{t.entity_type}:{t.entity_id}</code> from {t.steps.length} event{t.steps.length === 1 ? '' : 's'}.</>}
            actions={
              <a className="btn btn--sm"
                href={`/dashboard/${t.entity_type}s?id=${encodeURIComponent(t.entity_id)}`}>
                Open {t.entity_type} <ArrowRight size={12} />
              </a>
            }
          />

          {lookup}

          <Section title="Resulting fact">
            <Card>
              <KV rows={[
                ['Rail state', <State value={t.fact.rail_state} key="r" />],
                ['Obligation', <State value={t.fact.obligation_open ? 'OPEN' : 'CLOSED'} key="o" />],
                ['Confidence', <State value={t.final_confidence} key="c" />],
                ['Amount', <span className="mono" key="a">{money(t.fact.amount_minor)}</span>],
                ['Because', t.fact.because],
              ]} />
            </Card>
          </Section>

          <Section title="Derivation" note="each row re-derives the fact from every event up to and including it">
            <Card flush>
              {t.steps.length === 0 ? <Empty title="No events" /> : (
                <div className="chain">
                  {t.steps.map((s, i) => (
                    <div className="link" key={s.event.seq}
                      style={{ gridTemplateColumns: '48px 1fr' }}>
                      <div className="link__seq">
                        #{i + 1}
                        <div style={{ fontSize: 10, opacity: 0.6 }}>seq {s.event.seq}</div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="link__type">{s.event.event_type}</span>
                          <Badge tone={s.event.sig_verified ? 'info' : 'mute'} bare
                            title={s.event.sig_verified
                              ? 'observed: HMAC-verified webhook'
                              : 'observed: unsigned source, so never DERIVED_CERTAIN'}>
                            {s.event.sig_verified ? 'observed · signed' : 'observed · unsigned'}
                          </Badge>
                          {s.changed
                            ? <Badge tone="info" bare>derived · state moved</Badge>
                            : <Badge tone="mute" bare>derived · no change</Badge>}
                          {s.rail_state ? <State value={s.rail_state} /> : null}
                          {s.obligation_open !== undefined
                            ? <State value={s.obligation_open ? 'OPEN' : 'CLOSED'} /> : null}
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fog2)' }}
                            className="mono">
                            {stamp(s.event.occurred_at)}
                          </span>
                        </div>
                        {s.because ? (
                          <div className="rung__detail" style={{ marginTop: 5 }}>
                            {s.because}
                          </div>
                        ) : null}
                        {s.error ? (
                          <div className="rung__detail" style={{ marginTop: 5, color: 'var(--oxide)' }}>
                            {s.error}
                          </div>
                        ) : null}
                        <div className="link__hash">
                          {s.event.source} · {hash(s.event.event_hash)} ·{' '}
                          {duration(Math.max(0, s.event.received_at - s.event.occurred_at))} to reach us
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Section>

          <Section title="What each label means">
            <Card>
              <KV rows={Object.entries(t.provenance).map(([k, v]) => [k, v] as [string, string])} />
            </Card>
          </Section>
        </>
      )}
    </Async>
  );
}
