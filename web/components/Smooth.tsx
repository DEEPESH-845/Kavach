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

    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, [still]);

  return null;
}
