'use client';

/* A real Razorpay TEST-mode payment for the admitted cart, two ways: the Checkout modal on
 * this screen, or a Payment Link on a phone. The order carries the admission hash in its
 * notes so the decision is visible from Razorpay's own dashboard. */

import { useState } from 'react';
import { CreditCard, ExternalLink, Smartphone } from 'lucide-react';
import { money } from '@/lib/format';
import { journey, useJourney } from '@/lib/journey';
import { openCheckout } from '@/lib/razorpay';
import { useQr } from '@/lib/qr';
import { ErrorState } from '@/components/console/ui';

export function CheckoutPanel({ focus }: { focus?: boolean }) {
  const j = useJourney();
  const [link, setLink] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const qr = useQr(link);
  const c = j.checkout;
  if (!c || j.phase === 'paid') return null;

  const pay = async () => {
    setOpening(true);
    setModalError(null);
    try {
      await openCheckout({
        keyId: c.order.key_id, orderId: c.order.order_id, amountMinor: c.order.amount_minor,
        description: `Kavach Bazaar · ${j.cartId}`, notes: c.order.notes,
        onSuccess: (r) => { void journey.confirmCheckout(r); },
        onDismiss: () => setOpening(false),
      });
    } catch (e) {
      setModalError((e as Error).message);
      setOpening(false);
    }
  };

  const phone = async () => {
    const out = await journey.payOnPhone();
    if (out?.short_url) setLink(out.short_url);
  };

  return (
    <div className="card" data-focus={focus || undefined} id="bz-checkout">
      <div className="stat__label" style={{ marginBottom: 10 }}>
        <CreditCard size={13} /> Pay {money(c.order.amount_minor)} <span className="badge badge--warn" style={{ marginLeft: 8 }}>RAZORPAY TEST MODE</span>
      </div>
      <p className="field__hint" style={{ marginTop: 0, marginBottom: 12 }}>
        Order <span className="mono">{c.order.order_id}</span> was created on Razorpay with{' '}
        <span className="mono">notes.kavach_admission_hash</span> = <span className="mono">{c.order.notes.kavach_admission_hash.slice(0, 16)}…</span>.
        No real money moves. Pay with <b>Netbanking → any bank → Success</b> (fastest), or the
        domestic test card <span className="mono">5267 3181 8797 5449</span> (any future expiry,
        any CVV, OTP <span className="mono">1234</span>). International test cards are refused by
        this account.
      </p>
      {j.error ? <ErrorState error={j.error} compact /> : null}
      {modalError ? <p style={{ color: 'var(--oxide)', fontSize: 13 }}>{modalError}</p> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn--primary" onClick={pay} disabled={opening || j.phase === 'paying'}>
          <CreditCard size={13} /> {j.phase === 'paying' ? 'Verifying…' : opening ? 'Checkout open…' : 'Pay with Razorpay Checkout'}
        </button>
        <button className="btn" onClick={phone} disabled={!!link}>
          <Smartphone size={13} /> Pay on a phone instead
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => journey.refreshCheckout()}>Check status</button>
      </div>
      {link ? (
        <div className="bz-qr" style={{ marginTop: 14 }}>
          {qr ? <img src={qr} alt="QR code for the Razorpay payment link" width={168} height={168} /> : null}
          <div>
            <p style={{ margin: '0 0 6px', color: 'var(--bone)', fontSize: 14 }}>Scan to pay on a phone.</p>
            <p className="field__hint" style={{ margin: '0 0 8px' }}>A Razorpay Payment Link for the same cart; Kavach polls the rail until the payment is observed.</p>
            <a className="btn btn--sm" href={link} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {link}</a>
            <div style={{ marginTop: 8 }}><span className="bz-wait"><i aria-hidden /> watching for the payment</span></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
