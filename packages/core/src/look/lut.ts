/**
 * Colour-grading LUTs (PRD Part 2, F14): 3D lookup tables in the Adobe/Resolve
 * `.cube` format, applied to display-space (sRGB-encoded) colour after tone
 * mapping. PS2CC's own LUTs are generated from a few grading controls
 * (`gradeLut`), so they are ours to ship (CC0); users can load any `.cube`.
 */
import type { Rgb } from './look';

export interface Lut3D {
  size: number;
  /** RGB per entry, red fastest, then green, then blue (the .cube order). */
  data: Float32Array;
  title: string;
}

export interface GradeControls {
  /** -1 (cold) .. 1 (warm). */
  temperature: number;
  /** -1 (green) .. 1 (magenta). */
  tint: number;
  /** 0 grey .. 1 unchanged .. 2 double. */
  saturation: number;
  /** -1 flat .. 0 unchanged .. 1 strong S-curve around mid grey. */
  contrast: number;
  /** Raises the blacks per channel (0..0.3). */
  lift: Rgb;
  /** Mid-tone power per channel (1 unchanged; above 1 brighter). */
  gamma: Rgb;
  /** Scales the whites per channel. */
  gain: Rgb;
  /** Colour added in the shadows and in the highlights (split toning). */
  shadowTint: Rgb;
  highlightTint: Rgb;
}

export const IDENTITY_GRADE: GradeControls = {
  temperature: 0,
  tint: 0,
  saturation: 1,
  contrast: 0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** One display-space colour through the grade. */
export function gradeColour(c: Rgb, g: GradeControls): Rgb {
  let [r, gr, b] = c;
  // White balance.
  r *= 1 + 0.12 * g.temperature + 0.04 * g.tint;
  gr *= 1 - 0.08 * g.tint;
  b *= 1 - 0.12 * g.temperature + 0.04 * g.tint;
  // Lift, gamma, gain.
  const lgg = (x: number, k: 0 | 1 | 2) => {
    const v = clamp01(g.gain[k] * (x + g.lift[k] * (1 - x)));
    return Math.pow(v, 1 / Math.max(0.05, g.gamma[k]));
  };
  r = lgg(r, 0);
  gr = lgg(gr, 1);
  b = lgg(b, 2);
  // Contrast: blend towards a smooth S-curve (or towards mid grey when negative).
  const s = (x: number) => {
    const xc = clamp01(x);
    if (g.contrast >= 0) return xc + g.contrast * (xc * xc * (3 - 2 * xc) - xc);
    return 0.5 + (xc - 0.5) * (1 + g.contrast);
  };
  r = s(r);
  gr = s(gr);
  b = s(b);
  // Saturation around luma.
  const y = luma(r, gr, b);
  r = y + g.saturation * (r - y);
  gr = y + g.saturation * (gr - y);
  b = y + g.saturation * (b - y);
  // Split toning.
  const y2 = clamp01(luma(r, gr, b));
  const sh = (1 - y2) * (1 - y2);
  const hi = y2 * y2;
  r += g.shadowTint[0] * sh + g.highlightTint[0] * hi;
  gr += g.shadowTint[1] * sh + g.highlightTint[1] * hi;
  b += g.shadowTint[2] * sh + g.highlightTint[2] * hi;
  return [clamp01(r), clamp01(gr), clamp01(b)];
}

/** A size^3 LUT of the grade. */
export function gradeLut(g: GradeControls, size = 32, title = 'PS2CC grade'): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        const out = gradeColour([rx / (size - 1), gy / (size - 1), bz / (size - 1)], g);
        data[i++] = out[0];
        data[i++] = out[1];
        data[i++] = out[2];
      }
    }
  }
  return { size, data, title };
}

