'use client';

/* An inline word with its plain-English meaning one tap away.
 *
 * The page cannot avoid its own vocabulary -- "mandate", "webhook", "idempotency key"
 * are the words the code uses, and renaming them for the reader would leave the site
 * describing a system nobody could then go and find. So the terms stay, and every one
 * of them can explain itself.
 *
 * It is the native popover, not a hover tooltip: hover excludes touch, and a
 * positioned tooltip inside this page's several `overflow: hidden` scenes gets
 * clipped. The browser handles Esc, click-outside and the top layer, so this
 * component is a button, a card, and no JavaScript at all.
 */

import { useId } from 'react';
import { GLOSSARY, type TermKey } from '@/lib/glossary';

export function Term({ k, children }: { k: TermKey; children?: React.ReactNode }) {
  // useId's colons are legal in an id but not in a CSS selector, and the popover
  // machinery is fine either way -- they are stripped so devtools stays usable.
  const id = `term-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const g = GLOSSARY[k];

  return (
    <>
      <button type="button" className="term" popoverTarget={id}
              aria-label={`${g.t} — what this means`}>
        {children ?? g.t}
      </button>
      <span className="term__pop" id={id} popover="auto">
        <b>{g.t}</b>
        {g.d}
      </span>
    </>
  );
}
