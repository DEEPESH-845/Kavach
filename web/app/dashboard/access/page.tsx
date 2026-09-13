'use client';

/* Access — the keys that may call this deployment.
 *
 * A key is shown exactly once, at the moment it is minted, and never again: the server
 * keeps only a hash. Everything else on this screen is what an operator needs to answer
 * "who can call this, with what scope, and when did they last?".
 */

import { useState } from 'react';
import { AlertTriangle, KeyRound, Plus, Trash2 } from 'lucide-react';
import { ApiKey, api } from '@/lib/api';
import { useAction, useApi } from '@/lib/useApi';
import { ago, stamp } from '@/lib/format';
import {
  Async, Badge, Card, Copyable, Empty, ErrorState, Field, PageHead, Section, Skeleton,
} from '@/components/console/ui';
import { ConnectCard } from '@/components/console/Connect';

const SCOPE_NOTE: Record<ApiKey['scope'], string> = {
  readonly: 'every GET: overview, stream, entities, truth, proof, agents, policy',
  agent: '+ admit carts, evaluate intents, open step-ups',
  operator: '+ review escalations, mint and revoke keys',
};

export default function AccessPage() {
  const health = useApi(() => api.health(), []);
  const keys = useApi(() => api.keys(), []);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiKey['scope']>('readonly');
  const [minted, setMinted] = useState<(ApiKey & { key: string }) | null>(null);
  const create = useAction((body: { name: string; scope: ApiKey['scope'] }) => api.createKey(body));
  const revoke = useAction((id: string) => api.revokeKey(id));

  async function mint(e: React.FormEvent) {
    e.preventDefault();
    const out = await create.call({ name: name.trim(), scope });
    if (out) {
      setMinted(out);
      setName('');
      keys.reload();
    }
  }

  async function drop(k: ApiKey) {
    if (!window.confirm(`Revoke "${k.name}" (${k.scope})? Anything using it stops working immediately.`)) return;
    const out = await revoke.call(k.key_id);
    if (out) keys.reload();
  }

  const required = health.data?.auth.mode === 'required';

  return (
    <>
      <PageHead
        title="Access"
        sub="Who may call this deployment, with which scope. Keys are shown once when minted; the server keeps only a hash."
      />

      <Section title="This browser">
        <ConnectCard required={!!required} onChange={() => { keys.reload(); health.reload(); }} />
      </Section>

      {minted ? (
        <Section title="New key — copy it now">
          <Card>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <AlertTriangle size={15} style={{ color: 'var(--amber)' }} aria-hidden />
              <span style={{ color: 'var(--bone)', fontSize: 13.5 }}>
                {minted.name} · <Badge tone="info">{minted.scope}</Badge>
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              This is the only time the key is shown. Store it where the caller will read it
              from; the server cannot show it again.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code className="mono" style={{ wordBreak: 'break-all', fontSize: 12.5 }}>{minted.key}</code>
              <Copyable value={minted.key} label="Copy key" />
              <button className="btn btn--ghost btn--sm" onClick={() => setMinted(null)}>Done</button>
            </div>
          </Card>
        </Section>
      ) : null}

      <Section title="Mint a key" note="operator scope needed">
        <Card>
          <form className="formrow formrow--3" onSubmit={mint}>
            <Field label="Name" hint="who or what will hold it: a person, a service, an agent">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                maxLength={64} pattern="[A-Za-z0-9 ._-]+" required placeholder="checkout-service" />
            </Field>
            <Field label="Scope" hint={SCOPE_NOTE[scope]}>
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value as ApiKey['scope'])}>
                <option value="readonly">readonly</option>
                <option value="agent">agent</option>
                <option value="operator">operator</option>
              </select>
            </Field>
            <button className="btn btn--primary" type="submit" disabled={create.pending || !name.trim()}>
              <Plus size={13} aria-hidden /> {create.pending ? 'Minting…' : 'Mint'}
            </button>
          </form>
          {create.error ? (
            <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--oxide)' }}>
              {create.error.message} — {create.error.remedy}
            </p>
          ) : null}
        </Card>
      </Section>

      <Section title="Keys">
        <Async state={keys} skeleton={<Skeleton rows={4} />}
          empty={(k) => k.items.length === 0
            ? <Empty title="No keys yet" body="Mint one above, or on the host with `python -m kavach keys create`." />
            : null}>
          {(k) => (
            <Card flush>
              <div className="tablewrap">
                <table className="table table--stack">
                  <thead>
                    <tr><th>Name</th><th>Scope</th><th>Created</th><th>Last used</th><th>Status</th><th aria-label="Actions" /></tr>
                  </thead>
                  <tbody>
                    {k.items.map((row) => (
                      <tr key={row.key_id} style={row.revoked_at ? { opacity: 0.55 } : undefined}>
                        <td data-label="Name">
                          <span className="cell__id cell__strong">
                            <KeyRound size={12} style={{ verticalAlign: '-2px', marginRight: 6, opacity: 0.6 }} aria-hidden />
                            {row.name}
                          </span>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--fog)' }}>{row.key_id}</div>
                        </td>
                        <td data-label="Scope"><Badge tone={row.scope === 'operator' ? 'warn' : 'info'}>{row.scope}</Badge></td>
                        <td data-label="Created" title={stamp(row.created_at)}>{ago(row.created_at)}</td>
                        <td data-label="Last used" title={row.last_used_at ? stamp(row.last_used_at) : undefined}>
                          {row.last_used_at ? ago(row.last_used_at) : <span style={{ color: 'var(--fog)' }}>never</span>}
                        </td>
                        <td data-label="Status">
                          {row.revoked_at
                            ? <Badge tone="deny" title={stamp(row.revoked_at)}>revoked</Badge>
                            : <Badge tone="allow">active</Badge>}
                        </td>
                        <td data-label="">
                          {row.revoked_at ? null : (
                            <button className="btn btn--danger btn--sm" onClick={() => void drop(row)}
                              disabled={revoke.pending} aria-label={`Revoke ${row.name}`}>
                              <Trash2 size={12} aria-hidden /> Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </Async>
        {revoke.error ? <ErrorState error={revoke.error} compact /> : null}
      </Section>
    </>
  );
}
