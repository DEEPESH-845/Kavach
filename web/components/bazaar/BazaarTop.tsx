'use client';

/* The Bazaar's chrome: brand, mode, reset, and the way out to the other surfaces. */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { journeyApi } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { journey } from '@/lib/journey';

export function BazaarTop({ current }: { current: 'shop' | 'tour' | 'duel' }) {
  const health = useApi(() => journeyApi.health(), []);
  const [resetting, setResetting] = useState(false);
  const reset = useCallback(async () => {
    setResetting(true);
    await journey.resetDemo();
    setResetting(false);
  }, []);
  const h = health.data;

  return (
    <header className="bz-top">
      <Link href="/" className="bz-mark"><span className="bz-glyph" aria-hidden /> KAVACH</Link>
      <nav aria-label="Surfaces">
        {/* The demo surfaces are 404s on a production deployment; do not advertise them.
            Until health answers, the links stay so a slow API does not blank the nav. */}
        {h && !h.demo.reset_enabled ? null : (
          <>
            <Link href="/tour" aria-current={current === 'tour' ? 'page' : undefined}>Tour</Link>
            <Link href="/shop" aria-current={current === 'shop' ? 'page' : undefined}>Shop</Link>
            <Link href="/duel" aria-current={current === 'duel' ? 'page' : undefined}>Duel</Link>
          </>
        )}
        <Link href="/dashboard">Console</Link>
      </nav>
      <span className="bz-spacer" />
      {h ? (
        <span className="bz-test" data-off={h.razorpay.checkout ? undefined : ''} title={h.razorpay.checkout_note}>
          {h.razorpay.checkout ? 'Razorpay test mode' : 'payments off · replay'}
        </span>
      ) : null}
      {h?.demo.reset_enabled ? (
        <button className="btn btn--sm" onClick={reset} disabled={resetting} title="Re-seed the ledger and forget this session">
          <RotateCcw size={12} /> {resetting ? 'Resetting…' : 'Reset demo'}
        </button>
      ) : null}
    </header>
  );
}
