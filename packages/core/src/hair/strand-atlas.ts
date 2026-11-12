/**
 * Hair atlas baker v2 (PRD F15): the card texture rendered from real strand
 * geometry in 3D instead of drawn flat.
 *
 * Every region of the atlas is a small scene: hundreds of thin strands, each a
 * 3D polyline (clumped onto a few guides, waved, curled, frizzed, cut to
 * ragged lengths), seen by an orthographic camera as camera-facing ribbons and
 * lit from above and in front. Light reaching a strand is attenuated by the
 * strands between it and the light (a deep opacity grid), strands further back
 * are darker (occlusion), and each strand carries a highlight band whose
 * strength follows its tangent (Kajiya-Kay), so waves and curls break the band
 * up the way real hair does.
 *
 * Output, at 1024 or 2048 px:
 *  - value: greyscale shading in RGB (0.5 is the hair's own colour, below is
 *    shadow, above is highlight) and soft coverage in alpha. One atlas serves
 *    every hair colour through a gradient map (colourizeHair).
 *  - flow: the strand direction in RG (0.5 + 0.5 * tangent), root-to-tip in B,
 *    coverage in A.
 *
 * Deterministic for a preset, size and seed (no Math.random, no clocks).
 */
import { Rng } from '../random';
import { createImage, type RgbaImage } from '../skin/image';
import type { AtlasRegion, AtlasTag } from './atlas';

export const STRAND_PRESETS = ['straightFine', 'straightCoarse', 'wavy', 'curly', 'stubble'] as const;
export type StrandPreset = (typeof STRAND_PRESETS)[number];

export interface StrandPresetParams {
  name: string;
  /** Strand ribbon width in pixels at 1024. */
  strandWidth: number;
  /** Multiplies the strands per region. */
  density: number;
  /** Side-to-side waves: amplitude as a fraction of the region's width, cycles over the full height. */
  wave: { amplitude: number; cycles: number };
  /** Helix around the strand: radius as a fraction of the region's width, turns over the full height. */
  curl: { radius: number; turns: number };
  /** Random sideways wander, fraction of the region's width. */
  frizz: number;
  /** 0..1 pull onto the clump guides. */
  clump: number;
  /** 0..1 how much shorter a strand may be cut. */
  ragged: number;
  /** Longest strand as a fraction of the region's height. */
  length: number;
}

export const STRAND_PRESET_PARAMS: Record<StrandPreset, StrandPresetParams> = {
  straightFine: { name: 'Straight, fine', strandWidth: 1.5, density: 1.25, wave: { amplitude: 0.012, cycles: 1.5 }, curl: { radius: 0, turns: 0 }, frizz: 0.02, clump: 0.55, ragged: 0.4, length: 1 },
  straightCoarse: { name: 'Straight, coarse', strandWidth: 2.6, density: 0.8, wave: { amplitude: 0.02, cycles: 1.2 }, curl: { radius: 0, turns: 0 }, frizz: 0.03, clump: 0.65, ragged: 0.45, length: 1 },
  wavy: { name: 'Wavy', strandWidth: 1.8, density: 1.05, wave: { amplitude: 0.07, cycles: 3.5 }, curl: { radius: 0.01, turns: 3.5 }, frizz: 0.035, clump: 0.6, ragged: 0.45, length: 1 },
  curly: { name: 'Curly', strandWidth: 1.9, density: 1.1, wave: { amplitude: 0.03, cycles: 2 }, curl: { radius: 0.09, turns: 9 }, frizz: 0.06, clump: 0.7, ragged: 0.5, length: 0.95 },
  stubble: { name: 'Short stubble', strandWidth: 1.4, density: 1.6, wave: { amplitude: 0.01, cycles: 1 }, curl: { radius: 0, turns: 0 }, frizz: 0.05, clump: 0.2, ragged: 0.6, length: 0.32 },
};

/** One region of the v2 layout: its tag, its share of the atlas width and what is drawn in it. */
export interface StrandRegionSpec {
  tag: AtlasTag;
  /** Width as a fraction of the atlas. */
  width: number;
  strands: number;
  clumps: number;
  /** 0..1 narrowing of the whole lock towards the tip. */
  taper: number;
  /** Opaque underlay, 0..1 (locks are mostly opaque, the base layer fully). */
  underlay: number;
  /** Strand roots crowd the middle of the region (soft sides). */
  softSides: boolean;
  /** Multiplies the preset's raggedness. */
  ragged: number;
}

