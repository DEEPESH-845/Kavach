/* The page's table of contents, in one place.

   It is the source for three things that used to disagree: the order the sections
   are rendered in, the "06 / 10" readout in the header, and the jump list. A chapter
   is a destination — a place the reader can be sent and arrive somewhere coherent.

   Beats are not chapters. THE STAGE runs three beats (pressure, refusal, the fix)
   inside chapter 03 and writes the live one into `data-beat`; the header shows that
   name against chapter 03's number, because scrolling into the middle of a pinned
   section is not arriving anywhere new. */

export type Chapter = { id: string; n: string; name: string };

export const CHAPTERS: Chapter[] = [
  { id: 'counter',    n: '01', name: 'THE COUNTER' },
  { id: 'divergence', n: '02', name: 'INTENT' },
  { id: 'stage',      n: '03', name: 'PRESSURE' },
  { id: 'gradient',   n: '04', name: 'THE GRADIENT' },
  { id: 'governor',   n: '05', name: 'GOVERNOR' },
  { id: 'execution',  n: '06', name: 'EXECUTION' },
  { id: 'distance',   n: '07', name: 'THE DISTANCE' },
  { id: 'reconcile',  n: '08', name: 'RECONCILIATION' },
  { id: 'evidence',   n: '09', name: 'EVIDENCE' },
  { id: 'proof',      n: '10', name: 'PROOF' },
  { id: 'enter',      n: '11', name: 'ENTER' },
];

export const LAST = CHAPTERS[CHAPTERS.length - 1].n;
