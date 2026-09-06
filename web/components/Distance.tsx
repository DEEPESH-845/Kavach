'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { useScene } from '@/lib/useScene';
import { Kinetic } from '@/components/Kinetic';

gsap.registerPlugin(MotionPathPlugin);

/* CHAPTER 07 — the trust boundary, drawn on the ground it actually crosses.
 *
 * Chapter 06 renders the boundary as a hairline between two columns and names three things
 * on the far side of it as `not observable`. That list is a geography, and until this
 * chapter existed the page asked the reader to take its size on trust: a one-pixel rule
 * between KAVACH and RAZORPAY, and a promise that something large sat behind it.
 *
 * So the page opens up exactly once, here, and draws it. One lit thread — our request out
 * and the signed answer back, the whole of what our log contains — against five that leave
 * the same point and dissolve before they arrive. The reader is not told the ratio; they
 * see it, and the next chapter then has an obvious reason to go and look.
 *
 * WHY THE DESTINATIONS ARE NOT LABELLED. Naming them would assert a route. Nothing in the
 * event log names one — `truth.py` returns AMBIGUOUS for exactly these conditions rather
 * than inventing a value — so the drawing refuses in the same way the code does. Five
 * unlabelled endpoints, one per continent, and no line reaching any of them.
 *
 * WHAT IS DRAWN, AND HOW.
 *   · The land is a static dot grid in public/world.svg, applied as a CSS mask, so it costs
 *     one cached request, one DOM node and zero JavaScript. web/scripts/world-map.mjs
 *     regenerated it; nothing in the bundle depends on that script or on a map library.
 *   · The dot is a SQUARE. Nothing else on this page is round, and the grid is the hero's
 *     ambient field at planetary scale rather than a new object.
 *   · Coordinates below are the generator's projection of real lat/lng, baked in, so the
 *     page ships no projection code. They live here rather than in lib/data.ts because
 *     that file is the page's asserted constants and these are explicitly illustrative —
 *     mixing the two would blunt what tests/test_site.py guards.
 *
 * WHAT MOVES, AND WHY IT STOPS. Six marks fly the routes as the chapter scrolls: one out
 * to the rail and one signed back, and five that leave Mumbai and dissolve in open water.
 * The five DO NOT ARRIVE, and that is not a shortcut — a mark that lands on an unlabelled
 * node would assert the delivery this whole chapter exists to say we cannot observe. The
 * eye is allowed to follow the money exactly as far as the log does, and no further.
 *
 * Everything is scrubbed against the section's own passage rather than played once on
 * entry. The drawing is an argument about distance, and letting the reader control the
 * rate at which it is made means they can stop on the frame where our leg has landed and
 * the other five are still in the air.
 *
 * Strokes are `non-scaling-stroke`, node size and label size are CSS custom properties in
 * user units, so one media query re-composes the whole drawing for a phone rather than
 * shrinking it.
 */

/** The generator's projection, viewBox `10 1 116 57`. See scripts/world-map.mjs. */
const AT = {
  kavach:    [93.5, 34.64],   // Bengaluru — the merchant's side of the boundary
  rail:      [92.0, 32.04],   // Mumbai — the acquiring rail, and the last signed position
  london:    [65.5, 17.32],
  newYork:   [39.0, 23.38],
  bogota:    [38.5, 38.11],
  nairobi:   [78.5, 39.84],
  singapore: [103.0, 38.97],
} as const;

/** One issuing bank per continent. Illustrative, and the copy says so. */
const DARK = [AT.london, AT.newYork, AT.bogota, AT.nairobi, AT.singapore];

/** A quadratic arc lifted perpendicular to its own chord, so long legs bow more than
 *  short ones and the fan reads as distance rather than as decoration. */
const arc = ([x1, y1]: readonly number[], [x2, y2]: readonly number[], k = 0.3) => {
  const lift = Math.hypot(x2 - x1, y2 - y1) * k;
  return `M${x1} ${y1}Q${(x1 + x2) / 2} ${(y1 + y2) / 2 - lift} ${x2} ${y2}`;
};

/** The travelling mark. Two nested groups on purpose: GSAP writes the motion-path
 *  transform onto the outer one, and the inner one carries the CSS `scale(var(--dist-node))`
 *  that keeps every mark on this map the same size at every width. One element cannot hold
 *  both — the stylesheet would overwrite the tween on the next paint. */
function Flight({ k, i }: { k: 'sure' | 'dark'; i?: number }) {
  return (
    <g className={`dist__flight dist__flight--${k}`} data-i={i}>
      <g className="dist__flight-m">
        <rect x="-0.5" y="-0.7" width="1" height="1.4" />
      </g>
    </g>
  );
}

function Node({ at, k, i }: { at: readonly number[]; k: 'sure' | 'dark' | 'us'; i?: number }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      {/* the split cell at its smallest: 1 × 1.4, the proportion the nav mark and the
          spine head already use, so the marks on the map are the page's own mark */}
      <g className="dist__node" data-k={k} data-i={i}>
        <rect x="-0.5" y="-0.7" width="1" height="1.4" />
      </g>
    </g>
  );
}

