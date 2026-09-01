'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useStill } from '@/lib/motion';

/* A CTA that leans toward the pointer. Five pixels, and only on the two primary calls to
 * action on the page — the one out of the hero and the one into the console.
 *
 * Three deliberate limits:
 *
 *   FIVE PIXELS. Enough to feel like the button noticed, not enough to make it a target
 *   that moves while you aim at it. Magnetism that outruns the cursor is a usability bug
 *   wearing a delight costume.
 *
 *   FINE POINTERS ONLY. There is no pointer to lean toward on a touchscreen, and
 *   `pointermove` there fires only once the finger is already down.
 *
 *   ON A WRAPPER, NOT THE BUTTON. GSAP writes an inline transform, which would outrank
 *   the `:active` rule that gives the press its feedback. The wrapper leans; the button
 *   keeps its own states.
 *
 * quickTo rather than a fresh tween per event: one interpolator per axis, reused, so a
 * pointer crossing the button does not allocate sixty tweens a second.
 */
export function useMagnetic<T extends HTMLElement>(strength = 5) {
  const ref = useRef<T>(null);
  const still = useStill();

  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const x = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
    const y = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x(((e.clientX - (r.left + r.width / 2)) / r.width) * strength * 2);
      y(((e.clientY - (r.top + r.height / 2)) / r.height) * strength * 2);
    };
    const rest = () => { x(0); y(0); };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', rest);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', rest);
      gsap.set(el, { x: 0, y: 0 });
    };
  }, [still, strength]);

  return ref;
}
