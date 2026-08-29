'use client';

/* The console's vocabulary of parts.
 *
 * Every page is assembled from these, which is what keeps the product feeling like one
 * product: a decision explained on the review queue and the same decision explained in the
 * adversary lab are literally the same component, so they cannot drift apart.
 *
 * Two of these carry meaning rather than styling and are worth naming:
 *
 *   <Why>       the signature pattern. Any refusal, anywhere, answers the same four
 *               questions in the same order: what was decided, why, on what evidence,
 *               and what happens next.
 *   <Ladder>    an authority sequence. Rungs are rendered from what a decision actually
 *               produced, and a rung that was never reached says SKIPPED rather than
 *               borrowing a tick from the rung above it.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { cloneElement, useEffect, useId, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, CircleSlash, Copy, Inbox,
  Minus, RefreshCw, TriangleAlert, X,
} from 'lucide-react';
import type { ApiError } from '@/lib/api';
import type { Tone } from '@/lib/format';
import { gloss, tone as toneOf } from '@/lib/format';

/* ── page furniture ─────────────────────────────────────────────────────────── */

export function PageHead({ title, sub, actions }: {
  title: string; sub?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header className="page__head">
      <div>
        <h1 className="page__title">{title}</h1>
        {sub ? <p className="page__sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page__actions">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, note, actions, children }: {
  title: string; note?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">{title}</h2>
        {note ? <span className="section__note">{note}</span> : null}
        {actions ? <div style={{ marginLeft: 'auto' }}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, flush, className = '' }: {
  children: ReactNode; flush?: boolean; className?: string;
}) {
  return <div className={`card ${flush ? 'card--flush' : ''} ${className}`}>{children}</div>;
}

export function Stat({ label, value, note, tone: t = 'bone', icon }: {
  label: string; value: ReactNode; note?: ReactNode;
  tone?: 'bone' | 'steel' | 'amber' | 'oxide' | 'jade'; icon?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="stat">
        <span className="stat__label">{icon}{label}</span>
        <span className={`stat__value${t === 'bone' ? '' : ` stat__value--${t}`}`}>{value}</span>
        {note ? <span className="stat__note">{note}</span> : null}
      </div>
    </div>
  );
}

/* ── badges ─────────────────────────────────────────────────────────────────── */

export function Badge({ children, tone: t = 'mute', title, bare }: {
  children: ReactNode; tone?: Tone; title?: string; bare?: boolean;
}) {
  return (
    <span className={`badge badge--${t}${bare ? ' badge--bare' : ''}`} title={title}>
      {children}
    </span>
  );
}

/** A state name from the backend, coloured by meaning and glossed on hover.
 *  Never colour alone: the word itself is always the label (WCAG 1.4.1). */
export function State({ value, title }: { value: string | null | undefined; title?: string }) {
  if (!value) return <span className="badge badge--mute badge--bare">—</span>;
  return <Badge tone={toneOf(value)} title={title ?? gloss(value) ?? undefined}>{value}</Badge>;
}

/* ── the decision explanation ───────────────────────────────────────────────── */

export function Why({ verdict, why, evidence, next, risk, extra }: {
  verdict: string;
  why: string[];
  evidence?: ReactNode;
  next?: ReactNode;
  risk?: ReactNode;
  extra?: ReactNode;
}) {
  const t = toneOf(verdict);
  const cls = t === 'allow' ? 'allow' : t === 'deny' ? 'deny' : 'warn';
  return (
    <div className="why">
      <div className="why__top">
        <span className={`why__verdict why__verdict--${cls}`}>{verdict}</span>
        <span style={{ fontSize: 12.5, color: 'var(--fog2)' }}>{gloss(verdict)}</span>
        {extra ? <div style={{ marginLeft: 'auto' }}>{extra}</div> : null}
      </div>
      <div className="why__body">
        <Row k="Why">
          {why.length ? (
            <ul>{why.map((r, i) => <li key={i}>{r}</li>)}</ul>
          ) : (
            <span style={{ color: 'var(--fog2)' }}>No reason was recorded.</span>
          )}
        </Row>
        {risk ? <Row k="Risk">{risk}</Row> : null}
        {evidence ? <Row k="Evidence">{evidence}</Row> : null}
        {next ? <Row k="Next">{next}</Row> : null}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="why__row">
      <span className="why__k">{k}</span>
      <div className="why__v">{children}</div>
    </div>
  );
}

/* ── authority ladder ───────────────────────────────────────────────────────── */

export type Rung = {
  key: string; label: string; detail: string;
  state: 'PASS' | 'FAIL' | 'FLAG' | 'SKIPPED' | 'UNAVAILABLE';
};

const RUNG_ICON = {
  PASS: <Check size={12} />,
  FAIL: <X size={12} />,
  FLAG: <TriangleAlert size={12} />,
  SKIPPED: <Minus size={12} />,
  UNAVAILABLE: <CircleSlash size={12} />,
} as const;

const RUNG_CLASS = {
  PASS: 'pass', FAIL: 'fail', FLAG: 'flag', SKIPPED: 'skip', UNAVAILABLE: 'flag',
} as const;

export function Ladder({ rungs, spine = true }: { rungs: Rung[]; spine?: boolean }) {
  return (
    <div className={`ladder${spine ? ' ladder--spine' : ''}`}>
      {rungs.map((r) => (
        <div key={r.key} className={`rung rung--${RUNG_CLASS[r.state]}`}>
          <span className="rung__icon" aria-hidden>{RUNG_ICON[r.state]}</span>
          <div>
            <div className="rung__label">{r.label}</div>
            <div className="rung__detail">{r.detail}</div>
          </div>
          <span className="rung__state">{r.state}</span>
        </div>
      ))}
    </div>
  );
}

/* ── flow ───────────────────────────────────────────────────────────────────── */

export function Flow({ nodes }: {
  nodes: { k: string; v: ReactNode; state?: 'pass' | 'fail' | 'flag' | 'idle'; mono?: boolean }[];
}) {
  return (
    <div className="flow">
      {nodes.map((n, i) => (
        <div key={i} className="flow__node" data-state={n.state ?? 'idle'}>
          <span className="flow__k">{n.k}</span>
          <span className={`flow__v${n.mono ? ' flow__v--mono' : ''}`}>{n.v}</span>
        </div>
      ))}
    </div>
  );
}

/* ── key/value ──────────────────────────────────────────────────────────────── */

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── states ─────────────────────────────────────────────────────────────────── */

export function Empty({ title, body, action }: {
  title: string; body?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="state">
      <Inbox size={26} className="state__icon" aria-hidden />
      <div className="state__title">{title}</div>
      {body ? <p className="state__body">{body}</p> : null}
      {action ? <div className="state__actions">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, retry, compact }: {
  error: ApiError; retry?: () => void; compact?: boolean;
}) {
  return (
    <div className="state state--error" style={compact ? { padding: '26px 18px' } : undefined}>
      <AlertTriangle size={26} className="state__icon" aria-hidden />
      <div className="state__title">
        {error.status === 0 ? 'Kavach API is not reachable' : error.message}
      </div>
      <p className="state__body">{error.remedy}</p>
      {error.fields?.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12.5 }}>
          {error.fields.map((f, i) => (
            <li key={i}><code className="mono">{f.field}</code> — {f.problem}</li>
          ))}
        </ul>
      ) : null}
      {error.reference ? (
        <p className="state__body mono" style={{ fontSize: 11 }}>ref {error.reference}</p>
      ) : null}
      <div className="state__actions">
        {retry ? (
          <button className="btn" onClick={retry}><RefreshCw size={13} /> Retry</button>
        ) : null}
        <Link className="btn btn--ghost" href="/dashboard">Command centre</Link>
      </div>
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton--row" style={{ opacity: 1 - i * 0.13 }} />
      ))}
    </div>
  );
}

