/* 404.
 *
 * It reuses the landing page's design language rather than the console's, because a bad
 * URL can be reached from anywhere and this is the one screen that has to work with no
 * layout around it. No joke about the governor blocking the path: the governor is a real
 * component with a real meaning in this product, and borrowing its name for a routing
 * miss would teach the reader something false about what it does.
 */

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Not found — Kavach' };

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '48px 24px',
        paddingLeft: 24,
      }}
    >
      <div style={{ maxWidth: 520, width: '100%' }}>
        <p
          className="mono"
          style={{
            margin: '0 0 18px',
            fontSize: 11,
            letterSpacing: '0.18em',
            color: 'var(--fog2, #545e63)',
            textTransform: 'uppercase',
          }}
        >
          404 · no such route
        </p>

        <h1
          style={{
            margin: '0 0 14px',
            fontSize: 'clamp(1.7rem, 4vw, 2.5rem)',
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            fontWeight: 500,
            color: 'var(--bone, #e9e6de)',
          }}
        >
          This page does not exist.
        </h1>

        <p style={{ margin: '0 0 28px', fontSize: 15, lineHeight: 1.6, color: 'var(--fog, #79848a)' }}>
          Nothing was decided and nothing moved — you have simply asked for an address Kavach
          does not serve. Every route the console exposes is reachable from the command
          centre.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 18px',
              borderRadius: 8,
              background: 'var(--bone, #e9e6de)',
              color: 'var(--void, #08090a)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 13.5,
            }}
          >
            Command centre
          </Link>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 18px',
              borderRadius: 8,
              border: '1px solid var(--seam, #232a2e)',
              color: 'var(--bone, #e9e6de)',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: 13.5,
            }}
          >
            What Kavach is
          </Link>
        </div>
      </div>
    </main>
  );
}
