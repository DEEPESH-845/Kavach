'use client';

/* The store itself. Fourteen products, search, a category filter, and an "add" on each
 * card so the judge can be the agent's hands. Products outside the mandate's categories
 * are still purchasable -- the point is to let them try. */

import { useMemo, useState } from 'react';
import {
  Armchair, CalendarDays, FileText, FolderOpen, Gift, Headphones, Highlighter, Keyboard,
  Lamp, NotebookPen, Paperclip, PenLine, PenTool, Plus, Printer, Search,
} from 'lucide-react';
import type { Product } from '@/lib/api';
import { money } from '@/lib/format';
import { journey, useJourney } from '@/lib/journey';

const ICON: Record<string, React.ReactNode> = {
  'PPR-A4-500': <FileText />, 'PEN-BF-10': <PenLine />, 'NBK-SPR-1': <NotebookPen />,
  'STP-HP45': <Paperclip />, 'FLD-A4-5': <FolderOpen />, 'HLT-CAM-5': <Highlighter />,
  'LMP-LED-1': <Lamp />, 'PRN-HP-2331': <Printer />, 'PEN-PVK-SET': <PenTool />,
  'PLN-EXEC-27': <CalendarDays />, 'GFT-AMZ-3000': <Gift />, 'HPH-BOAT-1': <Headphones />,
  'KBD-LOGI-1': <Keyboard />, 'CHR-GS-ERGO': <Armchair />,
};

export function Storefront({ focus, compact }: { focus?: boolean; compact?: boolean }) {
  const j = useJourney();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const products = j.store?.products ?? [];
  const inScope = new Set(j.mandate?.categories ?? []);

  const shown = useMemo(() => products.filter((p) =>
    (cat === 'all' || p.category === cat)
    && (!q || `${p.name} ${p.description} ${p.blurb}`.toLowerCase().includes(q.toLowerCase()))),
    [products, cat, q]);

  if (!j.store) return <div className="skeleton" style={{ height: 320 }} />;

  return (
    <section aria-label="Storefront" data-focus={focus || undefined}>
      <div className="bz-toolbar">
        <label className="bz-search">
          <Search size={14} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the store"
            aria-label="Search products" />
        </label>
        <div className="chipbar" role="group" aria-label="Category">
          {['all', ...j.store.categories].map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c}{c !== 'all' && !inScope.has(c) ? ' ·outside mandate' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="bz-products">
        {(compact ? shown.slice(0, 8) : shown).map((p) => (
          <ProductCard key={p.sku} p={p} out={!inScope.has(p.category)} />
        ))}
        {shown.length === 0 ? (
          <p className="field__hint" style={{ gridColumn: '1 / -1' }}>Nothing matches. The catalogue is small on purpose.</p>
        ) : null}
      </div>
    </section>
  );
}

function ProductCard({ p, out }: { p: Product; out: boolean }) {
  const j = useJourney();
  const busy = j.phase === 'admitting' || j.phase === 'paying';
  return (
    <article className="bz-product" data-cat={p.category} data-liquid={p.liquid || undefined}
      data-out={out || undefined}>
      <div className="bz-tile" aria-hidden>{ICON[p.sku] ?? <FileText />}</div>
      <span className="bz-pcat">{p.liquid ? 'stored value' : p.category}</span>
      <div className="bz-pname">{p.name}</div>
      <div className="bz-pblurb">{p.blurb}</div>
      {p.review ? (
        <p className="bz-review"><b>REVIEW</b> {p.review}</p>
      ) : null}
      <div className="bz-prow">
        <span className="bz-price">{money(p.unit_amount_minor, { round: true })}</span>
        <button className="btn btn--sm" disabled={busy} onClick={() => journey.addProduct(p)}
          aria-label={`Add ${p.name} to the cart`}>
          <Plus size={12} /> Add
        </button>
      </div>
      {out ? <span className="field__hint" style={{ fontSize: 10.5 }}>outside the delegated categories</span> : null}
    </article>
  );
}
