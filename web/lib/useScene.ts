'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStill } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger);

/** One scroll scene, scoped and reverted on unmount. Returns the ref to attach.
 *  Reduced motion skips the whole thing, so the markup stays where CSS put it. */
export function useScene<T extends HTMLElement>(
  build: (q: gsap.utils.SelectorFunc, root: T) => void,
  deps: unknown[] = [],
) {
  const ref = useRef<T>(null);
  const still = useStill();

  useEffect(() => {
    if (still || !ref.current) return;
    const root = ref.current;
    const ctx = gsap.context(() => build(gsap.utils.selector(root), root), root);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, ...deps]);

  return ref;
}
