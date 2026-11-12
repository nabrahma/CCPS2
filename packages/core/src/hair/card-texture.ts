/**
 * Hair card textures, generated.
 *
 * This is the "Haircard texture creation" scene of Daniel Bystedt's setup
 * (docs/hair-system.md) done in 2D: for every strip of the atlas, strands are
 * interpolated across the strip, clumped onto a few guide strands, frizzed and
 * trimmed to ragged lengths, exactly the node stack of its "Hair for
 * haircards" group. Where the scene renders passes and composites them, the
 * strands are drawn straight into one colour + alpha image:
 *
 *   alpha pass       -> coverage of the drawn strands
 *   "random" pass    -> a shade of its own per strand
 *   "intercept" pass -> the root-to-tip colour ramp
 *   AO pass          -> strands underneath are darker
 *   specular pass    -> a soft highlight band, at its own height on each strand
 *   compositing      -> colour bled into the transparent texels, so filtering
 *                       and mipmaps never pull in a dark fringe
 *
 * PS2-era hair has no normal or specular maps (PRD 1), so everything lands in
 * the diffuse texture. Deterministic for a seed.
 */
import { Rng } from '../random';
import { createImage, type RgbaImage } from '../skin/image';
import type { AtlasRegion, AtlasTag } from './atlas';
import { shapeRange } from './curves';

type Rgb = [number, number, number];

export interface CardStripParams {
  tag: AtlasTag;
  /** Strands drawn in the strip (the density of "Interpolate Hair Curves"). */
  strands: number;
  /** Guide strands the others clump onto. */
  clumps: number;
  /** 0..1 pull onto the guide ("Clump Hair Curves" factor). */
  clump: number;
  /** Sideways waviness as a fraction of the strip's width ("Hair Curves Noise"). */
  frizz: number;
  /** 0..1 how much shorter a strand may be cut ("Trim Hair Curves" random offset). */
  ragged: number;
  /** 0..1 narrowing of the whole lock towards the tip. */
  taper: number;
  /** A solid layer under the strands, for the strips that must hide the scalp. */
  solid?: boolean;
}

export interface CardTextureParams {
  seed: number;
  /** Image size in pixels. */
  size: number;
  strips: CardStripParams[];
  /** Strand thickness in pixels at a size of 1024. */
  strandWidth: number;
  /** Colour at the root, the middle and the tip (sRGB 0..255). */
  root: Rgb;
  mid: Rgb;
  tip: Rgb;
  /** 0..1 how much strands differ in shade. */
  variation: number;
  /** 0..1 strength of the highlight band. */
  highlight: number;
}

/** Eight strips: two of each kind a style asks for, a dense one for the layer on the scalp, and one for a fringe. */
export const DEFAULT_CARD_STRIPS: CardStripParams[] = [
  { tag: 'clump', strands: 46, clumps: 5, clump: 0.6, frizz: 0.03, ragged: 0.35, taper: 0.3 },
  { tag: 'clump', strands: 38, clumps: 3, clump: 0.75, frizz: 0.04, ragged: 0.45, taper: 0.4 },
  { tag: 'strand', strands: 30, clumps: 4, clump: 0.5, frizz: 0.04, ragged: 0.5, taper: 0.35 },
  { tag: 'strand', strands: 24, clumps: 3, clump: 0.6, frizz: 0.05, ragged: 0.55, taper: 0.45 },
  { tag: 'base', strands: 90, clumps: 8, clump: 0.25, frizz: 0.02, ragged: 0.15, taper: 0, solid: true },
  { tag: 'fringe', strands: 80, clumps: 5, clump: 0.45, frizz: 0.02, ragged: 0.22, taper: 0.1 },
  { tag: 'flyaway', strands: 9, clumps: 3, clump: 0.35, frizz: 0.09, ragged: 0.6, taper: 0.2 },
  { tag: 'flyaway', strands: 6, clumps: 2, clump: 0.3, frizz: 0.12, ragged: 0.7, taper: 0.1 },
];

