import type { Metadata, Viewport } from 'next';
import './kavach.css';

export const metadata: Metadata = {
  title: 'Kavach — the seam between what a rail says and what is owed',
  description:
    'Kavach is the merchant-side trust layer for agentic commerce: verify agents coming in, ' +
    'govern agents acting out, and prove every decision either way.',
};

export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#08090a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Motion writes its entrance states into the prerendered HTML, so if the bundle
            never runs the page is blank rather than merely still. This watchdog reveals
            everything when hydration has not happened — degradation may only widen what
            is visible, never narrow it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var d=document.documentElement;" +
              "if(location.protocol==='file:')d.setAttribute('data-file','');" +
              "setTimeout(function(){if(!d.hasAttribute('data-hydrated'))" +
              "d.setAttribute('data-degraded','');},1500);})();",
          }}
        />
      </head>
      <body>
        <a className="skip" href="#counter">Skip to content</a>
        <p className="offline">
          This page is open straight from disk, so its scripts cannot load and nothing here
          is interactive. Run <span className="mono">make site</span> and open{' '}
          <span className="mono">http://localhost:4173</span>.
        </p>
        {children}
      </body>
    </html>
  );
}
