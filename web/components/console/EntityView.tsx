'use client';

/* Payments and refunds are the same screen with a different noun.
 *
 * The column that matters on both is the one no payment dashboard shows: RAIL STATE and
 * OBLIGATION side by side. A refund reading PROCESSING / OPEN is the whole product in one
 * row -- the gateway is finished, the customer has not been paid, and an agent reading a
 * single `status` field would call it done.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Fact } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { duration, money, stamp } from '@/lib/format';
import { EventTable } from './EventTable';
import {
  Async, Badge, Card, Empty, GoLink, KV, PageHead, Section, Skeleton, State, Td, useRowNav,
} from './ui';

type Kind = 'payment' | 'refund';

export function EntityView({ kind, title, sub }: { kind: Kind; title: string; sub: string }) {
  const id = useSearchParams().get('id');
  return id ? <Detail kind={kind} id={id} /> : <Listing kind={kind} title={title} sub={sub} />;
}

function Listing({ kind, title, sub }: { kind: Kind; title: string; sub: string }) {
  const list = useApi(() => api.entities(kind, 100), [kind]);
  const row = useRowNav();

  return (
    <>
      <PageHead title={title} sub={sub} />
      <Card flush>
        <Async state={list} skeleton={<Skeleton rows={8} />}
          empty={(d) => d.items.length === 0 ? (
            <Empty
              title={`No ${kind}s observed`}
              body={`Kavach derives ${kind}s from the events it has ingested. Nothing has arrived from the rail, and nothing is invented to fill the gap.`}
              action={<GoLink href="/dashboard">Command centre</GoLink>}
            />
          ) : null}
        >
          {(d) => (
            <div className="tablewrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th>{kind === 'payment' ? 'Payment' : 'Refund'}</th>
                    <th className="r">Amount</th>
                    <th>Rail state</th>
                    <th>Obligation</th>
                    <th>Confidence</th>
                    {kind === 'payment' ? <th className="r">Exposure</th> : <th>ARN</th>}
                    <th>Because</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((f) => (
                    <tr key={f.entity_id}
                      {...row(`/dashboard/${kind}s?id=${encodeURIComponent(f.entity_id)}`,
                              `Open ${kind} ${f.entity_id}`)}>
                      <Td label={kind === 'payment' ? 'Payment' : 'Refund'}>
                        <span className="cell__id cell__strong">{f.entity_id}</span>
                        <div className="cell__sub">idle {duration(f.unresolved_for)}</div>
                      </Td>
                      <Td label="Amount" right><span className="cell__amount">{money(f.amount_minor)}</span></Td>
                      <Td label="Rail state"><State value={f.rail_state} /></Td>
                      <Td label="Obligation">
                        <State value={f.obligation_open ? 'OPEN' : 'CLOSED'} />
                      </Td>
                      <Td label="Confidence"><State value={f.confidence} /></Td>
                      {kind === 'payment' ? (
                        <Td label="Exposure" right>
                          <span className="cell__amount"
                            style={{ color: f.exposure_minor ? 'var(--amber)' : undefined }}>
                            {money(f.exposure_minor ?? 0)}
                          </span>
                        </Td>
                      ) : (
                        <Td label="ARN">
                          {f.arn
                            ? <span className="cell__id">{f.arn}</span>
                            : <span className="cell__id" style={{ color: 'var(--fog2)' }}>none yet</span>}
                        </Td>
                      )}
                      <Td label="Because"><span className="cell__clip" title={f.because}>{f.because}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>
      {list.data ? <p className="section__note" style={{ marginTop: 12 }}>{list.data.note}.</p> : null}
    </>
  );
}

function Detail({ kind, id }: { kind: Kind; id: string }) {
  const detail = useApi(() => api.entity(kind, id), [kind, id]);
  const row = useRowNav();

  return (
    <Async state={detail}>
      {(d) => (
        <>
          <PageHead
            title={d.entity_id}
            sub={d.because}
            actions={
              <>
                <Link className="btn btn--sm" href={`/dashboard/${kind}s`}>All {kind}s</Link>
                <GoLink href={`/dashboard/truth?type=${kind}&id=${encodeURIComponent(d.entity_id)}`}>
                  Derivation
                </GoLink>
              </>
            }
          />

          <div className="grid grid--stats">
            <Card>
              <div className="stat">
                <span className="stat__label">Amount</span>
                <span className="stat__value">{money(d.amount_minor)}</span>
                <span className="stat__note">{d.currency}</span>
              </div>
            </Card>
            <Card>
              <div className="stat">
                <span className="stat__label">Rail state</span>
                <span className="stat__value" style={{ fontSize: 19 }}>
                  <State value={d.rail_state} />
                </span>
                <span className="stat__note">what the gateway has told us</span>
              </div>
            </Card>
            <Card>
              <div className="stat">
                <span className="stat__label">Obligation</span>
                <span className="stat__value" style={{ fontSize: 19 }}>
                  <State value={d.obligation_open ? 'OPEN' : 'CLOSED'} />
                </span>
                <span className="stat__note">
                  {d.obligation_open ? 'money is still owed or in flight' : 'nothing further is owed'}
                </span>
              </div>
            </Card>
            <Card>
              <div className="stat">
                <span className="stat__label">Confidence</span>
                <span className="stat__value" style={{ fontSize: 19 }}>
                  <State value={d.confidence} />
                </span>
                <span className="stat__note">last observation {duration(d.unresolved_for)} ago</span>
              </div>
            </Card>
          </div>

          <Section title="Fact">
            <Card>
              <KV rows={[
                ['Entity', <code className="mono" key="e">{d.entity_type}:{d.entity_id}</code>],
                ['Because', d.because],
                ['Bank reference', d.arn
                  ? <code className="mono" key="a">{d.arn}</code>
                  : <span style={{ color: 'var(--fog2)' }} key="a">
                      none received — without one, a refund is dispatched, not credited
                    </span>],
                ['Credited to customer',
                  <Badge tone={d.settled_to_customer ? 'allow' : 'warn'} key="s">
                    {d.settled_to_customer ? 'YES' : 'NOT YET'}
                  </Badge>],
                ['Evidence', <span className="mono" key="v">seq {d.evidence.join(', ') || '—'}</span>],
                ...(kind === 'payment'
                  ? [['Committed against it',
                      <span className="mono" key="x">{money(d.exposure_minor ?? 0)}</span>] as [string, React.ReactNode]]
                  : []),
              ]} />
            </Card>
          </Section>

          {kind === 'payment' && d.related.refunds?.length ? (
            <Section title="Refunds against this payment">
              <Card flush><RelatedFacts facts={d.related.refunds} /></Card>
            </Section>
          ) : null}

          {kind === 'refund' && d.related.payment ? (
            <Section title="Parent payment">
              <Card flush><RelatedFacts facts={[d.related.payment]} kind="payment" /></Card>
            </Section>
          ) : null}

          {kind === 'payment' && d.related.intents?.length ? (
            <Section title="What agents asked for against it"
              note="the context that makes a duplicate visible">
              <Card flush>
                <div className="tablewrap">
                  <table className="table table--stack">
                    <thead>
                      <tr><th>Raised</th><th>Agent</th><th>Session</th><th className="r">Amount</th><th>Reason</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {d.related.intents.map((i) => (
                        <tr key={i.intent_id}
                          {...row(`/dashboard/decisions?id=${encodeURIComponent(i.intent_id)}`,
                                  `Open decision by ${i.agent_id}`)}>
                          <Td label="Raised"><span className="cell__id">{stamp(i.created_at)}</span></Td>
                          <Td label="Agent"><span className="cell__id">{i.agent_id}</span></Td>
                          <Td label="Session"><span className="cell__id">{i.session_id}</span></Td>
                          <Td label="Amount" right><span className="cell__amount">{money(i.amount_minor)}</span></Td>
                          <Td label="Reason"><span className="cell__clip" title={i.reason_text}>{i.reason_text}</span></Td>
                          <Td label="Status"><State value={i.status} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </Section>
          ) : null}

          <Section title="Event timeline" note="ordered causally, not by arrival">
            <Card flush><EventTable events={d.timeline} /></Card>
          </Section>
        </>
      )}
    </Async>
  );
}

function RelatedFacts({ facts, kind = 'refund' }: { facts: Fact[]; kind?: Kind }) {
  const row = useRowNav();
  return (
    <div className="tablewrap">
      <table className="table table--stack">
        <thead>
          <tr><th>Id</th><th className="r">Amount</th><th>Rail</th><th>Obligation</th><th>Because</th></tr>
        </thead>
        <tbody>
          {facts.map((f) => (
            <tr key={f.entity_id}
              {...row(`/dashboard/${kind}s?id=${encodeURIComponent(f.entity_id)}`,
                      `Open ${kind} ${f.entity_id}`)}>
              <Td label="Id"><span className="cell__id cell__strong">{f.entity_id}</span></Td>
              <Td label="Amount" right><span className="cell__amount">{money(f.amount_minor)}</span></Td>
              <Td label="Rail"><State value={f.rail_state} /></Td>
              <Td label="Obligation"><State value={f.obligation_open ? 'OPEN' : 'CLOSED'} /></Td>
              <Td label="Because"><span className="cell__clip" title={f.because}>{f.because}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