export const CARD_TEXTURE_COLOURS: Record<string, { name: string; root: Rgb; mid: Rgb; tip: Rgb }> = {
  brown: { name: 'Brown', root: [62, 39, 26], mid: [96, 62, 41], tip: [122, 84, 57] },
  black: { name: 'Black', root: [18, 17, 20], mid: [34, 32, 38], tip: [54, 51, 60] },
  blonde: { name: 'Blonde', root: [140, 108, 62], mid: [196, 160, 104], tip: [222, 196, 146] },
  auburn: { name: 'Auburn', root: [88, 34, 20], mid: [138, 56, 30], tip: [168, 84, 48] },
  // Neutral, for colouring with the hair tint.
  grey: { name: 'Grey (for tinting)', root: [150, 150, 150], mid: [196, 196, 196], tip: [226, 226, 226] },
};

export function defaultCardTexture(colour: keyof typeof CARD_TEXTURE_COLOURS = 'brown', size = 1024): CardTextureParams {
  const c = CARD_TEXTURE_COLOURS[colour]!;
  return { seed: 1977, size, strips: DEFAULT_CARD_STRIPS, strandWidth: 2.6, root: c.root, mid: c.mid, tip: c.tip, variation: 0.5, highlight: 0.22 };
}

/** Empty margin at each side of a strip, as a fraction of the strip. */
const GUTTER = 0.06;