/**
 * The v2 layout: two wide lock regions (the hair mass), clumps and strands for
 * detail cards, a fringe, flyaways and a dense base for the scalp shell.
 */
export const STRAND_LAYOUT: readonly StrandRegionSpec[] = [
  { tag: 'lock', width: 0.17, strands: 300, clumps: 9, taper: 0.25, underlay: 0.85, softSides: true, ragged: 0.8 },
  { tag: 'lock', width: 0.17, strands: 260, clumps: 7, taper: 0.35, underlay: 0.75, softSides: true, ragged: 1 },
  { tag: 'clump', width: 0.1, strands: 80, clumps: 5, taper: 0.3, underlay: 0, softSides: true, ragged: 1 },
  { tag: 'clump', width: 0.1, strands: 64, clumps: 3, taper: 0.4, underlay: 0, softSides: true, ragged: 1.1 },
  { tag: 'strand', width: 0.085, strands: 46, clumps: 4, taper: 0.35, underlay: 0, softSides: false, ragged: 1.2 },
  { tag: 'strand', width: 0.085, strands: 36, clumps: 3, taper: 0.45, underlay: 0, softSides: false, ragged: 1.3 },
  { tag: 'fringe', width: 0.1, strands: 120, clumps: 6, taper: 0.1, underlay: 0.35, softSides: true, ragged: 0.6 },
  { tag: 'flyaway', width: 0.06, strands: 12, clumps: 3, taper: 0.2, underlay: 0, softSides: false, ragged: 1.4 },
  { tag: 'base', width: 0.125, strands: 160, clumps: 8, taper: 0, underlay: 1, softSides: false, ragged: 0.35 },
];

export interface StrandAtlas {
  value: RgbaImage;
  flow: RgbaImage;
  regions: AtlasRegion[];
}

/** Depth slices of the opacity grid, and its cell size in pixels at 1024. */
const GRID_Z = 12;
const GRID_CELL = 6;
/** Direction towards the light in (x px, y px, depth) grid steps: above and in front. */
const LIGHT_STEP: [number, number, number] = [0, -1, 0.45];
/** Optical density per unit of strand coverage in a cell. */
const OPACITY = 0.9;

interface Strand {
  /** Per sample: x, y in pixels, z depth 0 (back) .. 1 (front). */
  xs: Float32Array;
  ys: Float32Array;
  zs: Float32Array;
  width: number;
  /** Mean depth (draw order). */
  depth: number;
  glint: number;
  shade: number;
}

export function bakeStrandAtlas(preset: StrandPreset, size = 1024, seed = 1977): StrandAtlas {
  const P = STRAND_PRESET_PARAMS[preset];
  const S = Math.max(64, Math.round(size));
  const value = createImage(S, S, [128, 128, 128, 0]);
  const flow = createImage(S, S, [128, 128, 0, 0]);
  const regions: AtlasRegion[] = [];
  const total = STRAND_LAYOUT.reduce((s, r) => s + r.width, 0);
  let x = 0;
  STRAND_LAYOUT.forEach((spec, index) => {
    const x0 = Math.round((x / total) * S);
    x += spec.width;
    const x1 = index === STRAND_LAYOUT.length - 1 ? S : Math.round((x / total) * S);
    regions.push({ x: x0 / S, y: 0, w: (x1 - x0) / S, h: 1, tag: spec.tag });
    renderRegion(value, flow, x0, x1, S, spec, P, new Rng((Math.imul(seed, 7919) + index * 104729 + STRAND_PRESETS.indexOf(preset) * 15485863) >>> 0));
  });
  return { value, flow, regions };
}

