'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR as a data URL. The payload is a URL with a single-use token and nothing else. */
export function useQr(text: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!text) { setUrl(null); return; }
    QRCode.toDataURL(text, { margin: 1, width: 336, errorCorrectionLevel: 'M',
      color: { dark: '#08090a', light: '#ffffff' } })
      .then((u) => { if (live) setUrl(u); })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [text]);
  return url;
}

/** The absolute URL a phone should open, built from where THIS page is being served. On a
 *  deployed host that is the public origin; on a laptop it is the LAN address the judge
 *  typed, which is exactly what a phone on the same network needs. */
export function absolute(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}