export function generateCardTexture(params: CardTextureParams): { image: RgbaImage; regions: AtlasRegion[] } {
  const size = Math.max(64, Math.round(params.size));
  const n = params.strips.length;
  if (n === 0) throw new Error('card texture needs at least one strip');
  const image = createImage(size, size, [0, 0, 0, 0]);
  // Colour is composited premultiplied in floats, and written out straight at the end.
  const rgb = new Float32Array(size * size * 3);
  const alpha = new Float32Array(size * size);
  const stamp = new Float32Array(size * size);
  const touched: number[] = [];
  const regions: AtlasRegion[] = [];
  const px = size / 1024;
  // The root colour gives way to the middle colour over the first quarter, then the middle to the tip.
  const ramp = (t: number, k: number) =>
    t < 0.25 ? params.root[k]! + (params.mid[k]! - params.root[k]!) * (t * 4) : params.mid[k]! + (params.tip[k]! - params.mid[k]!) * ((t - 0.25) / 0.75);

  params.strips.forEach((strip, index) => {
    const rng = new Rng((params.seed * 7919 + index * 104729) >>> 0);
    const x0 = Math.round((index * size) / n);
    const x1 = Math.round(((index + 1) * size) / n);
    const w = x1 - x0;
    regions.push({ x: x0 / size, y: 0, w: w / size, h: 1, tag: strip.tag });
    const inner = w * (1 - 2 * GUTTER);
    const toX = (u: number) => x0 + w * GUTTER + inner * u;

    // The solid underlay: full to most of the way down, then a ragged edge.
    if (strip.solid) {
      for (let x = Math.ceil(toX(0)); x < toX(1); x++) {
        const end = size * (0.8 + 0.14 * rng.next());
        for (let y = 0; y < end; y++) {
          const i = y * size + x;
          const t = y / size;
          const a = Math.min(1, (end - y) / (size * 0.05));
          for (let k = 0; k < 3; k++) rgb[i * 3 + k] = ramp(t, k) * 0.7 * a;
          alpha[i] = a;
        }
      }
    }

    // Guide strands, each swaying a little on its own.
    const guides = Array.from({ length: Math.max(1, strip.clumps) }, (_, g) => ({
      x: (g + 0.5 + rng.range(-0.25, 0.25)) / Math.max(1, strip.clumps),
      sway: rng.range(-0.08, 0.08),
      phase: rng.range(0, Math.PI * 2),
    }));
    const guideAt = (g: (typeof guides)[number], t: number) => g.x + g.sway * Math.sin(t * 3.1 + g.phase) * t;

    const strands = Array.from({ length: strip.strands }, (_, s) => {
      const start = (s + rng.next()) / strip.strands;
      let lead = guides[0]!;
      for (const g of guides) if (Math.abs(g.x - start) < Math.abs(lead.x - start)) lead = g;
      return {
        start,
        lead,
        // Most strands run nearly full length; a few are cut much shorter. Over a solid layer they stop
        // short of the end, which is left to fade out (a scalp layer's hairline lies there).
        length: (strip.solid ? 0.93 : 1) * (1 - strip.ragged * rng.next() ** 1.6),
        width: params.strandWidth * px * rng.range(0.7, 1.3),
        shade: 1 + params.variation * rng.range(-0.5, 0.5),
        frizzA: rng.range(-1, 1),
        frizzB: rng.range(-1, 1),
        phase: rng.range(0, Math.PI * 2),
        glint: rng.range(-0.06, 0.06),
        order: rng.next(),
      };
    });
    // Drawn back to front: the ones on top are the brightest (the AO pass).
    strands.sort((a, b) => a.order - b.order);

    strands.forEach((st, rank) => {
      const depth = 0.68 + 0.32 * (rank / Math.max(1, strands.length - 1));
      const steps = Math.ceil(size * st.length * 1.5);
      touched.length = 0;
      for (let k = 0; k <= steps; k++) {
        const t = (k / steps) * st.length;
        const f = t / st.length;
        let u = st.start + strip.frizz * (st.frizzA * Math.sin(t * 9 + st.phase) + st.frizzB * Math.sin(t * 4.3 + st.phase * 1.9)) * Math.min(1, t * 5);
        u += (guideAt(st.lead, t) - u) * strip.clump * shapeRange(t, 0.6);
        u = 0.5 + (u - 0.5) * (1 - strip.taper * t * t);
        const cx = toX(Math.min(1, Math.max(0, u)));
        const cy = t * (size - 1);
        // Thin out and fade over the last part of the strand.
        const tipFade = Math.min(1, (1 - f) / 0.14);
        const r = Math.max(0.5, (st.width / 2) * (0.45 + 0.55 * tipFade));
        const xa = Math.max(x0, Math.floor(cx - r - 1));
        const xb = Math.min(x1 - 1, Math.ceil(cx + r + 1));
        const ya = Math.max(0, Math.floor(cy - r - 1));
        const yb = Math.min(size - 1, Math.ceil(cy + r + 1));
        for (let y = ya; y <= yb; y++) {
          for (let x = xa; x <= xb; x++) {
            const cover = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy))) * (0.25 + 0.75 * tipFade);
            const i = y * size + x;
            if (cover > stamp[i]!) {
              if (stamp[i] === 0) touched.push(i);
              stamp[i] = cover;
            }
          }
        }
      }
      for (const i of touched) {
        const a = stamp[i]!;
        stamp[i] = 0;
        const t = Math.floor(i / size) / size;
        const glint = params.highlight * Math.exp(-(((t - 0.32 - st.glint) / 0.09) ** 2));
        for (let k = 0; k < 3; k++) {
          const c = Math.min(255, ramp(t, k) * st.shade * depth * (1 + glint * 1.6) + glint * 40);
          rgb[i * 3 + k] = c * a + rgb[i * 3 + k]! * (1 - a);
        }
        alpha[i] = a + alpha[i]! * (1 - a);
      }
    });
  });

  // Straight colour out; empty texels take the hair's middle colour, a little darker (the compositing step).
  for (let i = 0; i < size * size; i++) {
    const a = alpha[i]!;
    const stored = Math.round(a * 255);
    for (let k = 0; k < 3; k++) image.data[i * 4 + k] = stored > 0 ? Math.round(Math.min(255, rgb[i * 3 + k]! / a)) : Math.round(params.mid[k]! * 0.8);
    image.data[i * 4 + 3] = stored;
  }
  return { image, regions };
}
