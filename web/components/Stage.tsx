'use client';

import { useEffect, useRef } from 'react';
import { } from 'motion/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { PLANES } from '@/lib/data';
import { useStill } from '@/lib/motion';
import { clamp, lerp, smooth, range, inr, seeded } from '@/lib/util';

gsap.registerPlugin(ScrollTrigger);

/* PRESSURE → REFUSAL → GRADIENT share one canvas, so the tiles that pile up under load are
   the same tiles that reorganise into the determinism gradient. GSAP owns the choreography:
   one ScrollTrigger maps scroll to a single phase, a scrubbed timeline moves the copy, and
   the canvas renders off gsap.ticker so there is exactly one rAF loop on the page. */

const COL = { steel: '#7fa8c9', amber: '#e0a340', bone: '#e9e6de', seam: '#2f383d', iron: '#101315' };

const CONTROLS = [
  ['idempotency key', 'bounds a <em>replayed</em> request', 'the agent minted a new key'],
  ['AP2 mandate', 'bounds <em>authorisation</em>', 'the human did authorise. Twice.'],
  ['issuing spend cap', 'bounds the <em>amount</em>', '₹5,000 again, inside a ₹50,000 cap'],
  ['MCP --read-only', 'bounds <em>which tools</em> exist', 'it legitimately needs create_refund'],
  ['Thirdwatch', 'bounds <em>human</em> fraud signals', 'a good agent looks like a good agent'],
];

