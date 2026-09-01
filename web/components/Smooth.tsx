'use client';

import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { useStill } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger);

/* One scroll authority for the whole page.

   Native wheel input arrives in coarse, uneven steps, which a scrubbed timeline turns
   into visible stepping. Lenis interpolates it into a continuous position and drives
   ScrollTrigger from the same tick, so every scrubbed animation on the page advances
   against one clock instead of three. Reduced motion opts out entirely — a preference
   for less movement is not satisfied by making the movement smoother. */

/* One live instance, so anything that needs to MOVE the page (the chapter jump list)
   drives the same interpolator rather than fighting it with a native anchor jump.
   Null whenever Lenis is not running — reduced motion, or before mount — and the caller
   falls back to the browser's own scrolling, which is the correct behaviour there. */
let live: Lenis | null = null;

/** Send the page to a chapter, then hand it the focus so a keyboard reader arrives
 *  where a mouse reader arrives. `preventScroll` because the scroll already happened. */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (live) live.scrollTo(el, { offset: -8 });
  else el.scrollIntoView({ block: 'start' });
  history.replaceState(null, '', `#${id}`);
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

export function Smooth() {
  const still = useStill();

  useEffect(() => {
    if (still) return;

    const lenis = new Lenis({
      duration: 1.05,
      // a long, flat tail: the page keeps arriving after the wheel stops
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 0.9,
      touchMultiplier: 1.6,
    });

    live = lenis;
    lenis.on('scroll', ScrollTrigger.update);

    /* Every in-page anchor goes through Lenis too. `html { scroll-behavior: smooth }`
       and a running interpolator are two authorities animating one scroll position,
       and a hero CTA that fought the wheel for a second was the visible symptom.
       Delegated once here rather than wired per link, so a jump added anywhere on the
       page inherits it — and so the modifier-key and new-tab cases stay the browser's. */
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      const id = a?.getAttribute('href')?.slice(1);
      if (!id || !document.getElementById(id)) return;
      e.preventDefault();
      scrollToId(id);
    };
    document.addEventListener('click', onClick);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      document.removeEventListener('click', onClick);
      live = null;
      lenis.destroy();
    };
  }, [still]);

  return null;
}
