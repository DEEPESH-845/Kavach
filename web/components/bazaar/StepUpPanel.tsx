'use client';

/* The channel the README called "not connected": Priya approves on her own phone. The
 * QR carries a URL with a single-use token and nothing else; this panel polls the same
 * endpoint the phone writes to. */

import { useEffect, useState } from 'react';
import { CheckCircle2, Send, Smartphone, XCircle } from 'lucide-react';
import { absolute, useQr } from '@/lib/qr';
import { money } from '@/lib/format';
import { useJourney } from '@/lib/journey';
import { NotifyChannel, StepUpDelivery, journeyApi } from '@/lib/api';
import { useAction } from '@/lib/useApi';

const PLACEHOLDER: Record<NotifyChannel, string> = {
  email: 'priya@example.com', sms: '+91 98765 43210', whatsapp: '+91 98765 43210',
  webhook: 'merchant',
};

/* The QR is the demo's channel; this is the production one. The same token goes out by
   email, SMS or WhatsApp -- the server composes the message and never includes the
   envelope -- and the delivery outcome is read back beside the token. */
function SendLink({ token, deliveries }: { token: string; deliveries: StepUpDelivery[] }) {
  const [channel, setChannel] = useState<NotifyChannel>('email');
  const [to, setTo] = useState('');
  const send = useAction((c: NotifyChannel, t: string) => journeyApi.stepUpNotify(token, { channel: c, to: t }));
  const latest = deliveries[deliveries.length - 1];

  return (
    <form
      className="bz-send"
      onSubmit={(e) => { e.preventDefault(); if (to.trim()) void send.call(channel, to.trim()); }}
    >
      <label className="field__label" htmlFor="bz-send-to">Or send Priya the link</label>
      <div className="bz-send__row">
        <select className="select" aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as NotifyChannel)}>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <input id="bz-send-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}
          placeholder={PLACEHOLDER[channel]} inputMode={channel === 'email' ? 'email' : 'tel'} />
        <button className="btn btn--sm" type="submit" disabled={send.pending || !to.trim()}>
          <Send size={12} aria-hidden /> {send.pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {send.error ? (
        <p role="alert" className="field__hint" style={{ color: 'var(--oxide)', margin: '6px 0 0' }}>
          {send.error.code === 'public_url_unset' || send.error.code === 'channel_unconfigured'
            ? `Not set up on this deployment: ${send.error.message}`
            : send.error.message}
        </p>
      ) : latest ? (
        <p role="status" className="field__hint" style={{ margin: '6px 0 0', color: latest.status === 'failed' ? 'var(--oxide)' : undefined }}>
          {latest.status === 'sent' ? `Sent by ${latest.channel} to ${latest.to}.`
            : latest.status === 'queued' ? `Sending by ${latest.channel} to ${latest.to}…`
            : `Could not send by ${latest.channel}: ${latest.error}`}
        </p>
      ) : null}
    </form>
  );
}

export function StepUpPanel({ focus }: { focus?: boolean }) {
  const j = useJourney();
  const s = j.stepup;
  const url = s ? absolute(s.approvePath) : null;
  const qr = useQr(url);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!s) return;
    const tick = () => setLeft(Math.max(0, s.expiresAt - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [s]);

  if (!s) return null;
  const status = s.view?.status ?? 'PENDING';
  const done = status !== 'PENDING';

  return (
    <div className="card" data-focus={focus || undefined} id="bz-stepup">
      <div className="stat__label" style={{ marginBottom: 12 }}><Smartphone size={13} /> Re-consent on Priya&apos;s phone</div>
      <div className="bz-qr" data-done={done || undefined}>
        {qr ? <img src={qr} alt="QR code opening the approval page" width={168} height={168} /> : <div className="skeleton" style={{ width: 168, height: 168 }} />}
        <div>
          {status === 'PENDING' ? (
            <>
              <p style={{ margin: '0 0 6px', color: 'var(--bone)', fontSize: 14 }}>
                Scan to approve or deny <b>{money(j.admission?.cart.total_minor ?? 0)}</b> for{' '}
                <span className="mono">{j.mandate?.agent_id}</span>.
              </p>
              <p className="field__hint" style={{ margin: '0 0 10px' }}>
                The phone sees the amount, the items and why Kavach stopped — never the mandate envelope. Approval re-runs admission at the moment of the tap.
              </p>
              <span className="bz-wait"><i aria-hidden /> waiting for Priya · {left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '…'} left</span>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn btn--sm" href={url ?? '#'} target="_blank" rel="noreferrer">No phone? Open the approval page here</a>
              </div>
              <SendLink token={s.token} deliveries={s.view?.notifications ?? []} />
            </>
          ) : status === 'APPROVED' ? (
            <>
              <p style={{ margin: '0 0 4px', color: 'var(--jade)', fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
                <CheckCircle2 size={16} /> Approved by {s.view?.resolved_by ?? 'principal'}
              </p>
              <p className="field__hint" style={{ margin: 0 }}>
                {(s.view?.result?.what_happens_next as string) ?? 'Admission re-run and the mandate charged.'}
                {s.view?.result?.rerun_verdict ? <> Re-run verdict: <span className="mono">{String(s.view.result.rerun_verdict)}</span>.</> : null}
              </p>
            </>
          ) : status === 'DENIED' ? (
            <>
              <p style={{ margin: '0 0 4px', color: 'var(--oxide)', fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
                <XCircle size={16} /> Denied by {s.view?.resolved_by ?? 'principal'}
              </p>
              <p className="field__hint" style={{ margin: 0 }}>Nothing was charged. The refusal is an event in the chain.</p>
            </>
          ) : (
            <p className="field__hint" style={{ margin: 0 }}>The request expired without an answer. Nothing was charged.</p>
          )}
        </div>
      </div>
    </div>
  );
}
