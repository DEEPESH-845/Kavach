/* ─────────────────────────────────────────────────────────────────────────────
   KAVACH — the page as an instrument.

   Zero dependencies, no build step (ADR-013: a judge cloning this at 11pm should
   not need a daemon). Everything here is either the product's own arithmetic run
   in the browser, or the motion primitive: a seam opening and closing.

   Every number below is transcribed from evals/risk_report.json and the tree.
   tests/test_site.py fails the build if this file and the report ever disagree.
   ───────────────────────────────────────────────────────────────────────────── */
'use strict';

/* ── measured, from evals/risk_report.json ──────────────────────────────── */
const REPORT = {
  threshold: 0.5132468693487481,
  duplicate_rate_assumption: 0.12,
  exposure_minor: 22531100,
  results: [
    { name: 'B0 escalate everything', precision: 0.16648648648648648, recall: 1.0,                 leaked_minor: 0,        review_rate: 1.0,                  gloss: 'the trivial ceiling on recall' },
    { name: 'B1 exact text match',    precision: 0.0,                 recall: 0.0,                 leaked_minor: 22531100, review_rate: 0.0,                  gloss: 'duplicates are paraphrases, so string equality is worthless' },
    { name: 'B2 rule: amt+open+24h',  precision: 0.18681318681318682, recall: 0.22077922077922077, leaked_minor: 18463600, review_rate: 0.19675675675675675,  gloss: 'what a competent engineer writes without ML' },
    { name: 'B3 learned, no text',    precision: 0.6593406593406593,  recall: 0.7792207792207793,  leaked_minor: 6110500,  review_rate: 0.19675675675675675,  gloss: 'relational features only' },
    { name: 'B4 learned + reads text',precision: 0.8131868131868132,  recall: 0.961038961038961,   leaked_minor: 1425700,  review_rate: 0.19675675675675675,  gloss: 'the system', hero: true },
  ],
  budget_sweep: [
    { budget: 0.05, escalated: 0.04108108108108108,  recall: 0.24675324675324675, precision: 1.0,                leaked_minor: 19522000, prevented_minor: 3009100 },
    { budget: 0.10, escalated: 0.08540540540540541,  recall: 0.512987012987013,   precision: 1.0,                leaked_minor: 12319500, prevented_minor: 10211600 },
    { budget: 0.20, escalated: 0.19675675675675675, recall: 0.961038961038961,   precision: 0.8131868131868132, leaked_minor: 1425700,  prevented_minor: 21105400 },
    { budget: 0.30, escalated: 0.28216216216216217, recall: 0.987012987012987,    precision: 0.5823754789272031, leaked_minor: 539600,   prevented_minor: 21991500 },
  ],
};
const TREE = { lines: 1573, tests: 52 };

/* ── the eight planes, ordered by how much of each can be proven ─────────── */
const PLANES = [
  { half: 'GATE · inbound',  n: '①', t: 'Credential',        m: 'Ed25519 envelope, nonce replay, cap arithmetic, scope',       k: 'steel', ai: 'no — deliberately', ms: '~3 ms'   },
  { half: 'GATE · inbound',  n: '②', t: 'Intent',            m: 'does the cart entail the mandate’s stated purpose?',          k: 'amber', ai: 'learned',           ms: '~120 ms' },
  { half: 'GATE · inbound',  n: '③', t: 'Provenance',        m: 'goal drift correlated to ingesting untrusted text',           k: 'amber', ai: 'learned',           ms: '~140 ms' },
  { half: 'GATE · inbound',  n: '④', t: 'Population',        m: 'rings, velocity, inhuman regularity over an identity graph',  k: 'amber', ai: 'classical ML',      ms: '~8 ms'   },
  { half: 'RAIL · outbound', n: '⑤', t: 'Truth',             m: 'events → FinancialFact. rail state ≠ obligation state',       k: 'steel', ai: 'no — deliberately', ms: '<1 ms'   },
  { half: 'RAIL · outbound', n: '⑥', t: 'Obligation ledger', m: 'what money is in flight, including intents with no webhook',  k: 'steel', ai: 'no',                ms: '<1 ms'   },
  { half: 'RAIL · outbound', n: '⑦', t: 'Duplicate risk',    m: 'relational features + the intent’s reason text',              k: 'amber', ai: 'learned, advisory', ms: '~2 ms'   },
  { half: 'RAIL · outbound', n: '⑧', t: 'Governor',          m: 'invariants → tiers → confidence → model → caps',              k: 'bone',  ai: 'policy',            ms: '<1 ms'   },
];

