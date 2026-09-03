'use client';

/* Break the chain yourself.
 *
 * One button edits a COPY of the log on the server and verifies it. The response says
 * which row changed, what changed, where verification broke, and that the live ledger is
 * untouched -- which is also re-verified live, not assumed.
 */

import { useState } from 'react';
import { Check, RotateCcw, ShieldX, Wrench, X } from 'lucide-react';
import { journeyApi } from '@/lib/api';
import { useAction } from '@/lib/useApi';
import { hash } from '@/lib/format';
import { Badge, Card, ErrorState } from '@/components/console/ui';

export function Tamper({ onRestore, compact }: { onRestore?: () => void; compact?: boolean }) {
  const [seq, setSeq] = useState('');
  const act = useAction((n?: number) => journeyApi.tamper(n));
  const r = act.result;

  const run = () => act.call(seq ? Number(seq) : undefined);
  const restore = () => { act.reset(); onRestore?.(); };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: r ? 14 : 8 }}>
        <span className="stat__label" style={{ margin: 0 }}><Wrench size={13} /> Tamper with this evidence</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {!compact ? (
            <input className="input mono" style={{ width: 110 }} placeholder="seq (optional)" inputMode="numeric"
              value={seq} onChange={(e) => setSeq(e.target.value.replace(/[^\d]/g, ''))} aria-label="Event seq to edit" />
          ) : null}
          {r ? (
            <button className="btn btn--sm" onClick={restore}><RotateCcw size={12} /> Restore original</button>
          ) : (
            <button className="btn btn--danger" onClick={run} disabled={act.pending}><ShieldX size={13} /> {act.pending ? 'Editing a copy…' : 'Tamper with this evidence'}</button>
          )}
        </span>
      </div>
      {!r && !act.error ? (
        <p className="field__hint" style={{ margin: 0 }}>
          Edits one money field ×10 in an in-memory copy of the log and recomputes every hash. The live ledger is not written; its own verification is reported beside the result.
        </p>
      ) : null}
      {act.error ? <ErrorState error={act.error} retry={run} compact /> : null}
      {r ? (
        <>
          <div className="grid grid--stats" style={{ marginBottom: 12 }}>
            <div className="card"><div className="stat"><span className="stat__label">edited</span><span className="stat__value" style={{ fontSize: 15 }}>seq {r.target.seq}</span><span className="stat__note mono">{r.target.event_type} · {r.target.field}</span></div></div>
            <div className="card"><div className="stat"><span className="stat__label">changed</span><span className="stat__value mono" style={{ fontSize: 15 }}>{String(r.target.original)} → {String(r.target.mutated)}</span><span className="stat__note">in the copy only</span></div></div>
            <div className="card"><div className="stat"><span className="stat__label">copy verifies</span><span className="stat__value stat__value--oxide" style={{ fontSize: 15 }}>BROKEN at {r.after.broken_at}</span><span className="stat__note">{r.after.checked} of {r.after.events} events reproduce</span></div></div>
            <div className="card"><div className="stat"><span className="stat__label">live ledger</span><span className={`stat__value stat__value--${r.live.untouched && r.live.status.ok ? 'steel' : 'oxide'}`} style={{ fontSize: 15 }}>{r.live.untouched && r.live.status.ok ? 'UNTOUCHED' : 'CHANGED'}</span><span className="stat__note">re-verified after the demo</span></div></div>
          </div>
          <div className="chain" role="list" aria-label="Verification of the tampered copy">
            {r.rows.map((row) => (
              <div className="link" key={row.seq} role="listitem" style={row.is_target ? { background: 'var(--oxide-wash)' } : row.halted ? { opacity: .55 } : undefined}>
                <div className="link__seq">
                  {row.seq}
                  <div style={{ marginTop: 4 }}><Badge tone={row.verified ? 'info' : 'deny'} bare>{row.verified ? <><Check size={10} /> ok</> : row.halted ? 'halted' : <><X size={10} /> break</>}</Badge></div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="link__type">{row.event_type}</span>
                    <Badge tone="mute" bare>{row.source}</Badge>
                    <span className="cell__id">{row.entity}</span>
                    {row.is_target ? <Badge tone="deny">EDITED</Badge> : null}
                    {row.halted ? <span className="mono" style={{ fontSize: 11, color: 'var(--fog2)' }}>verification halted — its predecessor no longer reproduces</span> : null}
                  </div>
                  <div className="link__hash">
                    stored <b>{hash(row.stored_hash, 10, 6)}</b>{'  '}recomputed <b style={{ color: row.verified ? undefined : 'var(--oxide)' }}>{hash(row.recomputed_hash, 10, 6)}</b>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="field__hint" style={{ marginTop: 12 }}>
            {r.note}. {r.claims.limit}.
          </p>
        </>
      ) : null}
    </Card>
  );
}
