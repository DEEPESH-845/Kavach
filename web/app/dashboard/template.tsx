'use client';

/* OPERATION MODE, not story mode.
 *
 * The console's shell — sidebar, breadcrumbs, health badge, scroll position — is a
 * layout, so it already survives navigation untouched. All that changes between two
 * routes is the content region, and this is the only thing that marks the change: one
 * short fade so a click reads as a transition rather than a repaint.
 *
 * A template remounts per route, which is exactly the lifecycle wanted here and exactly
 * why the fade is CSS rather than JavaScript — nothing to schedule, nothing to clean up,
 * and no animation left running against a route that has already gone.
 *
 * It wraps the content region only. An element with an opacity animation is a containing
 * block for fixed descendants while it runs, and the console's fixed elements — the
 * mobile drawer and its scrim — are deliberately outside this subtree.
 *
 * 170ms, no delay, no stagger, no entrance on individual rows. An operator reading a
 * decision stream should never be waiting on the interface to finish arriving.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route">{children}</div>;
}