/* ── utils ───────────────────────────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const range = (v, a, b) => clamp((v - a) / (b - a));
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = n => (n * 100).toFixed(1) + '%';
const still = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 860px)');

/* ═════════════════════════════════════════════════════════════════════════
   THE SPINE — the append-only log at page scale, and the section counter.
   ═════════════════════════════════════════════════════════════════════════ */
function spine() {
  const head = $('.spine__head'), ticks = $('.spine__ticks'), nav = $('.nav');
  const num = $('[data-nav-num]'), sec = $('[data-nav-sec]');
  const marks = $$('[data-sec]');

  // one tick per event we could have logged; they light as the head passes.
  const N = 26, tickEls = [];
  if (!narrow.matches) {
    for (let i = 0; i < N; i++) {
      const t = document.createElement('span');
      t.className = 'spine__tick';
      t.style.top = ((i + .5) / N * 100) + '%';
      ticks.appendChild(t); tickEls.push(t);
    }
  }

  let raf = 0;
  const draw = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = clamp(scrollY / Math.max(1, max));

    if (narrow.matches) head.style.setProperty('--prog', (p * 100) + '%');
    else {
      head.style.setProperty('--head', (p * (innerHeight - 13)) + 'px');
      const lit = Math.round(p * N);
      tickEls.forEach((t, i) => t.toggleAttribute('data-on', i < lit));
    }

    nav.toggleAttribute('data-stuck', scrollY > innerHeight * .6);

    // active section = the last one whose top has crossed the upper third
    let cur = marks[0];
    for (const m of marks) if (m.getBoundingClientRect().top <= innerHeight * .34) cur = m;
    // the stage carries three named beats; it renames itself as it plays
    const name = cur.dataset.liveName || cur.dataset.name;
    if (num.textContent !== cur.dataset.sec) num.textContent = cur.dataset.sec;
    if (sec.textContent !== name) sec.textContent = name;
  };
  addEventListener('scroll', () => raf || (raf = requestAnimationFrame(draw)), { passive: true });
  addEventListener('resize', draw);
  draw();
}

/* ═════════════════════════════════════════════════════════════════════════
   REVEAL — content settles once, then the observer lets go.
   ═════════════════════════════════════════════════════════════════════════ */
function reveals() {
  const io = new IntersectionObserver((es) => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.setAttribute('data-shown', '');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });

  $$('[data-reveal]').forEach((el, i) => {
    el.style.setProperty('--delay', ((i % 4) * .06) + 's');
    io.observe(el);
  });
}

/* ═════════════════════════════════════════════════════════════════════════
   HERO — ambient field of the primitive, cursor influence, and the first seam.
   ═════════════════════════════════════════════════════════════════════════ */
function hero() {
  const field = $('.hero__field'), cell = $('[data-hero-cell]');

  if (!still.matches) {
    const count = narrow.matches ? 24 : 60, cells = [];
    const cols = Math.ceil(Math.sqrt(count * 1.7)), rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const el = document.createElement('i');
      el.style.left = (((i % cols) + .5 + (Math.random() - .5) * .8) / cols * 100).toFixed(2) + '%';
      el.style.top  = ((((i / cols) | 0) + .5 + (Math.random() - .5) * .8) / rows * 100).toFixed(2) + '%';
      el.style.opacity = (.18 + Math.random() * .34).toFixed(2);
      field.appendChild(el); cells.push(el);
    }
    // a few disagree — the seam is the exception, not the wallpaper
    for (let i = 2; i < cells.length; i += 17) cells[i].setAttribute('data-diverged', '');

    // low-amplitude, spring-damped: felt before it is noticed
    let tx = 0, ty = 0, x = 0, y = 0, live = false;
    addEventListener('pointermove', e => {
      tx = (e.clientX / innerWidth  - .5) * 2;
      ty = (e.clientY / innerHeight - .5) * 2;
      if (!live) { live = true; tick(); }
    }, { passive: true });
    const tick = () => {
      x = lerp(x, tx, .06); y = lerp(y, ty, .06);
      field.style.setProperty('--mx', x.toFixed(4));
      field.style.setProperty('--my', y.toFixed(4));
      if (Math.abs(x - tx) > .001 || Math.abs(y - ty) > .001) requestAnimationFrame(tick);
      else live = false;
    };
  }

  // the page's first statement: one entity, and the seam that proves it is two.
  setTimeout(() => cell.setAttribute('data-open', ''), still.matches ? 0 : 1100);
}

