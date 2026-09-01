'use client';

import { Fragment } from 'react';
import gsap from 'gsap';
import { useScene } from '@/lib/useScene';
import { S } from '@/lib/scroll';

/* A heading that arrives a word at a time, from behind its own baseline.

   Words, never characters. Character animation on a sentence turns a claim into an
   effect and costs a node per glyph; the hero settled that argument for the whole
   page and this is the scroll-triggered form of the same reveal, so the two ends of
   the page move the same way.

   Nothing is written into the prerendered HTML: the tween is a `from`, so a reader
   whose bundle never arrives — or who asked for less motion — gets the finished
   heading rather than an empty box.

   `*asterisks*` mark an accent run. */

export function Kinetic(
  { text, className = 'h2', tag = 'h2', accent = 'var(--steel)', start }:
  { text: string; className?: string; tag?: 'h2' | 'h3' | 'p'; accent?: string; start?: string },
) {
  const ref = useScene<HTMLElement>((q, root) => {
    // set-then-tween, not `from`: a staggered `from` leaves every word but the first
    // sitting on the baseline until its own sub-tween starts, and then blinks it away
    gsap.set(q('.kin__w > i'), { yPercent: 108 });
    gsap.to(q('.kin__w > i'), {
      scrollTrigger: { trigger: root, start: start ?? S.enter },
      yPercent: 0, duration: 0.72, stagger: 0.055, ease: 'power3.out',
    });
  });

  /* `*asterisks*` mark an accent RUN, not an accent word: splitting on spaces first
     left "*events" and "it.*" as two words, neither of which begins and ends with a
     star, and printed the punctuation. Split on the marker, then on spaces inside each
     run, so a phrase can be accented and the marker never reaches the page. */
  const words = text.split('*').flatMap((chunk, i) =>
    chunk.split(' ').filter(Boolean).map((w) => ({ w, hot: i % 2 === 1 })));

  const Tag = tag as 'h2';

  return (
    <Tag className={`${className} kin`} ref={ref as React.Ref<HTMLHeadingElement>}>
      {words.map(({ w, hot }, i) => (
        <Fragment key={i}>
          <span className="kin__w">
            <i style={hot ? { color: accent } : undefined}>{w}</i>
          </span>{' '}
        </Fragment>
      ))}
    </Tag>
  );
}