export function writeCube(lut: Lut3D): string {
  const lines = [`TITLE "${lut.title.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < lut.data.length; i += 3) {
    lines.push(`${lut.data[i]!.toFixed(6)} ${lut.data[i + 1]!.toFixed(6)} ${lut.data[i + 2]!.toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}

export class LutError extends Error {}

/** Read a .cube 3D LUT (domain 0..1). */
export function parseCube(text: string): Lut3D {
  let size = 0;
  let title = '';
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('TITLE')) {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    if (line.startsWith('LUT_1D_SIZE')) throw new LutError('1D LUTs are not supported');
    if (/^(DOMAIN_MIN|DOMAIN_MAX)/.test(line)) {
      const v = line.split(/\s+/).slice(1).map(Number);
      const want = line.startsWith('DOMAIN_MIN') ? 0 : 1;
      if (v.some((x) => x !== want)) throw new LutError('only a 0..1 domain is supported');
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) throw new LutError(`bad line: ${line}`);
    values.push(...parts);
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new LutError(`bad LUT_3D_SIZE ${size}`);
  if (values.length !== size * size * size * 3) throw new LutError(`expected ${size ** 3} entries, found ${values.length / 3}`);
  return { size, data: Float32Array.from(values), title };
}

/** Trilinear lookup (CPU reference for the shaders). */
export function applyLut(lut: Lut3D, c: Rgb): Rgb {
  const n = lut.size - 1;
  const f = c.map((x) => clamp01(x) * n) as Rgb;
  const i0 = f.map((x) => Math.min(n - 1, Math.floor(x)));
  const t = f.map((x, k) => x - i0[k]!);
  const at = (r: number, g: number, b: number, k: number) => lut.data[((b * lut.size + g) * lut.size + r) * 3 + k]!;
  const out: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let v = 0;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const w = (dx ? t[0]! : 1 - t[0]!) * (dy ? t[1]! : 1 - t[1]!) * (dz ? t[2]! : 1 - t[2]!);
          v += w * at(i0[0]! + dx, i0[1]! + dy, i0[2]! + dz, k);
        }
    out[k] = v;
  }
  return out;
}

/** The grading controls behind PS2CC's shipped LUTs (tools/asset-tools build:looks). */
export const SHIPPED_GRADES: Record<string, { file: string; controls: GradeControls }> = {
  foggyTown: {
    file: 'looks/foggy_town.cube',
    // Cold, grey and low contrast; the blacks lift into the fog.
    controls: {
      ...IDENTITY_GRADE,
      temperature: -0.45,
      tint: -0.1,
      saturation: 0.55,
      contrast: -0.25,
      lift: [0.05, 0.055, 0.065],
      gamma: [1.0, 1.02, 1.05],
      gain: [0.95, 0.97, 1.0],
      shadowTint: [-0.01, 0.005, 0.02],
      highlightTint: [0, 0.005, 0.01],
    },
  },
  villageOvercast: {
    file: 'looks/village_overcast.cube',
    // Desaturated green-brown, flat sky.
    controls: {
      ...IDENTITY_GRADE,
      temperature: 0.15,
      tint: -0.35,
      saturation: 0.6,
      contrast: 0.1,
      lift: [0.03, 0.035, 0.02],
      gamma: [1.0, 1.03, 0.95],
      gain: [0.97, 0.98, 0.88],
      shadowTint: [0.01, 0.015, -0.005],
      highlightTint: [0.01, 0.01, -0.02],
    },
  },
  interiorFlashlight: {
    file: 'looks/interior_flashlight.cube',
    // Deep blacks with a teal cast, warm skin in the beam.
    controls: {
      ...IDENTITY_GRADE,
      temperature: 0.1,
      saturation: 0.8,
      contrast: 0.35,
      lift: [0, 0.008, 0.012],
      gamma: [0.95, 0.95, 0.97],
      gain: [1.0, 0.98, 0.92],
      shadowTint: [-0.01, 0.01, 0.02],
      highlightTint: [0.03, 0.01, -0.02],
    },
  },
};
