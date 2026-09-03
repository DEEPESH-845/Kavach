import DottedMap from 'dotted-map';
import { writeFileSync } from 'node:fs';

/* One-off generator for public/world.svg — the land grid chapter 07 paints through as a
   CSS mask. Baking it means the site ships no map dependency, no runtime projection and
   no per-dot DOM node: one cached request and one element, instead of ~3,400 of them.

   `dotted-map` is deliberately NOT a dependency of this package. Run it only if the
   framing changes, and keep the numbers in step with Distance.tsx's viewBox:

       npm i --no-save dotted-map && node scripts/world-map.mjs && mv world.svg public/

   getPin({lat, lng}) projects into this same space; that is where the coordinates in
   Distance.tsx came from. */
const VB = { x: 10, y: 1, w: 116, h: 57 };     // the whole map; the section crops it with a soft mask
const S = 0.34;                                // square edge in grid units — the mark, not the pitch
const r = (n) => Math.round(n * 100) / 100;

const map = new DottedMap({
  height: 64, grid: 'diagonal',
  region: { lat: { min: -56, max: 73 }, lng: { min: -180, max: 180 } },
});

const inside = ({ x, y }) =>
  x >= VB.x - 1 && x <= VB.x + VB.w + 1 && y >= VB.y - 1 && y <= VB.y + VB.h + 1;

const d = map.getPoints().filter(inside)
  .map(({ x, y }) => `M${r(x - S / 2)} ${r(y - S / 2)}h${S}v${S}h-${S}z`).join('');

writeFileSync('world.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" fill="#fff">`
  + `<path d="${d}"/></svg>\n`);
console.log('points on land:', d.split('M').length - 1, '· path bytes:', d.length);
