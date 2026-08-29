'use client';

/* The last boundary. This catches failures in the root layout itself, which is the one
 * place a React error genuinely produces a blank white document.
 *
 * It replaces <html> and <body>, so it cannot rely on the app's stylesheet having loaded —
 * every style here is inline for that reason, not out of carelessness.
 */

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#08090a', color: '#e9e6de',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif' }}>
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
          <div style={{ maxWidth: 480 }}>
            <p style={{
              margin: '0 0 16px', fontSize: 11, letterSpacing: '0.18em', color: '#545e63',
              textTransform: 'uppercase',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              Kavach · unrecoverable
            </p>
            <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>
              The interface failed to start.
            </h1>
            <p style={{ margin: '0 0 10px', fontSize: 15, lineHeight: 1.6, color: '#79848a' }}>
              This is a failure of the page, not of governance. No decision was made and no
              money moved as a result of it.
            </p>
            <p style={{
              margin: '0 0 26px', fontSize: 12, color: '#545e63',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {error.message}{error.digest ? ` · ${error.digest}` : ''}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={reset}
                style={{
                  padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: '#e9e6de', color: '#08090a', fontWeight: 600, fontSize: 13.5,
                }}
              >
                Reload
              </button>
              <a
                href="/dashboard"
                style={{
                  padding: '10px 18px', borderRadius: 8, border: '1px solid #232a2e',
                  color: '#e9e6de', textDecoration: 'none', fontWeight: 500, fontSize: 13.5,
                }}
              >
                Command centre
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
