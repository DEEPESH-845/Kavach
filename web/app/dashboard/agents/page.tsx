'use client';

/* Agents: who is acting against this merchant, and how often Kavach refuses them.
 *
 * "Admission rate" is deliberately not framed as a trust score. It is a ratio of outcomes,
 * and a low one can mean a hostile agent or a badly configured one. The page shows the
 * ratio and the intents behind it, and leaves the conclusion to the operator.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ago, count, money, pct, stamp } from '@/lib/format';
import {
  Async, Card, Empty, GoLink, PageHead, Section, Skeleton, Stat, State, Td, useRowNav,
} from '@/components/console/ui';

export default function AgentsPage() {
  const id = useSearchParams().get('id');
  return id ? <AgentDetail id={id} /> : <AgentList />;
}

function AgentList() {
  const list = useApi(() => api.agents(), []);
  const row = useRowNav();

  return (
    <>
      <PageHead
        title="Agents"
        sub="Every agent identity that has raised an intent here, with what it asked for and what Kavach did about it."
      />
      <Card flush>
        <Async state={list} skeleton={<Skeleton rows={5} />}
          empty={(d) => d.items.length === 0 ? (
            <Empty
              title="No agent has acted here"
              body="Agents reach Kavach through the MCP tool surface or the HTTP API. Nothing has yet."
              action={<GoLink href="/dashboard/adversary">Run a scenario</GoLink>}
            />
          ) : null}
        >
          {(d) => (
            <div className="tablewrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th>Agent</th><th className="r">Intents</th><th className="r">Requested</th>
                    <th className="r">Denied</th><th className="r">Escalated</th>
                    <th className="r">Admitted</th><th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((a) => (
                    <tr key={a.agent_id}
                      {...row(`/dashboard/agents?id=${encodeURIComponent(a.agent_id)}`,
                              `Open agent ${a.agent_id}`)}>
                      <Td label="Agent">
                        <span className="cell__id cell__strong">{a.agent_id}</span>
                        <div className="cell__sub">{count(a.sessions)} session{a.sessions === 1 ? '' : 's'}</div>
                      </Td>
                      <Td label="Intents" right><span className="cell__id">{count(a.intents)}</span></Td>
                      <Td label="Requested" right><span className="cell__amount">{money(a.requested_minor)}</span></Td>
                      <Td label="Denied" right>
                        <span className="cell__id" style={{ color: a.denied ? 'var(--oxide)' : undefined }}>
                          {count(a.denied)}
                        </span>
                      </Td>
                      <Td label="Escalated" right>
                        <span className="cell__id" style={{ color: a.escalated ? 'var(--amber)' : undefined }}>
                          {count(a.escalated)}
                        </span>
                      </Td>
                      <Td label="Admitted" right><span className="cell__id">{pct(a.admission_rate, 0)}</span></Td>
                      <Td label="Last seen"><span className="cell__id">{ago(a.last_seen)}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>
    </>
  );
}

function AgentDetail({ id }: { id: string }) {
  const detail = useApi(() => api.agent(id), [id]);
  const row = useRowNav();

  return (
    <Async state={detail}>
      {(a) => (
        <>
          <PageHead
            title={a.agent_id}
            sub={<>First seen {stamp(a.first_seen)}, last seen {ago(a.last_seen)}, across {count(a.sessions)} session{a.sessions === 1 ? '' : 's'}. A new session is exactly how a duplicate is born, so session count is worth reading next to refusal count.</>}
            actions={<Link className="btn btn--sm" href="/dashboard/agents">All agents</Link>}
          />

          <div className="grid grid--stats">
            <Stat label="Intents raised" value={count(a.intents)}
              note={`${money(a.requested_minor)} requested in total`} />
            <Stat label="Denied" value={count(a.denied)} tone={a.denied ? 'oxide' : 'bone'}
              note="refused by an invariant or a permission tier" />
            <Stat label="Escalated" value={count(a.escalated)} tone={a.escalated ? 'amber' : 'bone'}
              note="pushed to a human rather than guessed at" />
            <Stat label="Admitted without a human" value={pct(a.admission_rate, 0)}
              note="a ratio of outcomes, not a trust score" />
          </div>

          <Section title="Intents" note="newest first">
            <Card flush>
              {a.intents.length === 0 ? <Empty title="No intents" /> : (
                <div className="tablewrap">
                  <table className="table table--stack">
                    <thead>
                      <tr>
                        <th>Raised</th><th>Session</th><th>Target</th>
                        <th className="r">Amount</th><th>Reason</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.intents.map((i) => (
                        <tr key={i.intent_id}
                          {...row(`/dashboard/decisions?id=${encodeURIComponent(i.intent_id)}`,
                                  `Open decision on ${i.target_id}`)}>
                          <Td label="Raised"><span className="cell__id">{stamp(i.created_at)}</span></Td>
                          <Td label="Session"><span className="cell__id">{i.session_id}</span></Td>
                          <Td label="Target"><span className="cell__id">{i.target_id}</span></Td>
                          <Td label="Amount" right><span className="cell__amount">{money(i.amount_minor)}</span></Td>
                          <Td label="Reason"><span className="cell__clip" title={i.reason_text}>{i.reason_text}</span></Td>
                          <Td label="Status"><State value={i.status} /></Td>
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
  );
}
