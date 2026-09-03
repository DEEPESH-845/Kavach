'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useSpring, useTransform, useReducedMotion } from 'motion/react';
import gsap from 'gsap';
import { CHAPTERS, LAST, type Chapter } from '@/lib/chapters';
import { useScene } from '@/lib/useScene';

/* The page's furniture: the spine, the header readout, and the chapter list.
 *
 * THE SPINE is the append-only log at page scale — one tick per event we could have
 * written, lighting as the head passes. It doubles as the progress indicator, so the
 * page's progress bar is the product's own primitive rather than a generic rail.
 *
 * THE CHAPTER LIST is editorial, not a tab bar: numbers only until you approach it,
 * names on hover or focus, the current one always named. It is a jump list because a
 * reader who has understood chapter 03 should not have to scroll through 04 to check
 * 09 — and because a judge with ninety seconds needs a way in that is not the wheel.
 *
 * THE GROUND is the third piece, and the quietest: the page has three acts — it argues,
 * then it acts, then it proves — and the environment shifts by two or three points of
 * luminance across each boundary. Nobody notices a single transition. Everybody notices
 * that chapter 10 does not feel like chapter 02. It is two cross-fading fixed layers
 * rather than a tweened colour, so the only property in flight is opacity.
 *
 * All three are hidden below the tablet breakpoint, where the spine becomes a top bar and
 * the fixed right column would cost more width than it is worth.
 */

const TICKS = 26;

export function Chrome() {
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const eased = useSpring(scrollYProgress, { stiffness: 220, damping: 40, mass: 0.6 });
  /* Both are handed to CSS as custom properties rather than as a `y` transform, because
     the spine is a vertical rail on a wide screen and a horizontal bar on a narrow one.
     An inline transform beats the media query that flattens it, which parked the mobile
     progress bar a third of the way down the page instead of along the top edge. CSS
     picks the axis; this only supplies the number. */
  const head = useTransform(eased, (p) => `calc(${p} * (100vh - 13px))`);
  const barW = useTransform(eased, (p) => `${p * 100}%`);

  const [lit, setLit] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState<Chapter>(CHAPTERS[0]);
  const raf = useRef(0);

  // tells the watchdog in <head> that the bundle arrived and took over
  useEffect(() => { document.documentElement.setAttribute('data-hydrated', ''); }, []);

  useEffect(() => {
    const read = () => {
      raf.current = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = Math.min(1, Math.max(0, scrollY / Math.max(1, max)));
      setLit(Math.round(p * TICKS));
      setStuck(scrollY > innerHeight * 0.6);

      // the last chapter whose top has crossed the upper third
      let cur = CHAPTERS[0];
      for (const c of CHAPTERS) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top <= innerHeight * 0.34) cur = c;
      }
      /* A pinned chapter names its own beat while it plays. The beat replaces the NAME
         and keeps the chapter's NUMBER: scrolling into the middle of a pinned section
         is not arriving at a new destination, and numbering it as one would make the
         jump list and the readout disagree about how many chapters exist. */
      const el = document.getElementById(cur.id);
      const beat = el?.dataset.beat;
      setActive(beat ? { ...cur, name: beat } : cur);
    };
    const onScroll = () => { if (!raf.current) raf.current = requestAnimationFrame(read); };
    read();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', read);
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', read); };
  }, []);

  /* The header retreats on the way down and returns the moment the reader reverses —
     23,000 pixels is a long time to hold a bar over the composition, and on a page where
     scrolling up means "take me back" the navigation should arrive before the reader has
     to look for it. It never hides over the hero, where it is the only orientation there
     is. */
  const [back, setBack] = useState(false);
  useEffect(() => {
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY;
      if (Math.abs(y - last) > 6) { setBack(y < last); last = y; }
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  /* Two acts of ground, cross-faded against the void the page starts on. The boundaries
     are the chapters where the product changes what it is doing, not arbitrary section
     edges: 05 is where it stops arguing and starts acting, 08 is where it stops acting
     and starts proving. */
  const ground = useScene<HTMLDivElement>((q) => {
    const fade = (el: Element, trigger: string) => {
      const t = document.getElementById(trigger);
      if (!t) return;
      gsap.fromTo(el, { opacity: 0 }, {
        opacity: 1, ease: 'none',
        scrollTrigger: { trigger: t, start: 'top 80%', end: 'top 10%', scrub: 1 },
      });
    };
    fade(q('[data-act="act"]')[0], 'governor');
    fade(q('[data-act="prove"]')[0], 'evidence');
  });

  return (
    <>
      <div className="ground" ref={ground} aria-hidden>
        <i data-act="act" />
        <i data-act="prove" />
      </div>

      <div className="spine" aria-hidden>
        <div className="spine__rule" />
        <motion.div className="spine__head"
                    style={still ? undefined
                      : { ['--head' as string]: head, ['--prog' as string]: barW }} />
        <div className="spine__ticks">
          {Array.from({ length: TICKS }, (_, i) => (
            <span key={i} className="spine__tick" data-on={i < lit || undefined}
                  style={{ top: `${((i + 0.5) / TICKS) * 100}%` }} />
          ))}
        </div>
      </div>

      <header className="nav" data-stuck={stuck || undefined}
              data-away={(stuck && !back) || undefined}>
        <a className="nav__mark" href="#counter">
          <span className="nav__glyph" aria-hidden />
          <span className="nav__name">KAVACH</span>
        </a>
        <p className="nav__pos">
          {active.n} <span className="nav__slash">/</span> {LAST}
          <span className="nav__sec">{active.name}</span>
        </p>
      </header>

      <nav className="toc" aria-label="Chapters">
        <ol>
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`}
                 data-on={c.n === active.n || undefined}
                 aria-current={c.n === active.n ? 'true' : undefined}>
                <span className="toc__n mono">{c.n}</span>
                <span className="toc__t">{c.name}</span>
                <span className="toc__mark" aria-hidden />
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
