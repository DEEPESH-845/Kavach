'use client';

import { useEffect, useRef } from 'react';
import { clamp } from '@/lib/util';
import { useStill } from '@/lib/motion';
import {
  lightSpeedPresets,
  type LightSpeedEffect,
  type LightSpeedOptions,
  type LightSpeedPreset,
} from './presets';

/* A perspective field of light, on a 2D canvas.
 *
 * WHY NOT WebGL. The reference implementation is three.js plus a post-processing chain.
 * This page is a static export served by the Python API on one port, its whole bundle is
 * GSAP + Lenis + Motion, and the effect is one decorative band between two chapters. A
 * renderer is ~170 kB gzipped before a single streak is drawn, which is more JavaScript
 * than the entire site ships, to produce a picture a pinhole projection produces exactly.
 * So: no new dependency, no shader compile on the main thread, no context to lose. The
 * `effectOptions` contract is unchanged — only the thing consuming it is smaller.
 *
 * THE PROJECTION. Each streak is a fixed direction (ux, uy) at a world radius r, travelling
 * toward the viewer along z. `f = (h / 2) / tan(fov / 2)` is pixels per world unit at z = 1,
 * so the projected offset is `r * f / z` and the streak is the segment from z (its head,
 * furthest from the vanishing point) to z + length (its tail, nearest). Radii are drawn
 * against a FIXED reference fov, not the live one, so that changing fov actually changes
 * the picture instead of cancelling itself out of the spawn.
 *
 * `drive` is a getter, not a prop value: the section scrubs it from scroll every frame, and
 * a prop would mean a React render per frame to move a number the render never reads.
 */

export interface LightSpeedProps {
  preset?: LightSpeedPreset;
  speedUp?: number;
  fov?: number;
  className?: string;
  /** merged over the preset — for a field that has to mean something local */
  options?: Partial<LightSpeedOptions>;
  /** 0..1, sampled once per frame. Sets velocity, trail length and brightness together. */
  drive?: () => number;
}

interface Streak {
  ux: number; uy: number;
  r: number;                 // world radius
  z: number;
  k: number;                 // per-streak brightness/length jitter
  c: string;
}