function renderRegion(value: RgbaImage, flow: RgbaImage, x0: number, x1: number, S: number, spec: StrandRegionSpec, P: StrandPresetParams, rng: Rng): void {
  const w = x1 - x0;
  const px = S / 1024;
  const gutter = spec.underlay >= 1 ? 0.02 : 0.06;
  const inner = w * (1 - 2 * gutter);
  const left = x0 + w * gutter;
  const count = Math.max(1, Math.round(spec.strands * P.density));

  // Guides the strands clump onto, each swaying a little.
  const guides = Array.from({ length: Math.max(1, spec.clumps) }, (_, g) => ({
    u: (g + 0.5 + rng.range(-0.3, 0.3)) / Math.max(1, spec.clumps),
    sway: rng.range(-0.05, 0.05),
    phase: rng.range(0, Math.PI * 2),
  }));

  const strands: Strand[] = [];
  const maxLen = P.length;
  for (let s = 0; s < count; s++) {
    // Roots spread over the width; soft regions crowd the middle so the sides thin out.
    let u = (s + rng.next()) / count;
    if (spec.softSides) u = 0.5 + (u - 0.5) * (0.55 + 0.45 * Math.abs(u - 0.5) * 2);
    const z0 = rng.next();
    let lead = guides[0]!;
    for (const g of guides) if (Math.abs(g.u - u) < Math.abs(lead.u - u)) lead = g;
    const ragged = Math.min(0.95, P.ragged * spec.ragged);
    const len = maxLen * (spec.underlay >= 1 ? 0.92 : 1) * (1 - ragged * rng.next() ** 1.7);
    const steps = Math.max(8, Math.ceil(S * len * 1.2));
    const xs = new Float32Array(steps + 1);
    const ys = new Float32Array(steps + 1);
    const zs = new Float32Array(steps + 1);
    const wavePhase = rng.range(0, Math.PI * 2);
    const curlPhase = rng.range(0, Math.PI * 2);
    // No two strands wave or curl at quite the same rate.
    const waveRate = rng.range(0.85, 1.15);
    const curlRate = rng.range(0.85, 1.15);
    const fa = rng.range(-1, 1);
    const fb = rng.range(-1, 1);
    const fp = rng.range(0, Math.PI * 2);
    let zsum = 0;
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * len;
      let uu = u + P.frizz * (fa * Math.sin(t * 9.1 + fp) + fb * Math.sin(t * 4.3 + fp * 1.9)) * Math.min(1, t * 5);
      const g = lead.u + lead.sway * Math.sin(t * 3.1 + lead.phase) * t;
      uu += (g - uu) * P.clump * Math.min(1, t * 1.6);
      uu += P.wave.amplitude * Math.sin(t * Math.PI * 2 * P.wave.cycles * waveRate + wavePhase) * Math.min(1, t * 6);
      let z = z0;
      if (P.curl.radius > 0) {
        const a = t * Math.PI * 2 * P.curl.turns * curlRate + curlPhase;
        const r = P.curl.radius * Math.min(1, t * 4);
        uu += r * Math.cos(a);
        z += r * 4 * Math.sin(a);
      }
      // The lock narrows towards its tip.
      uu = 0.5 + (uu - 0.5) * (1 - spec.taper * t * t);
      xs[k] = left + inner * Math.min(1, Math.max(0, uu));
      ys[k] = t * (S - 1);
      zs[k] = Math.min(1, Math.max(0, z));
      zsum += zs[k]!;
    }
    strands.push({
      xs,
      ys,
      zs,
      width: P.strandWidth * px * rng.range(0.75, 1.25),
      depth: zsum / (steps + 1),
      glint: rng.range(-0.07, 0.07),
      shade: 1 + rng.range(-0.12, 0.12),
    });
  }

  // 1. Deep opacity grid: how much hair lies in each cell, then light transmittance through it.
  const cell = GRID_CELL * px;
  const GX = Math.max(1, Math.ceil(w / cell));
  const GY = Math.max(1, Math.ceil(S / cell));
  const density = new Float32Array(GX * GY * GRID_Z);
  const gi = (gx: number, gy: number, gz: number) => (gz * GY + gy) * GX + gx;
  for (const st of strands) {
    const per = st.width / (cell * cell);
    for (let k = 0; k < st.xs.length; k++) {
      const gx = Math.min(GX - 1, Math.max(0, Math.floor((st.xs[k]! - x0) / cell)));
      const gy = Math.min(GY - 1, Math.max(0, Math.floor(st.ys[k]! / cell)));
      const gz = Math.min(GRID_Z - 1, Math.floor(st.zs[k]! * GRID_Z));
      density[gi(gx, gy, gz)]! += per * (S / Math.max(1, st.xs.length));
    }
  }
  if (spec.underlay > 0) {
    // The underlay sits at the back.
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) density[gi(gx, gy, 0)]! += spec.underlay * 0.8;
  }
  const trans = new Float32Array(GX * GY * GRID_Z);
  for (let gz = 0; gz < GRID_Z; gz++) {
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        // March towards the light (up, and towards the camera), summing the hair in the way.
        let sum = 0;
        let fx = gx;
        let fy = gy;
        let fz = gz;
        for (let step = 0; step < 48; step++) {
          fx += LIGHT_STEP[0];
          fy += LIGHT_STEP[1];
          fz += LIGHT_STEP[2];
          if (fy < 0 || fz >= GRID_Z) break;
          sum += density[gi(Math.round(fx), Math.round(fy), Math.min(GRID_Z - 1, Math.round(fz)))]!;
        }
        trans[gi(gx, gy, gz)] = Math.exp(-OPACITY * sum);
      }
    }
  }
  const lightAt = (x: number, y: number, z: number) => {
    const fx = Math.min(GX - 1.001, Math.max(0, (x - x0) / cell - 0.5));
    const fy = Math.min(GY - 1.001, Math.max(0, y / cell - 0.5));
    const fz = Math.min(GRID_Z - 1.001, Math.max(0, z * GRID_Z - 0.5));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const ty = fy - iy;
    const tz = fz - iz;
    let r = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1;
      const dy = (c >> 1) & 1;
      const dz = (c >> 2) & 1;
      const wgt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      r += wgt * trans[gi(Math.min(GX - 1, ix + dx), Math.min(GY - 1, iy + dy), Math.min(GRID_Z - 1, iz + dz))]!;
    }
    return r;
  };

  // 2. Composite, back to front, in floats (premultiplied), then write straight colour.
  const acc = new Float32Array(w * S);
  const alpha = new Float32Array(w * S);
  const fx = new Float32Array(w * S);
  const fy = new Float32Array(w * S);
  const fz = new Float32Array(w * S);
  const over = (i: number, a: number, v: number, tx: number, ty: number, along: number) => {
    acc[i] = v * a + acc[i]! * (1 - a);
    fx[i] = tx * a + fx[i]! * (1 - a);
    fy[i] = ty * a + fy[i]! * (1 - a);
    fz[i] = along * a + fz[i]! * (1 - a);
    alpha[i] = a + alpha[i]! * (1 - a);
  };

  if (spec.underlay > 0) {
    // Opaque underlay with soft sides and a ragged, fading end; darker than the strands over it.
    const ends = new Float32Array(w);
    let e = S * (0.78 + 0.12 * rng.next());
    for (let c = 0; c < w; c++) {
      e += rng.range(-1, 1) * 3 * px;
      e = Math.min(S * 0.95, Math.max(S * 0.62, e));
      ends[c] = e;
    }
    for (let c = 0; c < w; c++) {
      const u = (c + 0.5 - w * gutter) / inner;
      const side = spec.softSides ? smooth(0, 0.22, u) * smooth(0, 0.22, 1 - u) : u >= 0 && u <= 1 ? 1 : 0;
      if (side <= 0) continue;
      for (let y = 0; y < S; y++) {
        const fade = Math.min(1, Math.max(0, (ends[c]! - y) / (S * 0.06)));
        const a = spec.underlay * side * fade;
        if (a <= 0) continue;
        const v = 0.32 * lightAt(x0 + c, y, 0) + 0.12;
        over(y * w + c, a, v, 0, 1, y / S);
      }
    }
  }

  strands.sort((a, b) => a.depth - b.depth);
  const stamp = new Float32Array(w * S);
  const touched: number[] = [];
  const tanX = new Float32Array(w * S);
  const tanY = new Float32Array(w * S);
  const shadeAt = new Float32Array(w * S);
  for (const st of strands) {
    touched.length = 0;
    const n = st.xs.length;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const cx = st.xs[k]!;
      const cy = st.ys[k]!;
      const z = st.zs[k]!;
      const ka = Math.max(0, k - 1);
      const kb = Math.min(n - 1, k + 1);
      let tx = st.xs[kb]! - st.xs[ka]!;
      let ty = st.ys[kb]! - st.ys[ka]!;
      const tz = (st.zs[kb]! - st.zs[ka]!) * w * 0.25;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      // Light from above and in front; Kajiya-Kay diffuse and a highlight band whose strength follows the tangent.
      const L = [0, -0.83, 0.55];
      const tDotL = tx * L[0]! + ty * L[1]! + (tz / tl) * L[2]!;
      const diffuse = Math.sqrt(Math.max(0, 1 - tDotL * tDotL));
      const H = normalise3(L[0]!, L[1]!, L[2]! + 1);
      const tDotH = tx * H[0] + ty * H[1] + (tz / tl) * H[2];
      const kk = Math.pow(Math.sqrt(Math.max(0, 1 - tDotH * tDotH)), 8);
      const t = cy / S;
      const band = Math.exp(-(((t - 0.3 - st.glint) / 0.085) ** 2));
      const light = lightAt(cx, cy, z);
      const occlusion = 0.7 + 0.3 * z;
      const root = 0.82 + 0.18 * Math.min(1, t * 6);
      let v = (0.18 + 0.5 * diffuse * light) * occlusion * root * st.shade + 0.42 * band * kk * light;
      v = Math.min(1, v);
      // Thinner and fainter over the last part of the strand.
      const tipFade = Math.min(1, (1 - f) / 0.15);
      const r = Math.max(0.45, (st.width / 2) * (0.5 + 0.5 * tipFade));
      const xa = Math.max(x0, Math.floor(cx - r - 1));
      const xb = Math.min(x1 - 1, Math.ceil(cx + r + 1));
      const ya = Math.max(0, Math.floor(cy - r - 1));
      const yb = Math.min(S - 1, Math.ceil(cy + r + 1));
      for (let y = ya; y <= yb; y++) {
        for (let xx = xa; xx <= xb; xx++) {
          const cover = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(xx + 0.5 - cx, y + 0.5 - cy))) * (0.3 + 0.7 * tipFade);
          const i = y * w + (xx - x0);
          if (cover > stamp[i]!) {
            if (stamp[i] === 0) touched.push(i);
            stamp[i] = cover;
            shadeAt[i] = v;
            tanX[i] = tx;
            tanY[i] = ty;
          }
        }
      }
    }
    for (const i of touched) {
      const a = stamp[i]!;
      stamp[i] = 0;
      over(i, a, shadeAt[i]!, tanX[i]!, tanY[i]!, Math.floor(i / w) / S);
    }
  }

  // Straight values out; empty texels take the hair's own colour (0.5), so filtering never pulls in a dark fringe.
  for (let y = 0; y < S; y++) {
    for (let c = 0; c < w; c++) {
      const i = y * w + c;
      const a = alpha[i]!;
      const o = (y * S + x0 + c) * 4;
      const stored = Math.round(a * 255);
      const v = stored > 0 ? acc[i]! / a : 0.5;
      const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
      value.data[o] = g;
      value.data[o + 1] = g;
      value.data[o + 2] = g;
      value.data[o + 3] = stored;
      flow.data[o] = Math.round((0.5 + 0.5 * (stored > 0 ? fx[i]! / a : 0)) * 255);
      flow.data[o + 1] = Math.round((0.5 + 0.5 * (stored > 0 ? fy[i]! / a : 1)) * 255);
      flow.data[o + 2] = Math.round(Math.min(1, stored > 0 ? fz[i]! / a : y / S) * 255);
      flow.data[o + 3] = stored;
    }
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function normalise3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// ------------------------------------------------------------------ colour

/** Hair colour as a gradient map over the greyscale atlas (PRD F15). Colours are sRGB 0..1. */
export interface HairColour {
  base: [number, number, number];
  /** 0..1 darker roots. */
  rootDarken: number;
  /** 0..1 lighter (sun-faded) tips. */
  tipLighten: number;
  /** 0..1 share of strands in the streak colour. */
  streaks: number;
  streakColour: [number, number, number];
  /** 0..1 share of grey strands. */
  grey: number;
}

export const HAIR_COLOUR_PRESETS: Record<string, { name: string; colour: HairColour }> = {
  platinum: { name: 'Platinum blonde', colour: colour([0.86, 0.8, 0.68], 0.25, 0.3) },
  blonde: { name: 'Blonde', colour: colour([0.74, 0.6, 0.38], 0.35, 0.35) },
  darkBlonde: { name: 'Dark blonde', colour: colour([0.55, 0.42, 0.26], 0.35, 0.3) },
  lightBrown: { name: 'Light brown', colour: colour([0.42, 0.29, 0.18], 0.3, 0.2) },
  brown: { name: 'Brown', colour: colour([0.3, 0.2, 0.13], 0.3, 0.15) },
  darkBrown: { name: 'Dark brown', colour: colour([0.18, 0.12, 0.09], 0.25, 0.1) },
  black: { name: 'Black', colour: colour([0.07, 0.065, 0.07], 0.1, 0.05) },
  auburn: { name: 'Auburn', colour: colour([0.42, 0.17, 0.1], 0.3, 0.2) },
  ginger: { name: 'Ginger', colour: colour([0.66, 0.33, 0.15], 0.25, 0.25) },
  grey: { name: 'Grey', colour: { ...colour([0.55, 0.53, 0.5], 0.1, 0.15), grey: 0.6 } },
};

function colour(base: [number, number, number], rootDarken: number, tipLighten: number): HairColour {
  return { base, rootDarken, tipLighten, streaks: 0, streakColour: [Math.min(1, base[0] * 1.5 + 0.1), Math.min(1, base[1] * 1.5 + 0.08), Math.min(1, base[2] * 1.4 + 0.05)], grey: 0 };
}

export const DEFAULT_HAIR_COLOUR: HairColour = HAIR_COLOUR_PRESETS.brown!.colour;

export function sanitiseHairColour(raw: unknown): HairColour {
  const r = (raw ?? {}) as Partial<HairColour>;
  const d = DEFAULT_HAIR_COLOUR;
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def);
  const rgb = (v: unknown, def: [number, number, number]): [number, number, number] =>
    Array.isArray(v) && v.length === 3 ? [num(v[0], def[0]), num(v[1], def[1]), num(v[2], def[2])] : [...def];
  return {
    base: rgb(r.base, d.base),
    rootDarken: num(r.rootDarken, d.rootDarken),
    tipLighten: num(r.tipLighten, d.tipLighten),
    streaks: num(r.streaks, d.streaks),
    streakColour: rgb(r.streakColour, d.streakColour),
    grey: num(r.grey, d.grey),
  };
}

