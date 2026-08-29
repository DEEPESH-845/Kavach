/* Display formatting. The ONLY place minor units become rupees.
 *
 * Everything above this file works in integers. Division happens here, once, on the way
 * to a string that is never read back — so no rounded rupee value can find its way into
 * a comparison, a sum, or a request body.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_ROUND = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function money(minor: number | null | undefined, opts: { round?: boolean } = {}): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return '—';
  return (opts.round ? INR_ROUND : INR).format(minor / 100);
}

/** Compact for headline metrics: ₹8.5L rather than ₹8,49,900.00. */
export function moneyShort(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return '—';
  const rupees = minor / 100;
  if (Math.abs(rupees) >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)}L`;
  return INR_ROUND.format(rupees);
}

export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN').format(n);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function risk(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'not assessed';
  return v.toFixed(2);
}

/** Epoch seconds → a wall-clock time an operator can match against a log line. */
export function clock(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export function stamp(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function iso(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** A duration, at the coarsest unit that still says something useful. */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function ago(epoch: number | null | undefined, now?: number): string {
  if (!epoch) return '—';
  const ref = now ?? Math.floor(Date.now() / 1000);
  return `${duration(ref - epoch)} ago`;
}

/** Hashes and uuids are unreadable in full and ambiguous when only the head is shown. */
export function hash(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function shortId(value: string | null | undefined, n = 8): string {
  if (!value) return '—';
  return value.length <= n ? value : `${value.slice(0, n)}…`;
}

/* ── state → visual tone ────────────────────────────────────────────────────── */

export type Tone = 'allow' | 'warn' | 'deny' | 'info' | 'mute';

const TONES: Record<string, Tone> = {
  // governor
  ALLOW: 'allow', APPROVED: 'allow', EXECUTED: 'allow',
  ESCALATE: 'warn', PROPOSED: 'mute',
  DENY: 'deny', FAILED: 'deny',
  // gate
  STEP_UP: 'warn', HOLD: 'warn',
  // truth
  CONFIRMED: 'allow', SETTLED: 'allow',
  ACCEPTED: 'info', PROCESSING: 'info', INITIATED: 'mute',
  AMBIGUOUS: 'warn', FAILED_TERMINAL: 'deny', REVERSED: 'mute',
  DERIVED_CERTAIN: 'allow', DERIVED_PROBABLE: 'info', UNKNOWN: 'warn',
  // stages
  PASS: 'allow', FLAG: 'warn', FAIL: 'deny', SKIPPED: 'mute', UNAVAILABLE: 'warn',
  // obligations
  OPEN: 'warn', CLOSED: 'allow',
  // scenarios
  HELD: 'allow', BROKEN: 'deny', MODEL_UNAVAILABLE: 'warn',
};

export function tone(state: string | null | undefined): Tone {
  if (!state) return 'mute';
  return TONES[state.toUpperCase()] ?? 'mute';
}

/** Status names are the code's vocabulary, not English. Say both. */
const GLOSS: Record<string, string> = {
  ALLOW: 'permitted, no human needed',
  APPROVED: 'released for execution',
  EXECUTED: 'the provider was called and returned a result',
  ESCALATE: 'held for a human to decide',
  DENY: 'refused; no human can release it here',
  FAILED: 'the provider call failed',
  PROPOSED: 'recorded, not yet decided',
  STEP_UP: 're-consent required from the principal',
  HOLD: 'held for merchant review',
};

export const gloss = (state: string) => GLOSS[state?.toUpperCase()] ?? '';