export function Stage() {
  const still = useStill();
  const host = useRef<HTMLElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const intents = useRef<HTMLSpanElement>(null);
  const exposure = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = host.current!, canvas = cv.current!, ctx = canvas.getContext('2d')!;
    const narrow = matchMedia('(max-width: 860px)').matches;
    const rnd = seeded(11);

    const N = narrow ? 84 : (navigator.hardwareConcurrency ?? 4) <= 4 ? 150 : 240;
    const cols = Math.ceil(Math.sqrt(N * 1.7)), rows = Math.ceil(N / cols);
    const tiles = Array.from({ length: N }, (_, i) => ({
      hx: ((i % cols) + 0.5 + (rnd() - 0.5) * 0.8) / cols,
      hy: (((i / cols) | 0) + 0.5 + (rnd() - 0.5) * 0.8) / rows,
      drift: rnd() * Math.PI * 2,
      d: rnd(),                    // the lower, the sooner this tile stops agreeing
      plane: 0, k: 'steel' as keyof typeof COL, slot: 0,
    }));
    // ramp in scattered, resolve tidy
    for (let i = N - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    tiles.forEach((t, i) => { t.plane = i % 8; t.k = PLANES[t.plane].k; t.slot = (i / 8) | 0; });
    const perRow = Math.ceil(N / 8);

    let w = 0, h = 0, phase = still ? 1 : 0, strain = 0;

    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const tile = (x: number, y: number, gap: number, colour: string, alpha: number) => {
      const W = 9, H = 13;
      ctx.globalAlpha = alpha; ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.fillStyle = COL.iron;
      const l = Math.round(x - W / 2 - gap) + 0.5, r = Math.round(x + gap) + 0.5;
      const ty = Math.round(y - H / 2) + 0.5;
      ctx.fillRect(l, ty, W / 2, H); ctx.strokeRect(l, ty, W / 2, H);
      ctx.fillRect(r, ty, W / 2, H); ctx.strokeRect(r, ty, W / 2, H);
    };

    const label = (x: number, y: number, text: string, colour: string, alpha: number) => {
      ctx.globalAlpha = alpha; ctx.fillStyle = colour;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.letterSpacing = '1.4px'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    };

    const draw = () => {
      const p = phase, now = performance.now() / 1000;
      ctx.clearRect(0, 0, w, h);

      // the composition is fixed for the whole stage: argument left, system right
      const gut = clamp(w * 0.05, 20, 64), wrapW = Math.min(w - gut * 2, 1120);
      const L = narrow ? 12 : (w - wrapW) / 2 + 520 + 48;
      const R = narrow ? w - 14 : (w + wrapW) / 2;
      const dim = narrow ? 0.45 : 1;

      const ramp = smooth(range(p, 0, 0.32));
      const collapse = smooth(range(p, 0.34, 0.46));
      // The field comes back before it reorganises: `revive` restores presence early so
      // it can carry the frame while the copy changes over, `rebuild` moves the tiles
      // into the ladder long after. Splitting the two is what removes the muddy
      // half-of-everything crossfade without leaving an empty screen.
      const revive = smooth(range(p, narrow ? 0.50 : 0.48, narrow ? 0.60 : 0.60));
      const rebuild = smooth(range(p, narrow ? 0.72 : 0.52, narrow ? 0.94 : 0.90));
      const visible = Math.max(4, Math.round(4 + ramp ** 1.7 * (N - 4)));
      // scrolling faster is pushing the system harder, so more of it stops agreeing
      const divRate = ramp * (0.42 + smooth(strain) * 0.34);

      const labelW = narrow ? 26 : 196;
      const rowH = narrow ? Math.min(34, h * 0.05) : Math.min(46, h * 0.072);
      const top = h / 2 - rowH * 3.5, runL = L + labelW, span = Math.max(60, R - runL);

      for (let i = 0; i < visible; i++) {
        const t = tiles[i];
        const cx = lerp(L + 14 + t.hx * (R - L - 28), runL + ((t.slot + 0.5) / perRow) * span, rebuild);
        const cy = lerp(t.hy * (h - 60) + 30, top + t.plane * rowH, rebuild);
        const wob = still ? 0 : Math.sin(now * 0.55 + t.drift) * 3 * (1 - rebuild);
        const diverged = t.d < divRate;
        // in the gradient only the learned planes are still allowed to be unsure
        const open = lerp(diverged ? 3 : 0, t.k === 'amber' ? 2 : 0, rebuild);
        const colour = rebuild > 0.5 ? COL[t.k] : diverged ? COL.amber : COL.seam;
        const alpha = (1 - collapse * (1 - revive)) * lerp(0.55, 1, rebuild) * dim;
        if (alpha > 0.01) tile(cx + wob, cy, open, colour, alpha);
      }

      if (rebuild > 0.25) {
        const a = smooth(range(rebuild, 0.25, 0.7));
        PLANES.forEach((pl, i) =>
          label(L, top + i * rowH, narrow ? pl.n : `${pl.n}  ${pl.t.toUpperCase()}`, COL[pl.k], a * 0.9));
        if (!narrow) {
          label(L, top - rowH * 1.3, 'PROVABLE AT THE ENTRANCE', COL.steel, a * 0.45);
          label(L, top + rowH * 8.3, 'DECIDED AT THE EXIT', COL.bone, a * 0.45);
        }
      }
      ctx.globalAlpha = 1;
    };

    size();
    const onResize = () => { size(); draw(); };
    addEventListener('resize', onResize);

    if (still) {
      // a still page shows the system at full load rather than at zero, because the
      // counters are the section's claim and an empty counter states the opposite
      draw();
      if (intents.current) intents.current.textContent = (240).toLocaleString('en-IN');
      if (exposure.current) exposure.current.textContent = inr(240 * 5000);
      return () => removeEventListener('resize', onResize);
    }

    const ctxGsap = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const layers = { pressure: q('[data-phase="pressure"]'), refusal: q('[data-phase="refusal"]'), gradient: q('[data-phase="gradient"]') };

      /* Every beat hands over before the previous one is gone. The stage opens with the
         first beat already on screen, so arriving at it is continuous with the section
         above rather than a fade from nothing, and the exits overlap the entrances so no
         scroll position is ever left holding an empty frame. */
      gsap.set(layers.pressure, { opacity: 1, y: 0 });

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.5 },
      });
      tl.to({}, { duration: 1 }, 0);                                   // spacer: total = 1
      tl.fromTo(q('[data-ctrl]'), { opacity: 0.18, y: 6 },
                { opacity: 1, y: 0, duration: 0.05, stagger: 0.035 }, 0.03)
        .to(layers.pressure, { opacity: 0, y: -14, duration: 0.06 }, 0.32)
        .fromTo(layers.refusal, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.06 }, 0.36)
        .to(layers.refusal, { opacity: 0, y: -14, duration: 0.05 }, 0.50)
        .fromTo(layers.gradient, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.08 },
                narrow ? 0.58 : 0.58);
      if (narrow) tl.to(layers.gradient, { opacity: 0, duration: 0.06 }, 0.72);

      ScrollTrigger.create({
        trigger: el, start: 'top top', end: 'bottom bottom',
        onUpdate: (self) => {
          phase = self.progress;
          // ScrollTrigger hands us velocity, so strain is measured rather than guessed
          strain = clamp(Math.abs(self.getVelocity()) / 2600);
          const flight = Math.round(Math.max(0, smooth(range(phase, 0, 0.32)) ** 1.7) * 240);
          if (intents.current) intents.current.textContent = flight.toLocaleString('en-IN');
          if (exposure.current) exposure.current.textContent = inr(flight * 5000);
          el.dataset.beat = phase < 0.35 ? 'PRESSURE' : phase < 0.57 ? 'REFUSAL' : 'THE GRADIENT';
          el.dataset.beatN = phase < 0.35 ? '03' : phase < 0.57 ? '04' : '05';
        },
        onLeave: () => { delete el.dataset.beat; },
        onLeaveBack: () => { delete el.dataset.beat; },
      });
    }, el);

    gsap.ticker.add(draw);
    return () => {
      gsap.ticker.remove(draw);
      ctxGsap.revert();
      removeEventListener('resize', onResize);
    };
  }, [still]);

  return (
    <section className="stage" id="stage" ref={host}>
      <div className="stage__sticky">
        <canvas className="stage__canvas" ref={cv} aria-hidden />

        <div className="stage__layer" data-phase="pressure">
          <div className="wrap stage__copy">
            <p className="eyebrow">03 — the controls that exist</p>
            <h2 className="h2">Every one of them bounds the wrong thing.</h2>
            <ul className="controls">
              {CONTROLS.map(([name, what, fail], i) => (
                <li key={i} data-ctrl>
                  <span className="ctrl__name mono">{name}</span>
                  <span className="ctrl__what" dangerouslySetInnerHTML={{ __html: what }} />
                  <span className="ctrl__fail">{fail}</span>
                </li>
              ))}
            </ul>
            <p className="counter-row">
              <span className="counter">
                <span className="counter__n mono" ref={intents}>0</span>
                <span className="counter__l">intents in flight</span>
              </span>
              <span className="counter">
                <span className="counter__n mono" data-oxide ref={exposure}>₹0</span>
                <span className="counter__l">unverified exposure · ₹5,000 each</span>
              </span>
            </p>
          </div>
        </div>

        <div className="stage__layer stage__layer--center" data-phase="refusal">
          <div className="refusal">
            <p className="refusal__line">An idempotency key protects a <em>retried</em> request.</p>
            <p className="refusal__line refusal__line--2">Nothing protects a <em>re-decided</em> one.</p>
            <p className="refusal__sub">
              The question no control asks: is this new intent financially the same obligation as
              something already in flight?
            </p>
          </div>
        </div>

        <div className="stage__layer" data-phase="gradient">
          <div className="wrap stage__copy">
            <p className="eyebrow">05 — the shape of the fix</p>
            <h2 className="h2">Order the system by how much of it can be proven.</h2>
            <p className="body body--tight">
              Cryptography and integer arithmetic at the entrance. Accounting invariants at the
              exit. The learned parts sit in the middle, where the ambiguity actually is — and they
              may only ever move a decision toward <em>more</em> caution.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
