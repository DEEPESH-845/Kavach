'use client';

import { useCallback, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useScene } from '@/lib/useScene';
import { Kinetic } from '@/components/Kinetic';
import { LightSpeed } from '@/components/ui/light-speed/LightSpeed';
import type { LightSpeedOptions } from '@/components/ui/light-speed/presets';
import { REPORT } from '@/lib/data';
import { rise } from '@/lib/scroll';

/* THE SEAM BETWEEN 08 AND 09 — where the page changes time-base.
 *
 * Everything before this has followed ONE ₹5,000 refund against pay_Nx3f9K2, one event at a
 * time, at reading speed. Chapter 09 is the same decision measured over 925 held-out
 * intents. Those are two different clocks, and until now the page crossed between them with
 * a paragraph break — the reader was asked to accept a change of scale that nothing showed
 * them. This is that change, drawn.
 *
 * It is deliberately NOT a chapter. It has no number, it is not in lib/chapters.ts and the
 * jump list does not offer it, because it is not a destination: nothing is stated here that
 * is not stated in the chapters on either side of it. A reader who lands in the middle of it
 * has not arrived anywhere, and the header keeps saying 08 until 09 begins.
 *
 * THE COLOUR IS THE ARGUMENT. Most streaks are --fog2: ordinary work. A --bone minority is
 * what a person actually reads. The oxide share is REPORT.duplicate_rate_assumption — the
 * 12% base rate chapter 09 then defends in prose — so the density of the losses in the field
 * cannot drift from the number the benchmark assumes. It is not a palette, it is the data.
 *
 * Everything the section says is in the DOM above and below the canvas. The canvas states
 * nothing; remove it and the two sentences still carry the transition.
 */

const DUP = REPORT.duplicate_rate_assumption;

const FIELD: Partial<LightSpeedOptions> = {
  colors: [
    ['var(--fog2)', 1 - DUP - 0.19],
    ['var(--bone)', 0.19],
    ['var(--oxide)', DUP],
  ],
};

export function Velocity() {
  /* Read once per animation frame by the canvas, written once per scroll frame by
     ScrollTrigger. Never rendered, so it never renders. */
  const drive = useRef(0);
  const getDrive = useCallback(() => drive.current, []);

  const ref = useScene<HTMLElement>((q, root) => {
    /* ENTRANCE, PEAK, EXIT — bounded, and not a raw scroll mapping. The field accelerates
       across the first half of its own passage and eases back over the second, so it has
       somewhere to be going and somewhere to have arrived. It leaves at 0.35 rather than 0
       because chapter 09 should feel entered, not braked into. */
    ScrollTrigger.create({
      trigger: root, start: 'top bottom', end: 'bottom top',
      onUpdate: (self) => {
        const p = self.progress;
        drive.current = p < 0.5 ? p * 2 : 1 - (p - 0.5) * 1.3;
      },
    });
    rise(q('.vel__brow, .vel__foot'), { trigger: root, start: 'top 74%', stagger: 0.12 });
  });

  /* The copy is FIRST in the DOM and the field second, which is the order a phone
     stacks them in and the order they should be read in. On a wide screen the field is
     taken out of flow and sits behind, so source order costs nothing there. */
  return (
    <section className="vel" id="velocity" ref={ref}>
      <div className="wrap vel__copy">
        <p className="eyebrow vel__brow">one intent, read end to end</p>
        <Kinetic text="The next *nine hundred and twenty-five* do not get read." />
        <p className="body body--tight vel__foot">
          {(DUP * 100).toFixed(0)}% of them carry an obligation that is already owed. The rest
          are ordinary work, and a system that stops those has not helped anyone.
        </p>
      </div>

      <div className="vel__field" aria-hidden>
        <LightSpeed preset="one" speedUp={2.4} fov={76} options={FIELD} drive={getDrive} />
      </div>
    </section>
  );
}
