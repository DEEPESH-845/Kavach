'use client';

/* Route-level error boundary for the console.
 *
 * It does not guess at a cause. The most common failure here by far is "the API is not
 * running", so that gets a named remedy; everything else gets the message, a retry, and a
 * way back — never a blank screen and never a stack trace, which on a payments surface is
 * both useless to the operator and useful to whoever is probing it.
 */

import Link from 'next/link';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function ConsoleError({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  useEffect(() => { console.error('Kavach console error:', error); }, [error]);

  return (
    <div className="state state--error" style={{ padding: '72px 24px' }}>
      <AlertTriangle size={30} className="state__icon" aria-hidden />
      <h1 className="state__title" style={{ fontSize: 17 }}>Something went wrong</h1>
      <p className="state__body">
        Kavach could not render this screen. Nothing was decided and no money moved — this is
        a display failure, not a governance one.
      </p>
      <p className="state__body mono" style={{ fontSize: 12, color: 'var(--fog2)' }}>
        {error.message}
        {error.digest ? ` · ${error.digest}` : ''}
      </p>
      <div className="state__actions">
        <button className="btn btn--primary" onClick={reset}>
          <RefreshCw size={13} /> Try again
        </button>
        <Link className="btn" href="/dashboard">Command centre</Link>
      </div>
      <p className="state__body" style={{ fontSize: 12, marginTop: 6 }}>
        If this persists, check that the API is running: <code className="mono">make run</code>.
      </p>
    </div>
  );
}
