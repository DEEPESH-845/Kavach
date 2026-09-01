'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/* Motion tokens, shared by CSS, GSAP and Motion so the three never drift apart.

   Durations sit on the perceptual bands: under 100ms reads as instant, 100-300 fast,
   300-500 normal, past 500 slow. Easing is named for the system's epistemic posture
   rather than for a curve shape — a fact landing and a decision hesitating are
   different motions, and the reader should feel which one happened. */

export const T = {
  instant: 0.08,
  fast: 0.2,
  normal: 0.38,
  slow: 0.62,
  cinematic: 1.2,
  stagger: 0.06,
} as const;

/** cubic-bezier control points, for Motion's `ease` and GSAP's CustomEase alike. */
export const E = {
  proven: [0.2, 0, 0, 1],           // certain: arrives and stops
  wary: [0.8, 0, 0.25, 0.95],       // cautious: slow to commit
  refuse: [0.9, 0, 0.05, 1],        // an invariant: no negotiation
  reveal: [0.16, 0.84, 0.28, 1],    // content settling into place
  seam: [0.62, 0, 0.16, 1],         // divergence opening
} as const;

/** The one reveal every block of content uses, so entrances are a system not a habit. */
export const settle = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '0px 0px -12% 0px' },
  transition: { duration: T.slow, ease: E.reveal },
} as const;

/* useReducedMotion() is null during SSR, so branching markup on it makes the server and
   the first client render disagree. This defers the decision to after mount: the first
   paint always matches what was prerendered, and the preference applies from then on. */
export function useStill() {
  const still = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? !!still : false;
}
