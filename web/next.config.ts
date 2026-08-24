import type { NextConfig } from 'next';

/* Static export with relative assets. ADR-013 promised a judge could open this without a
   daemon; a build step is new, but `out/index.html` still opens straight off disk, so the
   property that decision was protecting survives. */
const nextConfig: NextConfig = {
  output: 'export',
  // Relative asset paths are for the exported build only. In dev this makes the client
  // runtime resolve its chunks against the current URL, and hydration silently never
  // completes — the page renders from SSR and then nothing is interactive.
  ...(process.env.NODE_ENV === 'production' ? { assetPrefix: '.' } : {}),
  images: { unoptimized: true },
  trailingSlash: false,
};

export default nextConfig;
