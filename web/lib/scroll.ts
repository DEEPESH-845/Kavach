'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/* ─────────────────────────────────────────────────────────────────────────────
   SCROLL TOKENS AND THE ENTRANCES BUILT FROM THEM.

   Every section used to spell its own entrance out. `opacity: 0, y: 14..18,
   duration: .45..7, stagger: .045..13, ease: 'power2.out'` appeared nine times
   with four different sets of numbers, which is nine chances for the page to
   develop an accent. The numbers live here now and a section asks for a named
   motion instead of restating one.

   DIRECTION IS MEANING, so there is more than one name:

     rise()      content arriving         upward — the default
     inward()    a record being taken in  from the left, toward the reader
     fade()      a change of state        no travel at all

   Nothing here moves anything rightward. Leaving is chapter 06's alone, and
   keeping the vocabulary short is what makes that one exception legible.
   ───────────────────────────────────────────────────────────────────────── */

export const S = {
  /** where a section starts revealing: low enough to be deliberate, high enough
   *  that nothing has been read by the time it moves */
  enter: 'top 82%',
  y: 16,
  x: 14,
  dur: 0.55,
  stagger: 0.075,
  ease: 'power2.out',
} as const;

type Opts = {
  /** what the reveal watches. Defaults to the first target, which is right
   *  whenever a group enters together and wrong whenever it should wait for a
   *  container — hence the override rather than a guess. */
  trigger?: gsap.DOMTarget;
  start?: string;
  stagger?: number;
  duration?: number;
  /** travel distance in px; the helper supplies the sign */
  d?: number;
};

/* SET THE GROUP, THEN TWEEN IT — never `gsap.from` with a stagger.
 *
 * A staggered `from` renders only its FIRST sub-tween at time zero. Every other element
 * keeps its live value until its own sub-tween begins, so a group of six "hidden" rows
 * is one hidden row and five visible ones, and they blink out the instant the tween
 * reaches them. Setting the start state on the whole group up front and tweening TO the
 * finished state gives the same motion and the same reversal, and is actually hidden
 * before it is revealed. */
function reveal(targets: gsap.TweenTarget, o: Opts, travel: gsap.TweenVars) {
  const list = gsap.utils.toArray<Element>(targets as gsap.DOMTarget);
  const trigger = o.trigger ?? list[0];
  if (!trigger) return;                        // nothing matched; not an error
  const end = Object.fromEntries(Object.keys(travel).map((k) => [k, 0]));
  gsap.set(targets, { opacity: 0, ...travel });
  return gsap.to(targets, {
    scrollTrigger: { trigger, start: o.start ?? S.enter },
    opacity: 1,
    duration: o.duration ?? S.dur,
    stagger: o.stagger ?? S.stagger,
    ease: S.ease,
    ...end,
  });
}

/** The default: content settling up into place. */
export const rise = (t: gsap.TweenTarget, o: Opts = {}) => reveal(t, o, { y: o.d ?? S.y });

/** A record being read in. Used where a list accumulates rather than appears. */
export const inward = (t: gsap.TweenTarget, o: Opts = {}) => reveal(t, o, { x: -(o.d ?? S.x) });

/** A change of state with no travel, for things already in position. */
export const fade = (t: gsap.TweenTarget, o: Opts = {}) => reveal(t, o, {});