/** the fov the spawn radii are authored against; see the note above */
const REF_FOV = 90;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function LightSpeed({
  preset = 'one',
  speedUp = 2,
  fov = 90,
  className,
  options,
  drive,
}: LightSpeedProps) {
  const still = useStill();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  /* Derived, not stored. The source component computed `selectedPreset` inline and so does
     this; a useState/useEffect pair for a value that is a function of props is a second
     source of truth that is wrong for one render every time it changes. */
  const effect: LightSpeedEffect = {
    ...lightSpeedPresets[preset],
    ...options,
    speedUp,
    fov,
  };

  /* The loop reads config through a ref, so a changed prop retunes the running field
     instead of tearing the canvas down and repopulating it. */
  const cfg = useRef(effect);
  cfg.current = effect;
  const driveRef = useRef(drive);
  driveRef.current = drive;

  useEffect(() => {
    const el = canvas.current;
    const box = host.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const dprCap = coarse ? 1.5 : 2;

    let w = 0, h = 0, rMax = 0;
    let ox = 0.5, oy = 0.5;             // vanishing point, normalised
    let px = 0, py = 0, tx = 0, ty = 0; // pointer pull, eased toward target
    let streaks: Streak[] = [];

    /* Colours are resolved once per palette, against the canvas's own computed style, so
       `var(--bone)` on the page and the streaks that mean "decided" are the same value. */
    let paletteFor: unknown = null;
    let cum: { c: string; upTo: number }[] = [];
    /* Declared as consts, not `function` statements: a hoisted declaration is created
       before the null guards above run, so TypeScript will not carry their narrowing into
       it and every `el` inside becomes possibly-null again. */
    const palette = (cs: CSSStyleDeclaration) => {
      const colors = cfg.current.colors;
      if (paletteFor === colors) return cum;
      const total = colors.reduce((s, [, n]) => s + n, 0) || 1;
      let acc = 0;
      cum = colors.map(([c, n]) => {
        acc += n / total;
        const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(c);
        return { c: m ? cs.getPropertyValue(m[1]).trim() || '#ffffff' : c, upTo: acc };
      });
      paletteFor = colors;
      return cum;
    };
    const pick = () => {
      const u = Math.random();
      for (const s of cum) if (u <= s.upTo) return s.c;
      return cum[cum.length - 1]?.c ?? '#ffffff';
    };

    const spawn = (s: Streak, seed = false) => {
      const a = Math.random() * Math.PI * 2;
      s.ux = Math.cos(a);
      s.uy = Math.sin(a);
      // sqrt keeps the density even per unit AREA rather than per unit radius, and the
      // floor keeps a hole open at the vanishing point so it reads as depth, not a starburst
      s.r = (0.09 + 0.91 * Math.sqrt(Math.random())) * rMax;
      const { near, far } = cfg.current;
      // seeding fills the whole corridor at once; a respawn always re-enters at the back
      s.z = seed ? near + Math.random() * (far - near) : far * (0.92 + 0.08 * Math.random());
      s.k = 0.62 + 0.7 * Math.random();
      s.c = pick();
    };

    const size = () => {
      const r = box.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cs = getComputedStyle(el);
      palette(cs);
      // the vanishing point is a CSS custom property, so a media query moves it without a
      // breakpoint appearing in here as well
      const read = (name: string, fallback: number) => {
        const n = parseFloat(cs.getPropertyValue(name));
        return Number.isFinite(n) ? n : fallback;
      };
      ox = read('--ls-ox', cfg.current.origin[0]);
      oy = read('--ls-oy', cfg.current.origin[1]);

      // the widest radius that still lands off-frame at the near plane, at the reference fov
      rMax = (1.55 * Math.max(w, h)) / ((h / 2) / Math.tan(rad(REF_FOV) / 2));

      /* sqrt of the area ratio, not the ratio. Scaling the count linearly with area put
         34 streaks on a phone and 240 on a laptop — the same field read as weather on one
         and as three scratches on the other. The square root holds the PERCEIVED density
         roughly constant while still costing a phone a third of the strokes. */
      const want = clamp(
        Math.round(cfg.current.density * Math.sqrt((w * h) / (1440 * 640))),
        60,
        460,
      );
      const grew = want > streaks.length;
      streaks.length = want;
      for (let i = 0; i < want; i++) {
        const s = streaks[i] ?? (streaks[i] = { ux: 0, uy: 0, r: 0, z: 0, k: 1, c: '#fff' });
        if (grew || !s.c || !rMax) spawn(s, true);
        else s.r = Math.min(s.r, rMax);
      }
    };

    const frame = (dt: number) => {
      const c = cfg.current;
      // reduced motion gets the field mid-flight and holds it there; the picture survives,
      // the movement does not
      const d = still ? 0.55 : clamp(driveRef.current?.() ?? 1);
      const f = (h / 2) / Math.tan(rad(c.fov) / 2);
      const v = c.speed * c.speedUp * (0.28 + 0.72 * d);
      const len = c.length * (0.55 + 0.75 * d);

      tx += (px - tx) * Math.min(1, dt * 3.2);
      ty += (py - ty) * Math.min(1, dt * 3.2);
      const cx = w * ox + tx * c.parallax * w;
      const cy = h * oy + ty * c.parallax * h;

      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';

      for (const s of streaks) {
        s.z -= v * dt;
        if (s.z <= c.near) { spawn(s); continue; }

        const head = (s.r * f) / s.z;
        const tail = (s.r * f) / (s.z + len * s.k);
        const hx = cx + s.ux * head, hy = cy + s.uy * head;
        const lx = cx + s.ux * tail, ly = cy + s.uy * tail;

        // the tail is the inner end, so if IT has left the frame the whole segment has.
        // Recycled rather than skipped, or the field thins out at the sides over time.
        if (lx < 0 || lx > w || ly < 0 || ly > h) { spawn(s); continue; }

        // A short fade at each clip plane and nothing in between. The first pass faded the
        // near end over z 2.9..1, which is exactly where a streak is longest and fastest —
        // it dimmed the arrival and left the effect looking like a distant starfield.
        const near = clamp((s.z - c.near) / (c.near * 0.6));   // arriving: leaves the frame lit
        const far = clamp((c.far - s.z) / (c.far * 0.3));      // departing the back: fades in
        const a = near * far * s.k * (0.4 + 0.55 * d);
        if (a <= 0.012) continue;

        ctx.globalAlpha = Math.min(1, a);
        ctx.strokeStyle = s.c;
        ctx.lineWidth = c.thickness * clamp(2.1 / s.z, 0.32, 2.4);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    /* ── lifecycle ──────────────────────────────────────────────────────────────────
       Nothing runs while the band is off screen or the tab is hidden. On a page this
       long that is most of the session. */
    let raf = 0;
    let last = 0;
    let visible = false;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // a tab that was backgrounded returns with a multi-second delta; clamping it means
      // the field resumes where it was rather than teleporting a full corridor forward
      const dt = last ? Math.min((t - last) / 1000, 1 / 20) : 1 / 60;
      last = t;
      frame(dt);
    };
    const start = () => {
      if (raf || still) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const sync = () => (visible && !document.hidden ? start() : stop());

    size();
    frame(0);   // one composed frame immediately, so the band is never an empty rectangle

    const ro = new ResizeObserver(() => { size(); if (!raf) frame(0); });
    ro.observe(box);

    const io = new IntersectionObserver(
      ([e]) => { visible = e.isIntersecting; sync(); },
      { rootMargin: '20% 0px' },
    );
    io.observe(box);

    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);

    // hover only, and small: the field leans, it does not chase
    const fine = window.matchMedia('(pointer: fine)');
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      px = clamp((e.clientX - r.left) / r.width, 0, 1) * 2 - 1;
      py = clamp((e.clientY - r.top) / r.height, 0, 1) * 2 - 1;
    };
    const onLeave = () => { px = 0; py = 0; };
    if (fine.matches && !still) {
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerleave', onLeave);
    }

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerleave', onLeave);
      streaks = [];
    };
  }, [still]);

  return (
    <div ref={host} className={className ? `ls ${className}` : 'ls'}>
      <canvas ref={canvas} className="ls__c" aria-hidden />
    </div>
  );
}
