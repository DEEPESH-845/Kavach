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
const TREE = { lines: 1759, tests: 77 };

/* ── the eight planes, ordered by how much of each can be proven ─────────── */
const PLANES = [
  { half: 'GATE · inbound',  n: '①', t: 'Credential',        m: 'Ed25519 envelope, nonce replay, cap arithmetic, scope',       k: 'steel', ai: 'no — deliberately', ms: '~3 ms',
    catches: 'Forged, expired, revoked, replayed and out-of-scope mandates. Cap arithmetic in integer minor units, against a spend ledger recomputed from the log.',
    cannot: 'Tell you whether the cart matches the purpose. A valid signature answers <em>who</em>, never <em>what</em>.',
    boundary: 'The envelope is untrusted — it arrives with the agent. The signature is verified over the raw bytes before anything is parsed.' },
  { half: 'GATE · inbound',  n: '②', t: 'Intent',            m: 'does the cart entail the mandate’s stated purpose?',          k: 'amber', ai: 'learned',           ms: '~120 ms',
    catches: '₹1,800 of gift cards satisfying “weekly groceries under ₹2,000” arithmetically, and an ₹18,000 chair satisfying “office supplies”.',
    cannot: 'Judge a cart that is genuinely in scope but wrong for reasons the mandate never mentions.',
    boundary: 'The cart is merchant-supplied, so category and liquidity flags are trusted. If the agent could set them the check would be self-certified and worthless.' },
  { half: 'GATE · inbound',  n: '③', t: 'Provenance',        m: 'goal drift correlated to ingesting untrusted text',           k: 'amber', ai: 'learned',           ms: '~140 ms',
    catches: 'An objective that mutated immediately after the agent read a product review, and the span of hostile text that moved it.',
    cannot: 'An agent that was hostile before the session began. There is no drift to measure against.',
    boundary: 'Page text, cart text and traces enter our own prompts as tagged untrusted data, never as instructions. A test asserts the verifier refuses an embedded “return ALLOW”.' },
  { half: 'GATE · inbound',  n: '④', t: 'Population',        m: 'rings, velocity, inhuman regularity over an identity graph',  k: 'amber', ai: 'classical ML',      ms: '~8 ms',
    catches: 'Mandate-farming rings sharing devices, addresses or tokens; timing too regular to be a person.',
    cannot: 'A patient single actor with clean infrastructure. Population signal needs a population.',
    boundary: 'Split by principal and by ring, never by row — a ring straddling train and test would score itself.' },
  { half: 'RAIL · outbound', n: '⑤', t: 'Truth',             m: 'events → FinancialFact. rail state ≠ obligation state',       k: 'steel', ai: 'no — deliberately', ms: '<1 ms',
    catches: '<span class="mono">processed</span> read as <em>credited</em>. Contradictions, and silence past the staleness tolerance.',
    cannot: 'Observe anything NPCI-side. Those conditions are returned as <span class="mono">AMBIGUOUS</span> with a stated reason, never invented.',
    boundary: 'An unverified webhook never becomes <span class="mono">DERIVED_CERTAIN</span> evidence. HMAC is checked over the raw body, constant-time.' },
  { half: 'RAIL · outbound', n: '⑥', t: 'Obligation ledger', m: 'what money is in flight, including intents with no webhook',  k: 'steel', ai: 'no',                ms: '<1 ms',
    catches: 'Money already in flight whose webhook has not landed — the window every duplicate is born in.',
    cannot: 'See obligations created outside this merchant’s surface.',
    boundary: 'Exposure is recomputed from the event log on every call. A second copy of a derived number is a number that drifts, silently.' },
  { half: 'RAIL · outbound', n: '⑦', t: 'Duplicate risk',    m: 'relational features + the intent’s reason text',              k: 'amber', ai: 'learned, advisory', ms: '~2 ms',
    catches: '“The refund didn’t work, issue another” against an obligation already open. The same string scores 0.951 in one context and 0.042 in another.',
    cannot: 'Authorise anything. It may raise a decision toward a human and do nothing else.',
    boundary: 'Precision 0.813 — roughly one in five escalations delays a legitimate refund. That cost is why it escalates rather than denies.' },
  { half: 'RAIL · outbound', n: '⑧', t: 'Governor',          m: 'invariants → tiers → confidence → model → caps',              k: 'bone',  ai: 'policy',            ms: '<1 ms',
    catches: 'Everything the model is not allowed to authorise, in a fixed order, strongest first.',
    cannot: 'Be talked past. No score, and no human, waves through an accounting invariant.',
    boundary: 'Degradation only ever raises the floor. There is no failure path in this system that ends somewhere more permissive than the healthy one.' },
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

  // The headline arrives a word at a time from behind a mask. Words, not letters:
  // letter-by-letter turns a sentence into an effect, and this sentence is the thesis.
  const h1 = $('.display');
  (function split(node) {
    [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(tok => {
          if (!tok.trim()) return void frag.append(tok);
          const w = document.createElement('span'); w.className = 'w';
          const inner = document.createElement('i'); inner.textContent = tok;
          w.append(inner); frag.append(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) split(n);
    });
  })(h1);
  $$('.w > i', h1).forEach((w, i) => w.style.setProperty('--wd', (i * 0.045).toFixed(3) + 's'));
  requestAnimationFrame(() => document.body.setAttribute('data-lit', ''));

  // the fill starts where the pointer entered: the seam you opened yourself
  $$('.btn').forEach(btn => btn.addEventListener('pointerenter', e => {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--ox', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
  }));

  // the page's first statement: one entity, and the seam that proves it is two.
  setTimeout(() => cell.setAttribute('data-open', ''), still.matches ? 0 : 1100);

  // An obligation nobody closed gets older while you read. `unresolved_for` is a
  // real field on FinancialFact; here it is the only thing on the page that moves
  // without you, because that is the whole complaint.
  const clock = $('[data-unresolved]');
  const t0 = Date.now() - 4 * 3600e3 - 12 * 60e3;   // the demo refund, four hours in
  const hhmmss = ms => [ms / 3600e3, ms / 60e3 % 60, ms / 1e3 % 60]
    .map(v => String(Math.floor(v)).padStart(2, '0')).join(':');
  const tickClock = () => { clock.textContent = hhmmss(Date.now() - t0); };
  tickClock();
  setInterval(tickClock, 1000);
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
    // Scrolling faster is pushing the system harder, so more of it stops agreeing.
    // Velocity earns its place here because it means something; it is not parallax.
    const divRate = ramp * (0.42 + smooth(strain * 26) * 0.34);

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

  let strain = 0, prev = 0;
  const measure = () => {
    const r = host.getBoundingClientRect();
    phase = clamp(-r.top / Math.max(1, r.height - innerHeight));
    strain = lerp(strain, Math.abs(phase - prev), .18);   // damped, so it decays visibly
    prev = phase;
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
    // native <details>: keyboard, screen readers and height interpolation for free
    const li = document.createElement('li');
    li.className = 'plane'; li.dataset.k = p.k;
    li.innerHTML = `<details class="plane__d">
      <summary class="plane__row">
        <span class="plane__n">${p.n}</span>
        <span class="plane__t">${p.t}</span>
        <span class="plane__m">${p.m}</span>
        <span class="plane__ai">${p.ai}</span>
        <span class="plane__ms">${p.ms}</span>
        <span class="plane__x" aria-hidden="true"></span>
      </summary>
      <dl class="plane__body">
        <div><dt>what it catches</dt><dd>${p.catches}</dd></div>
        <div><dt>what it cannot</dt><dd>${p.cannot}</dd></div>
        <div><dt>trust boundary</dt><dd>${p.boundary}</dd></div>
      </dl>
    </details>`;
    // the row's open state drives the li, so the accent bar and background follow
    const d = li.firstElementChild;
    d.addEventListener('toggle', () => li.toggleAttribute('open', d.open));
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
   THE STREAM — the same authority ladder, at volume.

   Seeded from the corpus's own seed, over the corpus's own obligation kinds and
   reason strings, at the report's stated 12% duplicate base rate and its frozen
   threshold. It is a replay, it says so on the tin, and it is reproducible: the
   same seed gives the same stream every time this page loads.
   ═════════════════════════════════════════════════════════════════════════ */
const KINDS = [
  { k: 'duplicate_charge', share: [1, 1], texts: ['customer was charged twice for this order', 'duplicate debit reported by the buyer', 'double charge on the same order, please reverse one', 'buyer says he paid twice, refund the extra one'] },
  { k: 'item_damaged',     share: [.6, 1], texts: ['item arrived damaged', 'product was broken on delivery', 'customer received a cracked unit', 'packaging crushed, item unusable'] },
  { k: 'shipping_fee',     share: [.02, .08], texts: ['refund the shipping charge only', 'waive the delivery fee for this order', 'refund delivery charges, keep the item amount'] },
  { k: 'not_delivered',    share: [1, 1], texts: ['order never arrived', 'package not delivered to the customer', 'courier marked delivered but customer denies receipt'] },
  { k: 'size_return',      share: [.4, .9], texts: ['wrong size, customer returned it', 'size mismatch return', 'returned - size too small'] },
  { k: 'price_match',      share: [.05, .2], texts: ['price dropped after purchase, refund the difference', 'customer found a lower price, adjusting'] },
  { k: 'late_delivery',    share: [.05, .15], texts: ['delivered late, goodwill refund', 'sla breach on delivery, partial refund'] },
];

function stream() {
  const host = $('[data-stream]'), rows = $('[data-stream-rows]'), tally = $('[data-stream-tally]');
  const THRESH = REPORT.threshold, MAX = 8;

  // mulberry32, seeded with the corpus seed
  let seed = 7;
  const rnd = () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const pick = a => a[(rnd() * a.length) | 0];

  // A faithful port of corpus.generate(): a payment carries 1-3 distinct obligations
  // whose amounts are drawn to fit inside it, and 12% of intents re-decide one that
  // has already been acted on -- paraphrased, never copied. The duplicate is the
  // thing that trips either the invariant or the model, which is the entire point.
  let minted = 0;
  const mint = () => {
    const amount = pick([49900, 129900, 249900, 500000, 1250000]);
    const kinds = [], n = pick([1, 1, 2, 2, 3]);
    while (kinds.length < n) { const k = pick(KINDS); if (!kinds.includes(k)) kinds.push(k); }
    let shares = kinds.map(k => k.share[0] + rnd() * (k.share[1] - k.share[0]));
    const sum = shares.reduce((a, b) => a + b, 0), cap = .45 + rnd() * .53;
    // Obligations fit inside the payment, and usually leave headroom. That headroom is
    // what makes the duplicate interesting: with none, every re-decision is caught by
    // arithmetic and the model never gets asked. With some, the model has to earn it.
    if (sum > cap) shares = shares.map(v => v * cap / sum);
    return {
      id: 'pay_' + (10237 + (minted++ * 613) % 8900),
      amount, captured: rnd() > .04, exposure: 0, done: [],
      queue: kinds.map((k, i) => ({ kind: k, amount: Math.max(100, Math.round(amount * shares[i] / 100) * 100) })),
    };
  };
  const pays = Array.from({ length: 9 }, mint);

  const count = { ALLOW: 0, ESCALATE: 0, DENY: 0 };

  const decide = () => {
    let idx = (rnd() * pays.length) | 0, p = pays[idx];
    // The duplicate rate is the report's stated 12%, applied where a duplicate is even
    // possible (ADR-014). Everything else takes the next obligation the merchant owes;
    // a payment with nothing left retires and a fresh one takes its slot.
    const dup = p.done.length > 0 && rnd() < REPORT.duplicate_rate_assumption;
    if (!dup && !p.queue.length) { pays[idx] = mint(); p = pays[idx]; }
    const ob = dup ? pick(p.done) : p.queue.shift();
    const risk = p.done.length === 0 ? null : dup ? .58 + rnd() * .41 : rnd() * .44;

    let v;
    if (!p.captured) v = 'DENY';                              // 1. accounting invariant
    else if (p.exposure + ob.amount > p.amount) v = 'DENY';   // 1. accounting invariant
    else if (rnd() < .05) v = 'ESCALATE';                     // 3. truth confidence UNKNOWN
    else if (risk !== null && risk >= THRESH) v = 'ESCALATE'; // 4. duplicate risk, escalate only
    else { v = 'ALLOW'; p.exposure += ob.amount; p.done.push(ob); }

    if (!p.captured) pays[idx] = mint();   // nobody keeps refunding an uncaptured payment

    return {
      id: p.id,
      what: inr(ob.amount / 100) + ' \u00b7 \u201C' + pick(ob.kind.texts) + '\u201D',
      risk, v, ms: (1 + Math.floor(rnd() * 3)) + ' ms',
    };
  };

  const paint = () => {
    tally.innerHTML = `<div><dt>allowed</dt><dd data-steel>${count.ALLOW}</dd></div>
      <div><dt>escalated</dt><dd data-amber>${count.ESCALATE}</dd></div>
      <div><dt>denied</dt><dd data-oxide>${count.DENY}</dd></div>
      <div><dt>decided in this replay</dt><dd>${count.ALLOW + count.ESCALATE + count.DENY}</dd></div>`;
  };

  const add = (instant) => {
    const d = decide();
    const li = document.createElement('li');
    li.innerHTML = `${instant ? '' : '<i class="s__scan"></i>'}
      <span class="s__id mono">${d.id}</span>
      <span class="s__what">${d.what}</span>
      <span class="s__risk mono">${d.risk === null ? '—' : d.risk.toFixed(2)}</span>
      <span class="s__v mono">${instant ? d.v : 'deciding'}</span>
      <span class="s__ms mono">${instant ? d.ms : ''}</span>`;
    rows.prepend(li);
    while (rows.children.length > MAX) rows.lastElementChild.remove();

    const land = () => {
      li.dataset.v = d.v;
      li.querySelector('.s__scan')?.remove();
      li.querySelector('.s__v').textContent = d.v;
      li.querySelector('.s__ms').textContent = d.ms;
      count[d.v]++; paint();
    };
    if (instant) { li.dataset.v = d.v; count[d.v]++; paint(); }
    else setTimeout(land, 340);
  };

  // Warm the population first: with nothing open, no intent can be a duplicate, so
  // a cold stream is a wall of ALLOWs that misrepresents the system. The replay
  // joins a merchant already mid-day, which is the only honest steady state.
  for (let i = 0; i < 18; i++) decide();
  count.ALLOW = count.ESCALATE = count.DENY = 0;   // the tally counts what you can see

  // A still page gets a still stream, so the eight visible rows are just the tail of
  // a longer run and the tally carries the actual mix. Picking eight rows that happen
  // to contain one of each would be a nicer screenshot and a worse claim.
  if (still.matches) {
    for (let i = 0; i < 52; i++) { const d = decide(); count[d.v]++; }
    for (let i = 0; i < MAX; i++) add(true);
    return;
  }

  let timer = 0;
  new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && !timer) { add(); timer = setInterval(add, 700); }
    else if (!e.isIntersecting && timer) { clearInterval(timer); timer = 0; }
  }), { rootMargin: '0px 0px -10% 0px' }).observe(host);
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
const countTo = (el, to, fmt, ms = 950) => {
  if (still.matches) return void (el.textContent = fmt(to));
  const start = performance.now();
  const step = now => {
    const k = clamp((now - start) / ms);
    el.textContent = fmt(to * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

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

  // only the payoff column counts. Four counters per row would be a slot machine.
  new IntersectionObserver((es, io) => es.forEach(e => {
    if (!e.isIntersecting) return;
    io.disconnect();
    $$('td:last-child', tb).forEach((td, i) => countTo(td, REPORT.results[i].leaked_minor / 100, inr));
  }), { rootMargin: '0px 0px -20% 0px' }).observe(tb);

  const btns = $('[data-sweep-btns]'), out = $('[data-sweep-out]');
  const show = i => {
    const s = REPORT.budget_sweep[i];
    out.innerHTML = `
      <div><dt>escalated</dt><dd></dd></div>
      <div><dt>recall</dt><dd></dd></div>
      <div><dt>precision</dt><dd></dd></div>
      <div><dt>still leaked</dt><dd></dd></div>`;
    const dd = $$('dd', out);
    countTo(dd[0], s.escalated, pct);
    countTo(dd[1], s.recall, v => v.toFixed(3));
    countTo(dd[2], s.precision, v => v.toFixed(3));
    countTo(dd[3], s.leaked_minor / 100, inr);
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
spine(); reveals(); hero(); planes(); stage();
authority(); stream(); expectedLoss(); evidence(); proof();
