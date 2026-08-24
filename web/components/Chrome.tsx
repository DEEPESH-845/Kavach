'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useSpring, useTransform, useReducedMotion } from 'motion/react';

/* The spine is the append-only log at page scale: one tick per event we could have written,
   lighting as the head passes. It doubles as the scroll indicator, so the page's progress
   bar is the product's own primitive rather than a generic rail. */

const TICKS = 26;

export function Chrome({ sections }: { sections: { id: string; n: string; name: string }[] }) {
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const eased = useSpring(scrollYProgress, { stiffness: 220, damping: 40, mass: 0.6 });
  const headY = useTransform(eased, (p) => `calc(${p} * (100vh - 13px))`);
  const barW = useTransform(eased, (p) => `${p * 100}%`);

  const [lit, setLit] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState(sections[0]);
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

      // the last section whose top has crossed the upper third; the stage overrides
      // this with its own beat name while it is playing
      let cur = sections[0];
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= innerHeight * 0.34) cur = s;
      }
      const stage = document.getElementById('stage');
      const beat = stage?.dataset.beat;
      setActive(beat ? { id: 'stage', n: stage!.dataset.beatN!, name: beat } : cur);
    };
    const onScroll = () => { if (!raf.current) raf.current = requestAnimationFrame(read); };
    read();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', read);
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', read); };
  }, [sections]);

  return (
    <>
      <div className="spine" aria-hidden>
        <div className="spine__rule" />
        <motion.div className="spine__head" style={still ? undefined : { y: headY, ['--prog' as string]: barW }} />
        <div className="spine__ticks">
          {Array.from({ length: TICKS }, (_, i) => (
            <span key={i} className="spine__tick" data-on={i < lit || undefined}
                  style={{ top: `${((i + 0.5) / TICKS) * 100}%` }} />
          ))}
        </div>
      </div>

      <header className="nav" data-stuck={stuck || undefined}>
        <a className="nav__mark" href="#counter">
          <span className="nav__glyph" aria-hidden />
          <span className="nav__name">KAVACH</span>
        </a>
        <p className="nav__pos">
          {active.n} <span className="nav__slash">/</span> 08
          <span className="nav__sec">{active.name}</span>
        </p>
      </header>
    </>
  );
}