/* ═════════════════════════════════════════════════════════════════════════
   THE STAGE — pressure → refusal → gradient on one canvas, so the tiles that
   pile up are the same tiles that reorganise. This is the page's argument.
   ═════════════════════════════════════════════════════════════════════════ */
function stage() {
  const host = $('#stage'), cv = $('[data-stage-canvas]'), ctx = cv.getContext('2d');
  const layers = { pressure: $('[data-phase="pressure"]'), refusal: $('[data-phase="refusal"]'), gradient: $('[data-phase="gradient"]') };
  const ctrls = $$('[data-ctrl]');
  const nIntents = $('[data-count-intents]'), nExposure = $('[data-count-exposure]');
  $$('.counter__l')[1].textContent = 'unverified exposure · ₹5,000 each';

  const COL = { steel: '#7fa8c9', amber: '#e0a340', bone: '#e9e6de', seam: '#2f383d', iron: '#101315' };
  const N = narrow.matches ? 84 : (navigator.hardwareConcurrency || 4) <= 4 ? 150 : 240;

  // A jittered grid, not a random scatter. Random reads as noise; a grid under
  // stress reads as a system, which is the thing the section has to say.
  const cols = Math.ceil(Math.sqrt(N * 1.7)), rows = Math.ceil(N / cols);
  const tiles = [];
  for (let i = 0; i < N; i++) tiles.push({
    hx: ((i % cols) + .5 + (Math.random() - .5) * .8) / cols,
    hy: (((i / cols) | 0) + .5 + (Math.random() - .5) * .8) / rows,
    drift: Math.random() * Math.PI * 2,
    d: Math.random(),   // the lower, the sooner this tile stops agreeing
  });
  // shuffle so the population ramps in scattered, then hand out ladder slots in
  // order so the resolved gradient is tidy
  for (let i = N - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  tiles.forEach((t, i) => { t.plane = i % 8; t.k = PLANES[t.plane].k; t.slot = (i / 8) | 0; });
  const perRow = Math.ceil(N / 8);

  let w = 0, h = 0, dpr = 1, phase = 0, t0 = performance.now(), running = false;

  const size = () => {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // one tile: the split cell at its smallest. gap>0 means the halves disagree.
  const tile = (x, y, gap, colour, alpha) => {
    const W = 9, H = 13;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour; ctx.lineWidth = 1;
    ctx.fillStyle = COL.iron;
    const l = Math.round(x - W / 2 - gap) + .5, r = Math.round(x + gap) + .5, ty = Math.round(y - H / 2) + .5;
    ctx.fillRect(l, ty, W / 2, H); ctx.strokeRect(l, ty, W / 2, H);
    ctx.fillRect(r, ty, W / 2, H); ctx.strokeRect(r, ty, W / 2, H);
  };

  const label = (x, y, text, colour, alpha) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = colour;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.letterSpacing = '1.4px';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  };

  const draw = () => {
    const p = phase, now = (performance.now() - t0) / 1000;
    ctx.clearRect(0, 0, w, h);

    // The composition is fixed for the whole stage: the argument holds the left
    // column, the system holds the right. Nothing is ever drawn under running text.
    const gut = clamp(w * .05, 20, 64);
    const wrapW = Math.min(w - gut * 2, 1120);
    const L = narrow.matches ? 12 : (w - wrapW) / 2 + 520 + 48;
    const R = narrow.matches ? w - 14 : (w + wrapW) / 2;   // field ends on the text column
    const dim = narrow.matches ? .45 : 1;

    const ramp    = smooth(range(p, 0.00, 0.34));         // 4 → N tiles
    const collapse= smooth(range(p, 0.32, 0.44));         // everything falls quiet
    const rebuild = smooth(range(p, narrow.matches ? 0.68 : 0.52, 0.88));
    const visible = Math.max(4, Math.round(4 + ramp ** 1.7 * (N - 4)));
    const divRate = ramp * 0.45;                          // how many stop agreeing

    // the ladder the tiles resolve into
    const labelW = narrow.matches ? 26 : 196;
    const rowH = narrow.matches ? Math.min(34, h * .05) : Math.min(46, h * .072);
    const top = h / 2 - rowH * 3.5;
    const runL = L + labelW, span = Math.max(60, R - runL);

    for (let i = 0; i < visible; i++) {
      const t = tiles[i];
      const cx = lerp(L + 14 + t.hx * (R - L - 28), runL + (t.slot + .5) / perRow * span, rebuild);
      const cy = lerp(t.hy * (h - 60) + 30, top + t.plane * rowH, rebuild);
      const wob = still.matches ? 0 : Math.sin(now * .55 + t.drift) * 3 * (1 - rebuild);

      const diverged = t.d < divRate;
      // in the gradient, only the learned planes are still allowed to be unsure
      const open = lerp(diverged ? 3 : 0, t.k === 'amber' ? 2 : 0, rebuild);
      const colour = rebuild > .5 ? COL[t.k] : diverged ? COL.amber : COL.seam;
      const alpha = (1 - collapse * (1 - rebuild)) * lerp(.55, 1, rebuild) * dim;
      if (alpha > .01) tile(cx + wob, cy, open, colour, alpha);
    }

    if (rebuild > .25) {
      const a = smooth(range(rebuild, .25, .7));
      const txt = narrow.matches ? pl => pl.n : pl => pl.n + '  ' + pl.t.toUpperCase();
      PLANES.forEach((pl, i) => label(L, top + i * rowH, txt(pl), COL[pl.k], a * .9));
      if (!narrow.matches) {
        label(L, top - rowH * 1.3, 'PROVABLE AT THE ENTRANCE', COL.steel, a * .45);
        label(L, top + rowH * 8.3, 'DECIDED AT THE EXIT', COL.bone, a * .45);
      }
    }
    ctx.globalAlpha = 1;
  };

  // copy layers, counters and the failing controls all read the same phase
  const paint = () => {
    const p = phase;
    const n = narrow.matches;
    const o = {
      pressure: Math.min(smooth(range(p, .02, .09)), 1 - smooth(range(p, n ? .26 : .28, n ? .33 : .34))),
      refusal:  Math.min(smooth(range(p, .38, .44)), 1 - smooth(range(p, .50, .55))),
      gradient: n ? Math.min(smooth(range(p, .56, .62)), 1 - smooth(range(p, .68, .74)))
                  : smooth(range(p, .60, .68)),
    };
    for (const k in o) {
      layers[k].style.opacity = o[k].toFixed(3);
      layers[k].style.transform = 'translateY(' + ((1 - o[k]) * 14).toFixed(1) + 'px)';
    }
    ctrls.forEach((li, i) => li.toggleAttribute('data-on', p > .07 + i * .045));

    const flight = Math.round(Math.max(0, smooth(range(p, .02, .34)) ** 1.7) * 240);
    nIntents.textContent = flight.toLocaleString('en-IN');
    nExposure.textContent = inr(flight * 5000);

    // the spine's section counter follows the beat, not the DOM section
    host.dataset.liveName = p < .36 ? 'PRESSURE' : p < .58 ? 'REFUSAL' : 'THE GRADIENT';
    host.dataset.sec = p < .36 ? '03' : p < .58 ? '04' : '05';
  };

  const measure = () => {
    const r = host.getBoundingClientRect();
    phase = clamp(-r.top / Math.max(1, r.height - innerHeight));
  };

  const loop = () => {
    if (!running) return;
    measure(); paint(); draw();
    requestAnimationFrame(loop);
  };

  size();
  addEventListener('resize', () => { size(); measure(); paint(); draw(); });

  if (still.matches) {                    // static: draw the settled gradient only
    phase = 1; paint(); draw();
    Object.values(layers).forEach(l => { l.style.opacity = 1; l.style.transform = 'none'; });
    ctrls.forEach(li => li.setAttribute('data-on', ''));
    nIntents.textContent = '240'; nExposure.textContent = inr(240 * 5000);
    return;
  }

  // nothing offscreen is allowed to burn a frame
  new IntersectionObserver(es => {
    es.forEach(e => {
      if (e.isIntersecting && !running) { running = true; loop(); }
      else if (!e.isIntersecting) running = false;
    });
  }, { rootMargin: '10% 0px' }).observe(host);
}

/* ═════════════════════════════════════════════════════════════════════════
   THE PLANES — the gradient, hoverable, in the DOM where a reader can read it.
   ═════════════════════════════════════════════════════════════════════════ */
function planes() {
  const ol = $('[data-planes]');
  let half = '';
  PLANES.forEach(p => {
    if (p.half !== half) {
      half = p.half;
      const h = document.createElement('li');
      h.className = 'eyebrow';
      h.style.cssText = 'padding:26px 0 10px;margin:0';
      h.textContent = half;
      ol.appendChild(h);
    }
    const li = document.createElement('li');
    li.className = 'plane'; li.dataset.k = p.k;
    li.innerHTML = `<span class="plane__n">${p.n}</span>
      <span class="plane__t">${p.t}</span>
      <span class="plane__m">${p.m}</span>
      <span class="plane__ai">${p.ai}</span>
      <span class="plane__ms">${p.ms}</span>`;
    ol.appendChild(li);
  });
}

/* ═════════════════════════════════════════════════════════════════════════
   AUTHORITY — governor.decide(), run in the browser. Order is strongest-first,
   and no value of the model's score reaches past an invariant.
   ═════════════════════════════════════════════════════════════════════════ */
function authority() {
  const score = $('[data-in="score"]'), out = $('[data-out="score"]');
  const box = { captured: $('[data-in="captured"]'), within: $('[data-in="within"]'), write: $('[data-in="write"]'), unknown: $('[data-in="unknown"]') };
  const rungs = $$('[data-ladder] li');
  const vBox = $('[data-verdict]'), vVal = $('[data-verdict-v]'), vWhy = $('[data-verdict-why]');
  const THRESH = REPORT.threshold;

  const run = () => {
    const s = parseFloat(score.value);
    out.textContent = s.toFixed(2);

    const state = ['pass', 'pass', 'pass', 'pass', 'pass'];
    const note  = ['clear', 'write tier', 'certain', 'below threshold', 'within caps'];
    let verdict = 'ALLOW', why = 'Nothing objects. The refund executes under an idempotency key derived from the intent id.';

    if (!box.captured.checked) {
      state[0] = 'deny'; note[0] = 'not captured';
      verdict = 'DENY'; why = 'The payment is not captured; there are no funds to refund. Deterministic, above the model, and not approvable by anyone.';
    } else if (!box.within.checked) {
      state[0] = 'deny'; note[0] = 'over-refund';
      verdict = 'DENY'; why = 'This would refund more than the captured amount. A model score of 0.00 does not buy permission to break an accounting invariant.';
    } else if (!box.write.checked) {
      state[1] = 'deny'; note[1] = 'read-only';
      verdict = 'DENY'; why = 'The agent holds a read-only tier for money-moving tools.';
    } else {
      if (box.unknown.checked) {
        state[2] = 'escalate'; note[2] = 'UNKNOWN';
        verdict = 'ESCALATE'; why = 'An open obligation on this payment is AMBIGUOUS, so the effect of this refund cannot be predicted. Unknown is a reason to stop, not a reason to proceed carefully.';
      }
      if (s >= THRESH) {
        state[3] = 'escalate'; note[3] = s.toFixed(2) + ' ≥ ' + THRESH.toFixed(2);
        if (verdict !== 'ESCALATE') {
          verdict = 'ESCALATE';
          why = 'Duplicate risk is at or above the frozen train threshold: this intent may be an obligation already in flight. Queued for a human — the model escalates, it never denies.';
        } else {
          why += ' Duplicate risk is also above threshold.';
        }
      }
    }
    // rungs below a DENY are never reached; saying so is the point of the order
    const stop = state.indexOf('deny');
    rungs.forEach((li, i) => {
      const reached = stop === -1 || i <= stop;
      li.dataset.fired = reached ? state[i] : 'pass';
      li.querySelector('.rung__s').textContent = reached ? note[i] : 'not reached';
    });

    vBox.dataset.v = verdict; vVal.textContent = verdict; vWhy.textContent = why;
  };

  [score, ...Object.values(box)].forEach(el => el.addEventListener('input', run));
  run();
}

/* ═════════════════════════════════════════════════════════════════════════
   EXPECTED LOSS — gate/admission.decide(). argmin over merchant-supplied costs.
   ═════════════════════════════════════════════════════════════════════════ */
function expectedLoss() {
  const pIn = $('[data-in="p"]'), lIn = $('[data-in="L"]');
  const pOut = $('[data-out="p"]'), lOut = $('[data-out="L"]');
  const bars = $$('[data-bars] li');
  // Two corrections against the first pass, both economic rather than cosmetic.
  // Margin lost on a good cart wrongly refused scales with the cart, so DENY is
  // proportional. And the cost of a step-up is dominated by the checkout it
  // interrupts, not by the message — pricing it at the message alone made
  // STEP_UP lose at every setting, which is a broken instrument, not a cautious one.
  const C = { c_step: 45, c_hold: 140, r_step: .70, r_hold: .95, margin: .18 };

  const run = () => {
    const p = parseFloat(pIn.value), L = parseFloat(lIn.value);
    pOut.textContent = p.toFixed(2); lOut.textContent = inr(L);

    const el = {
      ALLOW:   p * L,
      STEP_UP: C.c_step + p * (1 - C.r_step) * L,
      HOLD:    C.c_hold + p * (1 - C.r_hold) * L,
      DENY:    (1 - p) * C.margin * L,
    };
    const max = Math.max(...Object.values(el), 1);
    const win = Object.keys(el).reduce((a, b) => el[a] <= el[b] ? a : b);

    bars.forEach(li => {
      const k = li.dataset.bar, v = el[k];
      li.querySelector('.bar__t i').style.setProperty('--w', (v / max * 100).toFixed(1) + '%');
      li.querySelector('.bar__v').textContent = inr(v);
      li.toggleAttribute('data-win', k === win);
    });
  };
  [pIn, lIn].forEach(el => el.addEventListener('input', run));
  run();
}

/* ═════════════════════════════════════════════════════════════════════════
   EVIDENCE — the measured table, and the friction the merchant chooses to buy.
   ═════════════════════════════════════════════════════════════════════════ */
function evidence() {
  const tb = $('[data-results] tbody');
  REPORT.results.forEach(r => {
    const tr = document.createElement('tr');
    if (r.hero) tr.setAttribute('data-hero', '');
    tr.innerHTML = `<td>${r.name}<span class="sr"> — ${r.gloss}</span></td>
      <td>${r.precision.toFixed(3)}</td>
      <td>${r.recall.toFixed(3)}</td>
      <td>${pct(r.review_rate)}</td>
      <td${r.leaked_minor ? ' data-leak' : ''}>${inr(r.leaked_minor / 100)}</td>`;
    tb.appendChild(tr);
  });

  const btns = $('[data-sweep-btns]'), out = $('[data-sweep-out]');
  const show = i => {
    const s = REPORT.budget_sweep[i];
    out.innerHTML = `
      <div><dt>escalated</dt><dd>${pct(s.escalated)}</dd></div>
      <div><dt>recall</dt><dd>${s.recall.toFixed(3)}</dd></div>
      <div><dt>precision</dt><dd>${s.precision.toFixed(3)}</dd></div>
      <div><dt>still leaked</dt><dd>${inr(s.leaked_minor / 100)}</dd></div>`;
    $$('.sweep__btn', btns).forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
  };
  REPORT.budget_sweep.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sweep__btn';
    b.textContent = 'review budget ' + (s.budget * 100) + '%';
    b.addEventListener('click', () => show(i));
    btns.appendChild(b);
  });
  show(2);   // the operating point the headline numbers are quoted at
}

/* ═════════════════════════════════════════════════════════════════════════
   PROOF — the chain, assembling once, then done.
   ═════════════════════════════════════════════════════════════════════════ */
function proof() {
  $('[data-tree]').textContent = TREE.lines.toLocaleString('en-IN') + ' lines · ' + TREE.tests + ' tests';
}

/* ── go ──────────────────────────────────────────────────────────────────── */
spine(); reveals(); hero(); planes(); stage(); authority(); expectedLoss(); evidence(); proof();
