'use client';

/* The console shell.
 *
 * The sidebar is grouped by the QUESTION each group answers, not by entity type. That
 * ordering is the product's argument, and putting it in the navigation means the operator
 * absorbs it by using the thing:
 *
 *     what is happening -> what money moved -> who acted -> what was allowed
 *     -> what needs a human -> can we prove it -> can we break it
 *
 * The environment badge reads /api/health rather than a constant. A dashboard that says
 * REPLAY because someone typed REPLAY is exactly the class of claim this product exists
 * to refuse.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import {
  Activity, BadgeCheck, Boxes, Bug, FileSearch, FlaskConical, Gauge, KeyRound,
  Landmark, Layers, Menu, PanelsTopLeft, RefreshCw, Settings,
  ShieldCheck, Undo2, UserCheck, Waypoints, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, usePoll } from '@/lib/useApi';
import './console.css';

type Item = { href: string; label: string; icon: React.ReactNode; badge?: 'review' };

const NAV: { label: string; ask: string; items: Item[] }[] = [
  {
    label: 'Overview', ask: 'What is happening?',
    items: [
      { href: '/dashboard', label: 'Command Centre', icon: <PanelsTopLeft size={15} /> },
      { href: '/dashboard/stream', label: 'Decision Stream', icon: <Activity size={15} /> },
    ],
  },
  {
    label: 'Money', ask: 'What is actually true?',
    items: [
      { href: '/dashboard/payments', label: 'Payments', icon: <Landmark size={15} /> },
      { href: '/dashboard/refunds', label: 'Refunds', icon: <Undo2 size={15} /> },
      { href: '/dashboard/obligations', label: 'Obligations', icon: <Boxes size={15} /> },
      { href: '/dashboard/truth', label: 'Truth Explorer', icon: <Waypoints size={15} /> },
      { href: '/dashboard/reconciliation', label: 'Reconciliation', icon: <RefreshCw size={15} /> },
    ],
  },
  {
    label: 'Agents', ask: 'Who is acting, and by whose authority?',
    items: [
      { href: '/dashboard/agents', label: 'Agents', icon: <UserCheck size={15} /> },
      { href: '/dashboard/gate', label: 'Agent Gate', icon: <KeyRound size={15} /> },
    ],
  },
  {
    label: 'Authority', ask: 'What is allowed, and what needs a human?',
    items: [
      { href: '/dashboard/risk', label: 'Risk Intelligence', icon: <Gauge size={15} /> },
      { href: '/dashboard/governor', label: 'Governor', icon: <ShieldCheck size={15} /> },
      { href: '/dashboard/review', label: 'Review Queue', icon: <Layers size={15} />, badge: 'review' },
    ],
  },
  {
    label: 'Proof', ask: 'Can we prove what happened?',
    items: [
      { href: '/dashboard/proof', label: 'Proof & Audit', icon: <FileSearch size={15} /> },
    ],
  },
  {
    label: 'Lab', ask: 'Can we break it?',
    items: [
      { href: '/dashboard/adversary', label: 'Adversary Lab', icon: <Bug size={15} /> },
      { href: '/dashboard/evaluations', label: 'Evaluations', icon: <FlaskConical size={15} /> },
      { href: '/dashboard/settings', label: 'Settings', icon: <Settings size={15} /> },
    ],
  },
];

const TITLES: Record<string, string> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])),
);

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const health = useApi(() => api.health(), []);
  const overview = useApi(() => api.overview(), []);
  usePoll(useCallback(() => { health.reload(); overview.reload(); },
    [health.reload, overview.reload]), 20_000);

  // A route change on mobile must close the drawer, or the destination is behind it.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const reviewCount = overview.data?.review_queue ?? 0;
  const title = TITLES[pathname] ?? 'Console';

  return (
    <div className="console">
      <div className="shell">
        {open ? (
          <button className="scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />
        ) : null}

        <aside className="sidebar" data-open={open} id="console-nav">
          <div className="sidebar__brand">
            <Link href="/" className="sidebar__mark">KAVACH</Link>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <ModeBadge health={health} />
              <button
                className="btn btn--ghost btn--sm"
                style={{ display: open ? 'inline-flex' : 'none' }}
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <nav className="sidebar__nav" aria-label="Console sections">
            {NAV.map((group) => (
              <div className="navgroup" key={group.label}>
                <div className="navgroup__label">{group.label}</div>
                <div className="navgroup__ask">{group.ask}</div>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="navlink"
                    aria-current={pathname === item.href ? 'page' : undefined}
                  >
                    {item.icon}
                    {item.label}
                    {item.badge === 'review' && reviewCount > 0 ? (
                      <span className="navlink__count">{reviewCount}</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="main">
          <header className="topbar">
            <button
              className="burger"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="console-nav"
            >
              <Menu size={17} />
            </button>
            <nav className="topbar__crumbs" aria-label="Breadcrumb">
              <Link href="/dashboard">Kavach</Link>
              <span aria-hidden>/</span>
              <b>{title}</b>
            </nav>
            <div className="topbar__spacer" />
            <IntegrityPill health={health} />
          </header>

          <main className="content">
            <div className="content__inner">
              {/* useSearchParams client-side-renders up to the nearest boundary; every
                  detail view reads ?id= from it, so the boundary lives here once. */}
              <Suspense fallback={<div className="skeleton skeleton--stat" />}>
                {children}
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function ModeBadge({ health }: { health: ReturnType<typeof useApi<Awaited<ReturnType<typeof api.health>>>> }) {
  if (health.error) {
    return <span className="mode mode--down" title={health.error.message}>
      <span className="mode__dot" />offline
    </span>;
  }
  if (!health.data) return <span className="mode mode--replay" style={{ opacity: 0.4 }}>····</span>;

  const live = health.data.mode === 'live';
  return (
    <span className={`mode ${live ? 'mode--live' : 'mode--replay'}`} title={health.data.mode_note}>
      <span className="mode__dot" />
      {health.data.mode}
    </span>
  );
}

function IntegrityPill({ health }: { health: ReturnType<typeof useApi<Awaited<ReturnType<typeof api.health>>>> }) {
  const d = health.data;
  if (!d) return null;
  const ok = d.integrity.chain_intact;
  return (
    <Link
      href="/dashboard/proof"
      className={`badge badge--${ok ? 'info' : 'deny'}`}
      style={{ textDecoration: 'none' }}
      title={ok
        ? `All ${d.integrity.events} events reproduce their stored hash`
        : `The chain breaks at event ${d.integrity.broken_at}`}
    >
      <BadgeCheck size={11} style={{ marginRight: -1 }} aria-hidden />
      {ok ? `chain ${d.integrity.events}` : 'chain broken'}
    </Link>
  );
}
