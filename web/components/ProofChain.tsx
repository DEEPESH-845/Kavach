'use client';

import gsap from 'gsap';
import { useScene } from '@/lib/useScene';
import { CHAIN, CLAIMS } from '@/lib/data';

/* The payoff, and the only element on the page that is about the page.
 *
 * Every chapter above left something behind in one append-only log. This walks that
 * spine end to end and lights each node as the reader passes it, which is the same
 * gesture the fixed spine in the left gutter has been making since the first screen —
 * at section scale, with the artefacts named.
 *
 * PROGRESSION, not accumulation: the rail draws forward with scroll and the nodes
 * light in order, so scrolling back un-draws it. A chain that only ever grew would be
 * making a claim the code does not make.
 *
 * The limit is rendered with the same weight as the claim. `proof.claims()` ships its
 * own caveat with every API response for exactly this reason, and a page that quoted
 * the proof without the caveat would be overstating it by omission.
 */

export function ProofChain() {
  const ref = useScene<HTMLElement>((q, root) => {
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: root, start: 'top 76%', end: 'bottom 62%',
        scrub: 0.6, invalidateOnRefresh: true,
      },
    });

    // the rail draws first and the nodes light behind its head, so the line is always
    // the thing arriving and the node is always the thing it reached
    tl.fromTo(q('.pc__rail-lit'), { scaleY: 0 }, { scaleY: 1, duration: 1 }, 0);
    q('.pc__node').forEach((n, i) => {
      tl.fromTo(n.querySelector('.pc__dot'), { scale: 0.5, opacity: 0.25 },
        { scale: 1, opacity: 1, duration: 0.06 }, i * 0.108);
      tl.fromTo(n.querySelector('.pc__body'), { opacity: 0.16, y: 6 },
        { opacity: 1, y: 0, duration: 0.07 }, i * 0.108);
    });
  });

  return (
    <figure className="pc" ref={ref as React.Ref<HTMLElement>}>
      <figcaption className="eyebrow">what each chapter left in the log</figcaption>

      <div className="pc__track">
        <div className="pc__rail" aria-hidden><i className="pc__rail-lit" /></div>
        <ol className="pc__nodes">
          {CHAIN.map((c) => (
            <li className="pc__node" key={c.t} data-end={c.end || undefined}>
              <i className="pc__dot" aria-hidden />
              <div className="pc__body">
                <span className="pc__t mono">{c.t}</span>
                <span className="pc__d">{c.d}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="pc__note">
        The head is recomputed in the console rather than printed here. A hash typed into a
        static page proves nothing about the log it claims to cover.
      </p>

      <dl className="pc__claims">
        <div><dt>proves</dt><dd>{CLAIMS.proves}</dd></div>
        <div><dt>does not prove</dt><dd>{CLAIMS.does_not_prove}</dd></div>
        <div data-limit><dt>limit</dt><dd>{CLAIMS.limit}</dd></div>
      </dl>
    </figure>
  );
}