export function StatSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid--stats" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => <div key={i} className="skeleton skeleton--stat" />)}
    </div>
  );
}

/** One place that decides between loading, error, empty and content, so no page can
 *  forget one of the four. */
export function Async<T>({ state, empty, children, skeleton }: {
  state: { data: T | null; error: ApiError | null; initial: boolean; reload: () => void };
  empty?: (data: T) => ReactNode;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}) {
  if (state.error && !state.data) return <ErrorState error={state.error} retry={state.reload} />;
  if (state.initial) return <>{skeleton ?? <Skeleton />}</>;
  if (!state.data) return <Empty title="Nothing to show" />;
  const e = empty?.(state.data);
  return <>{e ?? children(state.data)}</>;
}

/* ── misc ───────────────────────────────────────────────────────────────────── */

export function Copyable({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <button
      className="btn btn--ghost btn--sm mono"
      title={`Copy ${label ?? value}`}
      onClick={() => {
        // clipboard is unavailable over plain http on some browsers; failing silently
        // here is right, the value is already on screen to select by hand.
        navigator.clipboard?.writeText(value).then(() => setDone(true)).catch(() => {});
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {label ?? value}
    </button>
  );
}

export function Json({ value, max }: { value: unknown; max?: number }) {
  return <pre className="code" style={max ? { maxHeight: max } : undefined}>
    {JSON.stringify(value, null, 2)}
  </pre>;
}

export function GoLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="btn btn--sm" href={href}>
      {children} <ArrowRight size={12} />
    </Link>
  );
}

/** Table cells carry their header as a data-label so the mobile stacked layout can
 *  reuse it. Doing it here means no page has to remember. */
export function Td({ label, children, right, className = '' }: {
  label: string; children: ReactNode; right?: boolean; className?: string;
}) {
  return (
    <td data-label={label} className={`${right ? 'r ' : ''}${className}`}>{children}</td>
  );
}

/** Props that make a table row behave like the link it looks like.
 *
 * A `<tr onClick>` is invisible to the keyboard and to assistive tech: it is not focusable,
 * it has no role, and Enter does nothing. Half the tables here had the focusable version and
 * half did not, which is exactly what happens when the same four lines are retyped per page.
 * One helper, used everywhere, and `router.push` rather than `window.location` so navigation
 * stays client-side.
 */
export function useRowNav() {
  const router = useRouter();
  return (href: string, label: string) => ({
    'data-clickable': '',
    tabIndex: 0,
    role: 'link' as const,
    'aria-label': label,
    onClick: () => router.push(href),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        router.push(href);
      }
    },
  });
}

/** A labelled form control.
 *
 * `useId` + `htmlFor` rather than a wrapping `<label>`: the label style is uppercase, and
 * wrapping the control would inherit that into the input and visually upper-case whatever
 * the operator types. `group` is for a cluster of buttons, which are named by their own
 * text and need a group label rather than a dangling `htmlFor`.
 */
export function Field({ label, hint, group, children }: {
  label: string; hint?: ReactNode; group?: boolean; children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      {group ? (
        <span className="field__label" id={`${id}-label`}>{label}</span>
      ) : (
        <label className="field__label" htmlFor={id}>{label}</label>
      )}
      {group ? (
        <div role="group" aria-labelledby={`${id}-label`}>{children}</div>
      ) : (
        cloneElement(children as ReactElement<{ id?: string }>, { id })
      )}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}