/** A stable key for a colour (texture caches). */
export function hairColourKey(c: HairColour): string {
  return [...c.base, c.rootDarken, c.tipLighten, c.streaks, ...c.streakColour, c.grey].map((v) => v.toFixed(4)).join(',');
}

/**
 * Colour a greyscale hair atlas through a gradient map: value 0.5 is the
 * base colour, darker values run to a deep shadow of it, lighter ones to a
 * highlight. Roots darken and tips lighten by where a texel lies in its region
 * (roots at the top of every region); streak and grey strands are picked per
 * column, which is the direction strands run in the atlas.
 */
export function colourizeHair(grey: RgbaImage, regions: readonly AtlasRegion[], c: HairColour): RgbaImage {
  const { width: W, height: H } = grey;
  const out = createImage(W, H);
  const gradient = hairGradient(c);
  // Per column: which region, and whether it is a streak or grey strand.
  const regionOf = new Int32Array(W).fill(-1);
  regions.forEach((r, i) => {
    for (let x = Math.floor(r.x * W); x < Math.min(W, Math.ceil((r.x + r.w) * W)); x++) regionOf[x] = i;
  });
  const colKind = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    const band = Math.floor(x / Math.max(1, Math.round(W / 512)));
    const h = hash1(band * 2654435761);
    const h2 = hash1(band * 40503 + 977);
    colKind[x] = h < c.streaks * 0.4 ? 1 : h2 < c.grey ? 2 : 0;
  }
  const col: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ri = regionOf[x]!;
      const r = ri >= 0 ? regions[ri]! : null;
      const along = r ? Math.min(1, Math.max(0, (y / H - r.y) / r.h)) : 0.5;
      gradient(grey.data[i]! / 255, along, colKind[x]!, col);
      out.data[i] = col[0];
      out.data[i + 1] = col[1];
      out.data[i + 2] = col[2];
      out.data[i + 3] = grey.data[i + 3]!;
    }
  }
  return out;
}

