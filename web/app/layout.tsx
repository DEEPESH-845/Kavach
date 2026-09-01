import type { Metadata, Viewport } from 'next';
import './kavach.css';

/* NO TITLE HERE, DELIBERATELY. Each surface names itself: the landing page and the 404
   through their own `metadata`, the console from its shell, because eighteen client-
   rendered routes cannot each export a server-side `metadata` object.

   A title here is not merely redundant, it wins. Next renders the root metadata into the
   prerendered <head>, and hydration reconciles that element back to the value it was
   built with -- measured at 5ms after the console's own assignment, on every fresh load.
   The console appeared to have per-route titles while navigating within it and lost them
   on reload or a pasted link, which is exactly when a tab name is worth something. The
   description stays: it is genuinely site-wide. */
export const metadata: Metadata = {
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
