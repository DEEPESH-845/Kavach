export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));

/** Indian grouping, for money the reader is meant to feel. */
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const pct = (n: number) => (n * 100).toFixed(1) + '%';

/** Western grouping with two decimals — what Python's `{:,.2f}` produces, so the
 *  governor's reason strings render on the page exactly as they do in a log. */
export const money = (minor: number) =>
  (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** mulberry32, seeded, so a replay is reproducible across loads and machines. */
export function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
