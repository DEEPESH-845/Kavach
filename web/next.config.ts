import type { NextConfig } from 'next';

/* Static export. `next build` writes out/, and the Python API mounts it at / so the whole
   product is one process on one port.
 *
 * NO assetPrefix. It used to be '.' so that out/index.html would open straight off disk
 * without a daemon (ADR-013). That worked only while the site was one page at the root:
 * a relative prefix resolves against the CURRENT url, so /dashboard/gate asked for
 * /dashboard/_next/... and every console route 404'd its own JavaScript. A relative prefix
 * cannot be correct at two different path depths at once.
 *
 * The property ADR-013 was protecting is gone regardless -- the console reads a live API,
 * so it was never going to work from file://. What survives is the honest degradation the
 * root layout already ships: opening off disk sets data-file and reveals a banner saying so
 * and naming the command to run, rather than rendering a blank page.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Emits out/dashboard/index.html rather than out/dashboard.html. Any ordinary static
  // file server -- including the StaticFiles mount in apps/api_server.py -- resolves a
  // directory to its index.html, but nothing resolves /dashboard to dashboard.html. With
  // this false the whole console 404s the moment it is served rather than opened.
  trailingSlash: true,
};

export default nextConfig;