/**
 * The hair colour's gradient map as a function: shading value (0.5 is the
 * colour itself), position from root (0) to tip (1) and strand kind (0 plain,
 * 1 streak, 2 grey) to sRGB 0..255 in `out`. Shared by the atlas colouring
 * and the scalp layer, so painted short hair matches the cards above it.
 */
export function hairGradient(c: HairColour): (v: number, along: number, kind: number, out: [number, number, number]) => void {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const base = c.base.map(lin);
  const streak = c.streakColour.map(lin);
  const greyLin = lin(0.62);
  return (v, along, kind, out) => {
    for (let k = 0; k < 3; k++) {
      let b = kind === 1 ? base[k]! + (streak[k]! - base[k]!) * 0.75 : kind === 2 ? greyLin : base[k]!;
      b *= 1 - c.rootDarken * 0.55 * (1 - smooth(0, 0.3, along));
      b += (Math.min(1, b * 1.8 + 0.06) - b) * c.tipLighten * smooth(0.45, 1, along);
      // Shadow -> the colour at 0.5 -> highlight.
      const shadow = b * 0.12;
      const light = b + (1 - b) * 0.55;
      const col = v < 0.5 ? shadow + (b - shadow) * (v / 0.5) : b + (light - b) * ((v - 0.5) / 0.5);
      out[k] = Math.round(srgb(Math.min(1, Math.max(0, col))) * 255);
    }
  };
}

function hash1(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
