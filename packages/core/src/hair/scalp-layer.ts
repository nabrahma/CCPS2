/**
 * The scalp layer (PRD F15, layer 1 of Hair v2): short hair painted into the
 * head texture, the way era characters had their hairline and the hair under
 * the cards painted on, so the hair geometry never has to end on bare skin.
 *
 * Drawn per texel of the neutral surface map (hm08 UV space), like the
 * procedural skin layers: it crosses UV seams without a break and stays put
 * when the body morphs. At every texel:
 *
 *  - coverage comes from the hairline: full well inside it, fading smoothly
 *    over a band around it (its width is the style's softness), with a little
 *    low-frequency wander so the line is not a perfect curve. Coverage is the
 *    layer's alpha and never steps by more than a few percent between
 *    neighbouring texels;
 *  - shading is fine streaks along the groom's flow (strands, a fraction of a
 *    millimetre across and a centimetre or so long), in the hair's own
 *    gradient map, so the painted hair matches the cards and locks above it.
 */
import { createImage, type RgbaImage } from '../skin/image';
import type { SurfaceMap } from '../skin/layout';
import { fbm, smoothstep, valueNoise } from '../skin/noise';
import type { ScalpLayerParams } from './style';
import { hairGradient, type HairColour } from './strand-atlas';

type Vec3 = [number, number, number];

export interface ScalpField {
  /** 0 at the crown, 1 on the hairline, more outside it (neutral head). */
  ratio(p: Vec3): number;
  /** Unit direction short hair lies in at p, along the skin with normal n. */
  flow(p: Vec3, n: Vec3): Vec3;
}

/** Hairline fade width (in hairline-ratio units) for a softness of 0 and of 1. */
const FADE_MIN = 0.12;
const FADE_MAX = 0.36;

export function scalpFade(softness: number): number {
  return FADE_MIN + (FADE_MAX - FADE_MIN) * Math.min(1, Math.max(0, softness));
}

/**
 * Coverage at a texel: 1 inside, a smooth fall across the hairline. Exported
 * for tests (the hairline step check) and the hairline painter's preview.
 */
export function scalpCoverage(ratio: number, p: Vec3, softness: number, seed: number): number {
  const fade = scalpFade(softness);
  // Low-frequency wander (about 2 cm features) moves the line by up to a fifth of the fade.
  const wander = (fbm(p[0] / 0.02, p[1] / 0.02, p[2] / 0.02, seed, 2) - 0.5) * fade * 0.4;
  return 1 - smoothstep(1 - fade * 0.75, 1 + fade * 0.25, ratio + wander);
}

export function drawScalpLayer(map: SurfaceMap, field: ScalpField, params: ScalpLayerParams, colour: HairColour, seed: number): RgbaImage {
  const img = createImage(map.size, map.size);
  const gradient = hairGradient(colour);
  const col: [number, number, number] = [0, 0, 0];
  const fade = scalpFade(params.softness);
  const p: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  const total = map.size * map.size;
  for (let t = 0; t < total; t++) {
    if (!map.coverage[t]) continue;
    for (let k = 0; k < 3; k++) {
      p[k] = map.position[t * 3 + k]!;
      n[k] = map.normal[t * 3 + k]!;
    }
    const ratio = field.ratio(p);
    if (ratio > 1 + fade) continue;
    const a = scalpCoverage(ratio, p, params.softness, seed);
    if (a <= 0.002) continue;
    const f = field.flow(p, n);
    const b: Vec3 = [n[1] * f[2] - n[2] * f[1], n[2] * f[0] - n[0] * f[2], n[0] * f[1] - n[1] * f[0]];
    const along = p[0] * f[0] + p[1] * f[1] + p[2] * f[2];
    const across = p[0] * b[0] + p[1] * b[1] + p[2] * b[2];
    const depth = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    // Fine strands, coarser clumps, and a slow variation over the head.
    const fine = valueNoise(across / 0.00035, along / 0.007, depth / 0.02, seed + 1);
    const clump = valueNoise(across / 0.0016, along / 0.025, depth / 0.05, seed + 2);
    const broad = fbm(p[0] / 0.03, p[1] / 0.03, p[2] / 0.03, seed + 3, 2);
    const streaks = 0.55 * fine + 0.3 * clump + 0.15 * broad;
    // Hair thins towards the hairline, where more of the skin's own shading shows through.
    // Under the locks and cards: in their shade, a little darker than the hair's own colour.
    const v = 0.3 + params.density * 0.7 * (streaks - 0.5) - 0.06 * (1 - a);
    gradient(v, 0.1, 0, col);
    const o = t * 4;
    img.data[o] = col[0];
    img.data[o + 1] = col[1];
    img.data[o + 2] = col[2];
    img.data[o + 3] = Math.round(a * 255);
  }
  return img;
}
