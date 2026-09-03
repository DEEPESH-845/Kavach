/* LIGHT SPEED — the effect table.
 *
 * The source component resolved `{ ...lightSpeedPresets[preset], speedUp, fov }` and handed
 * the result to the renderer as `effectOptions`. That shape survives here verbatim; what
 * changed is that a preset no longer carries `speedUp` or `fov`, because the source always
 * overrode both from props and a field that is unconditionally overwritten is not a setting.
 *
 * Colours are written as `var(--token)` and resolved against the live stylesheet at mount,
 * so the field inherits the page's palette rather than carrying a second one. Nothing here
 * is a literal hex.
 */

export type LightSpeedPreset = 'one' | 'two' | 'three' | 'four' | 'five' | 'six';

/** `[css colour, share]`. Shares are normalised, so they need not sum to one. */
export type LightSpeedColor = readonly [string, number];

export interface LightSpeedOptions {
  /** streak count on a 1440 × 640 field; every other size scales by area, then clamps */
  density: number;
  /** world units per second the field travels toward the viewer */
  speed: number;
  /** world length of one streak at rest — `drive` stretches it from here */
  length: number;
  /** stroke width in px at the near plane */
  thickness: number;
  /** near and far clip, in world units. A streak lives between them and respawns. */
  near: number;
  far: number;
  colors: readonly LightSpeedColor[];
  /** vanishing point, normalised. Overridable per element with `--ls-ox` / `--ls-oy`. */
  origin: readonly [number, number];
  /** how far the pointer may pull the vanishing point, as a share of the field */
  parallax: number;
}

/** Everything the renderer reads. `speedUp` and `fov` arrive as props, as in the source. */
export type LightSpeedEffect = LightSpeedOptions & { speedUp: number; fov: number };

export const lightSpeedPresets: Record<LightSpeedPreset, LightSpeedOptions> = {
  /** the one this site uses: long, sparse, mostly unlit — a field, not a firework */
  one:   { density: 265, speed: 3.4, length: 1.15, thickness: 1.15, near: 1, far: 15,
           origin: [0.5, 0.5], parallax: 0.05,
           colors: [['var(--fog2)', 0.72], ['var(--bone)', 0.28]] },
  /** dense and quick */
  two:   { density: 420, speed: 5.2, length: 0.7, thickness: 1, near: 1, far: 13,
           origin: [0.5, 0.5], parallax: 0.06,
           colors: [['var(--fog2)', 0.6], ['var(--bone)', 0.4]] },
  /** atmospheric: almost still, very long trails */
  three: { density: 120, speed: 1.9, length: 1.6, thickness: 0.9, near: 1, far: 18,
           origin: [0.5, 0.5], parallax: 0.04,
           colors: [['var(--seam2)', 0.55], ['var(--fog2)', 0.45]] },
  /** hard and short — the closest thing here to a jump */
  four:  { density: 300, speed: 7.4, length: 0.42, thickness: 1.6, near: 1, far: 11,
           origin: [0.5, 0.5], parallax: 0.08,
           colors: [['var(--bone)', 0.7], ['var(--steel)', 0.3]] },
  /** wide field, steel-dominant */
  five:  { density: 240, speed: 3.9, length: 1.05, thickness: 1.1, near: 1, far: 16,
           origin: [0.5, 0.5], parallax: 0.05,
           colors: [['var(--steel)', 0.62], ['var(--fog2)', 0.38]] },
  /** a tight tunnel with an advisory minority in it */
  six:   { density: 260, speed: 4.4, length: 0.8, thickness: 1.2, near: 1, far: 12,
           origin: [0.5, 0.5], parallax: 0.05,
           colors: [['var(--fog2)', 0.78], ['var(--amber)', 0.22]] },
};
