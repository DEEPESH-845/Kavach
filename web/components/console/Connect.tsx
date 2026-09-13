'use client';

/* Connect an API key to this browser.
 *
 * The key is held in localStorage and sent as `Authorization: Bearer` on every request.
 * Saving runs one real request (/api/keys needs operator scope; /api/overview needs any
 * scope) so the card reports what the key can actually do rather than that it was typed.
 */

import { useEffect, useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { ApiError, api, getApiKey, setApiKey } from '@/lib/api';
import { Badge, Card, Field } from '@/components/console/ui';

type Probe = { scope: 'operator' | 'readonly+' } | { error: ApiError };

function mask(key: string): string {
  return key.length > 14 ? `${key.slice(0, 12)}…${key.slice(-4)}` : key;
}

export function ConnectCard({ required, onChange }: {
  required: boolean; onChange?: () => void;
}) {
  const [stored, setStored] = useState('');
  const [draft, setDraft] = useState('');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStored(getApiKey()); }, []);

  async function test(): Promise<Probe> {
    try {
      await api.keys();
      return { scope: 'operator' };
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        try { await api.overview(); return { scope: 'readonly+' }; } catch (inner) {
          return { error: inner instanceof ApiError ? inner : new ApiError(0, 'unknown', String(inner)) };
        }
      }
      return { error: e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)) };
    }
  }

  async function save() {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setApiKey(key);
    const result = await test();
    setProbe(result);
    if ('error' in result && (result.error.status === 401)) {
      // A key the server refuses is not worth keeping: clear it so the banner stays honest.
      setApiKey('');
      setStored('');
    } else {
      setStored(key);
      setDraft('');
      onChange?.();
    }
    setBusy(false);
  }

  function clear() {
    setApiKey('');
    setStored('');
    setProbe(null);
    onChange?.();
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <KeyRound size={15} style={{ color: 'var(--steel)' }} aria-hidden />
        <span style={{ color: 'var(--bone)', fontSize: 13.5 }}>API key for this browser</span>
        {stored ? (
          <Badge tone="info"><ShieldCheck size={11} aria-hidden /> connected · {mask(stored)}</Badge>
        ) : (
          <Badge tone={required ? 'warn' : 'mute'}>{required ? 'NOT CONNECTED' : 'not needed'}</Badge>
        )}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 13 }}>
        {required
          ? 'This deployment requires a key on every request. Paste one minted with '
          : 'Keys are off on this deployment (a demo). A key pasted here is still sent, and matters only if KAVACH_AUTH is turned on. Mint one with '}
        <code className="mono">python -m kavach keys create --name you --scope operator</code>.
        It is kept in this browser only.
      </p>

      <form className="formrow formrow--2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Key" hint="kv_operator_…, kv_agent_… or kv_readonly_…">
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="kv_…"
          />
        </Field>
        <div className="formrow__actions">
          <button className="btn btn--primary" type="submit" disabled={busy || !draft.trim()}>
            {busy ? 'Checking…' : 'Save'}
          </button>
          {stored ? (
            <button className="btn btn--ghost" type="button" onClick={clear} title="Forget the key in this browser">
              <LogOut size={13} aria-hidden /> Forget
            </button>
          ) : null}
        </div>
      </form>

      {probe ? (
        <p role="status" style={{ margin: '12px 0 0', fontSize: 12.5, color: 'error' in probe ? 'var(--oxide)' : 'var(--fog)' }}>
          {'error' in probe
            ? (probe.error.status === 401
              ? 'The server refused that key. It was not kept.'
              : `Saved, but the check failed: ${probe.error.message}`)
            : probe.scope === 'operator'
              ? 'Connected. This key holds the operator scope — it can review, and mint and revoke keys.'
              : 'Connected. This key can read the console; review and key management need an operator key.'}
        </p>
      ) : null}
    </Card>
  );
}