/** The marks stay the same SIZE at every width, while the drawing they sit on scales.
 *
 *  Node and label geometry live in the SVG's user units, so anything authored as a
 *  constant there is 5px on a phone and 15px on a 4K display — which is how the first
 *  pass shipped a tablet with 20px labels. The alternative was a ladder of breakpoints
 *  guessing at a scale that varies continuously, so this measures the one number the
 *  guessing was for. `slice` scales to cover, so the live scale is whichever axis binds.
 *
 *  One observer on one element, and it writes two custom properties — no re-render, no
 *  scroll listener, and the CSS defaults are already right for a wide screen, so the
 *  prerendered frame is correct before this ever runs. */
function useMarkScale() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const { width, height } = el.getBoundingClientRect();
      const k = Math.max(width / 116, height / 57);
      if (!k) return;
      el.style.setProperty('--dist-node', String(7 / k));
      el.style.setProperty('--dist-label', `${10 / k}px`);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

export function Distance() {
  const svg = useMarkScale();
  const ref = useScene<HTMLElement>((q, root) => {
    // measured, not guessed: the arcs are authored in user units and the dash has to be
    // the path's own length or the draw starts part-way through
    (q('.dist__leg') as unknown as SVGPathElement[]).forEach((path) => {
      const len = path.getTotalLength();
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
    });
    gsap.set(q('.dist__node'), { opacity: 0 });   // set-then-tween; see lib/scroll.ts

    const darkLegs = q('.dist__leg--dark') as unknown as SVGPathElement[];

    /* SCRUBBED, not played, and it ENDS EARLY. `bottom 80%` means the last thread has
       dissolved while the section's bottom edge is still four fifths of the way down the
       viewport — the whole drawing on screen, the reader still in front of it. Running to
       `bottom 42%` completed the reveal with the map half gone past the top, which is a
       reveal nobody watched. */
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: root, start: 'top 85%', end: 'bottom 80%',
        scrub: 0.6, invalidateOnRefresh: true,
      },
    });

    // the ground arrives first and stays quiet: it is the room, not an event
    tl.from(q('.dist__world'), { opacity: 0, duration: 0.22, ease: 'power2.out' }, 0)
      .from(q('.dist__label'), { opacity: 0, duration: 0.08 }, 0.14)
      .to(q('.dist__node[data-k="us"], .dist__node[data-k="sure"]'),
        { opacity: 1, duration: 0.07 }, 0.16);

    /* OUR LEG, BOTH WAYS. The request goes out, a mark rides it, and the signed answer
       comes back along the returning arc — a closed circuit, which is the entire content
       of `seq 17`. The eases are the motion semantics lib/motion.ts names in
       cubic-beziers, in the string form GSAP takes: certainty arrives hard and halts. */
    tl.to(q('.dist__leg--out'), { strokeDashoffset: 0, duration: 0.13, ease: 'power3.out' }, 0.20)
      .to(q('.dist__flight--sure[data-i="0"]'), { opacity: 1, duration: 0.02 }, 0.20)
      .to(q('.dist__flight--sure[data-i="0"]'), {
        duration: 0.13, ease: 'power3.out',
        motionPath: { path: '.dist__leg--out', align: '.dist__leg--out',
                      alignOrigin: [0.5, 0.5], autoRotate: 90 },
      }, 0.20)
      .to(q('.dist__flight--sure[data-i="0"]'), { opacity: 0, duration: 0.02 }, 0.33)
      .to(q('.dist__leg--back'), { strokeDashoffset: 0, duration: 0.13, ease: 'power3.out' }, 0.34)
      .to(q('.dist__flight--sure[data-i="1"]'), { opacity: 1, duration: 0.02 }, 0.34)
      .to(q('.dist__flight--sure[data-i="1"]'), {
        duration: 0.13, ease: 'power3.out',
        // start 1 -> end 0: the arc is authored outward, and this is the answer coming home
        motionPath: { path: '.dist__leg--back', align: '.dist__leg--back', start: 1, end: 0,
                      alignOrigin: [0.5, 0.5], autoRotate: 90 },
      }, 0.34)
      .to(q('.dist__flight--sure[data-i="1"]'), { opacity: 0, duration: 0.02 }, 0.47);

    /* AND THE FIVE THAT DO NOT LAND. Each mark leaves the rail on its own thread and is
       gone by 0.74 of the way along it — inside the stretch where the stroke's own
       gradient has already run out, so the mark and the line it rides fail together. The
       stagger is wide enough that they read as five departures rather than one burst. */
    darkLegs.forEach((leg, i) => {
      const at = 0.46 + i * 0.058;
      const mark = q(`.dist__flight--dark[data-i="${i}"]`);
      tl.to(leg, { strokeDashoffset: 0, duration: 0.28, ease: 'power1.out' }, at)
        .fromTo(mark, { opacity: 0 }, { opacity: 1, duration: 0.05 }, at)
        .to(mark, {
          duration: 0.3, ease: 'power1.out',
          motionPath: { path: leg, align: leg,
                        start: 0, end: 0.74, alignOrigin: [0.5, 0.5], autoRotate: 90 },
        }, at)
        .to(mark, { opacity: 0, duration: 0.14 }, at + 0.16)
        .to(q(`.dist__node[data-k="dark"][data-i="${i}"]`),
          { opacity: 1, duration: 0.12 }, at + 0.22);
    });
  });

  return (
    <section className="sec dist" id="distance" ref={ref}>
      <div className="dist__stage">
        <div className="dist__body">
          <div className="wrap">
            <div className="dist__copy">
              <p className="eyebrow">07 — the other side of the boundary</p>
              <Kinetic text="The only leg we can prove is *the short one.*" />
              <p className="body body--tight">
                One hop is ours: our request to Razorpay and its signed reply, both written into
                our own log. Everything after that belongs to banks and clearing systems we have
                no connection to, running on a schedule nobody tells us. The five threads on this
                map are where your ₹5,000 might currently be. Kavach will not pick one and call
                it the answer — it says{' '}
                <span className="mono" data-amber>AMBIGUOUS</span>, out loud, and refuses to
                guess.
              </p>

              <dl className="dist__key">
                <div data-k="sure">
                  <dt>we can see this</dt>
                  <dd><span className="dist__n">1</span> leg · signed at both ends</dd>
                </div>
                <div data-k="dark">
                  <dt>we cannot see these</dt>
                  <dd><span className="dist__n">5</span> legs · nothing reports on them</dd>
                </div>
              </dl>

              <p className="assume">
                One bank on each of five continents, drawn to show the proportion rather than a
                real route — nothing in our log names a destination, so nothing here does either.
                An agent that reads <span className="mono">processed</span> as{' '}
                <em>the customer has the money</em> has just described all five of those unlit
                threads as if they were the one lit one.
              </p>
            </div>
          </div>
        </div>

        {/* aria-hidden: the <dl> above states everything the drawing states, and a screen
            reader is owed the fact, not the fan. */}
        <div className="dist__canvas" aria-hidden>
          <div className="dist__world" />
          <svg className="dist__legs" ref={svg}
               viewBox="10 1 116 57" preserveAspectRatio="xMidYMid slice">
            <defs>
              {DARK.map((to, i) => (
                <linearGradient key={i} id={`dist-fade-${i}`} gradientUnits="userSpaceOnUse"
                                x1={AT.rail[0]} y1={AT.rail[1]} x2={to[0]} y2={to[1]}>
                  {/* stop-color is a CSS property, so the token is applied in the
                      stylesheet; a var() in the attribute would not resolve. */}
                  <stop offset="0" stopOpacity="1" />
                  <stop offset="0.52" stopOpacity="0.82" />
                  <stop offset="0.86" stopOpacity="0.3" />
                  <stop offset="1" stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>

            {DARK.map((to, i) => (
              <path key={i} className="dist__leg dist__leg--dark" d={arc(AT.rail, to)}
                    stroke={`url(#dist-fade-${i})`} />
            ))}

            {/* The whole of what we can prove, and it is CLOSED: out along one arc and
                signed back along the other, ~3 units wide on a 116-unit map. Five open
                threads beside one closed circuit is the chapter's entire argument, and the
                disproportion is the reason it needs the whole viewport to be visible in. */}
            <path className="dist__leg dist__leg--sure dist__leg--out"
                  d={arc(AT.kavach, AT.rail, 0.35)} />
            <path className="dist__leg dist__leg--sure dist__leg--back"
                  d={arc(AT.kavach, AT.rail, -0.35)} />

            {DARK.map((to, i) => <Node key={i} at={to} k="dark" i={i} />)}
            <Node at={AT.rail} k="sure" />
            <Node at={AT.kavach} k="us" />

            {/* drawn last, so a mark in flight is never behind the ground it crosses */}
            <Flight k="sure" i={0} />
            <Flight k="sure" i={1} />
            {DARK.map((_, i) => <Flight key={i} k="dark" i={i} />)}

            {/* Both labels run EAST, stacked. They used to straddle the pair — one up-left
                into the fan, one down-right — which put RAZORPAY on top of the five threads
                at exactly the moment they leave it, and left the two words 2.6 units apart
                on a map where the mark is 0.46. The fan is westward, so east is the only
                quiet direction on this part of the drawing. */}
            <text className="dist__label" x={AT.rail[0] + 1.9} y={AT.rail[1] - 1.5}>RAZORPAY</text>
            <text className="dist__label" data-k="us"
                  x={AT.kavach[0] + 1.9} y={AT.kavach[1] + 2.1}>KAVACH</text>
          </svg>
        </div>
      </div>
    </section>
  );
}
