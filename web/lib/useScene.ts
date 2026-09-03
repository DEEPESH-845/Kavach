'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStill } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger);

/** One scroll scene, scoped and reverted on unmount. Returns the ref to attach.
 *  Reduced motion skips the whole thing, so the markup stays where CSS put it.
 *
 *  NOTHING IS BUILT UNTIL THE PREFERENCE IS KNOWN. `useStill()` cannot answer during the
 *  first client render — matchMedia is not the server's to read, and branching on it there
 *  is a hydration mismatch — so it answers `false` until mounted. Building on that answer
 *  meant every scene ran its hidden start state once, and a reduced-motion reader then
 *  depended on `ctx.revert()` to put it back. Revert does not reliably clear an inline
 *  transform written by a completed `gsap.set`, so every <Kinetic> heading on the page
 *  stayed parked 108% below its own mask: invisible, permanently, to exactly the readers
 *  who had asked for less. Degradation may only widen what is visible.
 *
 *  One extra tick before any scene builds costs nothing — the page has not been scrolled
 *  yet — and it means the branch is taken once, on the real answer. */
export function useScene<T extends HTMLElement>(
  build: (q: gsap.utils.SelectorFunc, root: T) => void,
  deps: unknown[] = [],
) {
  const ref = useRef<T>(null);
  const still = useStill();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready || still || !ref.current) return;
    const root = ref.current;
    const ctx = gsap.context(() => build(gsap.utils.selector(root), root), root);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, still, ...deps]);

  return ref;
}
