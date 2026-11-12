/**
 * Looks (PRD Part 2, F14): lights, ambient, fog and a colour grade saved
 * together as a `.ps2look` file (JSON). The app's viewport renders with one;
 * the Unity package reads the same file (PS2Look component), so a character
 * looks the same in both.
 *
 * Colours are linear RGB. Directions point from the surface towards the light,
 * in character space (+Y up, +Z the character's front).
 */

export type Rgb = [number, number, number];

export interface LookLights {
  /** Hemisphere ambient: light from above and from below. */
  sky: Rgb;
  ground: Rgb;
  key: { direction: Rgb; color: Rgb } | null;
  fill: { direction: Rgb; color: Rgb } | null;
  /**
   * Flashlight: a spot at the camera, offset in camera space (metres: +x right,
   * +y up, +z back), pointing where the camera looks.
   */
  spot: { color: Rgb; cosOuter: number; cosInner: number; range: number; offset: Rgb } | null;
  /** Fresnel rim, a cheap back light. */
  rim: { color: Rgb; strength: number };
}

/** Linear distance fog (metres from the camera). */
export interface LookFog {
  color: Rgb;
  near: number;
  far: number;
}

export interface LookGrade {
  /** Stops: colour is multiplied by 2^exposure before tone mapping. */
  exposure: number;
  tonemap: 'none' | 'filmic';
  /** A .cube LUT (path under assets/core, or a library URL), applied in display space. */
  lut: string | null;
  lutStrength: number;
  bloom: { strength: number; threshold: number; radius: number };
  /** 0 (none) to 1 (heavy). */
  grain: number;
  vignette: number;
  /** Chromatic aberration at the frame edge, in pixels at 1080p. */
  chromatic: number;
}

export interface Look {
  format: 'ps2cc.look/1';
  id: string;
  label: string;
  lights: LookLights;
  fog: LookFog | null;
  grade: LookGrade;
  background: Rgb;
}

export const NEUTRAL_GRADE: LookGrade = {
  exposure: 0,
  tonemap: 'none',
  lut: null,
  lutStrength: 1,
  bloom: { strength: 0, threshold: 1, radius: 0.5 },
  grain: 0,
  vignette: 0,
  chromatic: 0,
};

const deg = (d: number) => Math.cos((d * Math.PI) / 180);
const grey = (v: number): Rgb => [v, v, v];

export type LookId =
  | 'studio'
  | 'flashlight'
  | 'overcast'
  | 'night'
  | 'foggyTown'
  | 'villageOvercast'
  | 'interiorFlashlight'
  | 'studioPortrait';

/**
 * Shipped looks. The first four are Part 1's lighting presets, unchanged (flat
 * ambient, no grade); the last four are the Part 2 looks (F14), with the
 * generated LUTs in assets/core/looks/.
 */
export const LOOKS: Record<LookId, Look> = {
  studio: {
    format: 'ps2cc.look/1',
    id: 'studio',
    label: 'Studio',
    lights: {
      sky: [0.36, 0.35, 0.36],
      ground: [0.36, 0.35, 0.36],
      key: { direction: [-0.45, 0.55, 0.7], color: [1.0, 0.96, 0.9] },
      fill: null,
      spot: null,
      rim: { color: [0.6, 0.65, 0.75], strength: 0.25 },
    },
    fog: null,
    grade: NEUTRAL_GRADE,
    background: grey(0.011), // the app's panel colour, #1b1b1b
  },
  flashlight: {
    format: 'ps2cc.look/1',
    id: 'flashlight',
    label: 'Flashlight',
    lights: {
      sky: [0.035, 0.038, 0.05],
      ground: [0.035, 0.038, 0.05],
      key: null,
      fill: null,
      spot: { color: [1.45, 1.38, 1.22], cosOuter: deg(26), cosInner: deg(12), range: 9, offset: [0, 0, 0] },
      rim: { color: [0.25, 0.28, 0.4], strength: 0.08 },
    },
    fog: null,
    grade: NEUTRAL_GRADE,
    background: grey(0),
  },
  overcast: {
    format: 'ps2cc.look/1',
    id: 'overcast',
    label: 'Overcast exterior',
    lights: {
      sky: [0.5, 0.53, 0.58],
      ground: [0.5, 0.53, 0.58],
      key: { direction: [0.1, 1.0, 0.25], color: [0.55, 0.57, 0.6] },
      fill: null,
      spot: null,
      rim: { color: [0.5, 0.52, 0.55], strength: 0.12 },
    },
    fog: null,
    grade: NEUTRAL_GRADE,
    background: [0.52, 0.55, 0.58],
  },
  night: {
    format: 'ps2cc.look/1',
    id: 'night',
    label: 'Night street',
    lights: {
      sky: [0.05, 0.06, 0.1],
      ground: [0.05, 0.06, 0.1],
      key: { direction: [0.6, 0.9, 0.35], color: [1.05, 0.62, 0.28] },
      fill: null,
      spot: null,
      rim: { color: [0.25, 0.35, 0.7], strength: 0.3 },
    },
    fog: null,
    grade: NEUTRAL_GRADE,
    background: [0.02, 0.025, 0.045],
  },
  foggyTown: {
    format: 'ps2cc.look/1',
    id: 'foggyTown',
    label: 'Foggy town',
    lights: {
      sky: [0.42, 0.45, 0.5],
      ground: [0.16, 0.16, 0.17],
      key: { direction: [0.25, 1.0, 0.45], color: [0.34, 0.36, 0.4] },
      fill: { direction: [-0.6, 0.2, 0.5], color: [0.08, 0.09, 0.1] },
      spot: null,
      rim: { color: [0.5, 0.54, 0.6], strength: 0.18 },
    },
    fog: { color: [0.36, 0.38, 0.41], near: 2.5, far: 14 },
    grade: {
      exposure: 0.15,
      tonemap: 'filmic',
      lut: 'looks/foggy_town.cube',
      lutStrength: 1,
      bloom: { strength: 0.12, threshold: 0.8, radius: 0.6 },
      grain: 0.45,
      vignette: 0.35,
      chromatic: 0.6,
    },
    background: [0.36, 0.38, 0.41],
  },
  villageOvercast: {
    format: 'ps2cc.look/1',
    id: 'villageOvercast',
    label: 'Village overcast',
    lights: {
      sky: [0.46, 0.47, 0.44],
      ground: [0.2, 0.18, 0.13],
      key: { direction: [-0.35, 1.0, 0.35], color: [0.62, 0.6, 0.53] },
      fill: { direction: [0.6, 0.25, 0.45], color: [0.1, 0.11, 0.1] },
      spot: null,
      rim: { color: [0.45, 0.47, 0.42], strength: 0.12 },
    },
    fog: { color: [0.42, 0.42, 0.37], near: 5, far: 30 },
    grade: {
      exposure: 0.1,
      tonemap: 'filmic',
      lut: 'looks/village_overcast.cube',
      lutStrength: 1,
      bloom: { strength: 0.08, threshold: 0.9, radius: 0.5 },
      grain: 0.25,
      vignette: 0.3,
      chromatic: 0.3,
    },
    background: [0.4, 0.41, 0.36],
  },
  interiorFlashlight: {
    format: 'ps2cc.look/1',
    id: 'interiorFlashlight',
    label: 'Interior flashlight',
    lights: {
      sky: [0.018, 0.02, 0.026],
      ground: [0.008, 0.008, 0.01],
      key: null,
      fill: null,
      // Held at the right hip, below the eye: shadows fall up and to the left.
      spot: { color: [2.4, 2.25, 1.95], cosOuter: deg(28), cosInner: deg(12), range: 7, offset: [0.22, -0.18, 0] },
      rim: { color: [0.12, 0.14, 0.2], strength: 0.05 },
    },
    fog: { color: [0.004, 0.004, 0.005], near: 3, far: 9 },
    grade: {
      exposure: 0,
      tonemap: 'filmic',
      lut: 'looks/interior_flashlight.cube',
      lutStrength: 1,
      bloom: { strength: 0.18, threshold: 0.7, radius: 0.55 },
      grain: 0.55,
      vignette: 0.55,
      chromatic: 0.5,
    },
    background: grey(0.003),
  },
  studioPortrait: {
    format: 'ps2cc.look/1',
    id: 'studioPortrait',
    label: 'Studio portrait',
    lights: {
      sky: [0.3, 0.3, 0.31],
      ground: [0.14, 0.13, 0.12],
      key: { direction: [-0.5, 0.6, 0.65], color: [1.05, 1.0, 0.95] },
      fill: { direction: [0.7, 0.15, 0.6], color: [0.22, 0.23, 0.25] },
      spot: null,
      rim: { color: [0.55, 0.58, 0.65], strength: 0.22 },
    },
    fog: null,
    grade: {
      exposure: 0,
      tonemap: 'filmic',
      lut: null,
      lutStrength: 1,
      bloom: { strength: 0, threshold: 1, radius: 0.5 },
      grain: 0,
      vignette: 0.15,
      chromatic: 0,
    },
    background: grey(0.04),
  },
};

export const LOOK_IDS = Object.keys(LOOKS) as LookId[];

export class LookError extends Error {}

const num = (v: unknown, fallback: number, lo = -1e6, hi = 1e6): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const rgb = (v: unknown, fallback: Rgb): Rgb =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : fallback;

/** Read a .ps2look file. Missing fields take neutral values; numbers are clamped. */
export function parseLook(json: unknown): Look {
  if (typeof json !== 'object' || json === null) throw new LookError('not an object');
  const r = json as Partial<Look> & Record<string, unknown>;
  if (r.format !== 'ps2cc.look/1') throw new LookError(`not a PS2CC look (format ${String(r.format)})`);
  const l = (r.lights ?? {}) as Partial<LookLights>;
  const g = (r.grade ?? {}) as Partial<LookGrade>;
  const key = l.key ? { direction: rgb(l.key.direction, [0, 1, 1]), color: rgb(l.key.color, [1, 1, 1]) } : null;
  const fill = l.fill ? { direction: rgb(l.fill.direction, [1, 0, 1]), color: rgb(l.fill.color, [0, 0, 0]) } : null;
  const spot = l.spot
    ? {
        color: rgb(l.spot.color, [1, 1, 1]),
        cosOuter: num(l.spot.cosOuter, deg(26), -1, 1),
        cosInner: num(l.spot.cosInner, deg(12), -1, 1),
        range: num(l.spot.range, 9, 0.01, 1000),
        offset: rgb(l.spot.offset, [0, 0, 0]),
      }
    : null;
  const fog = r.fog ? { color: rgb(r.fog.color, [0.5, 0.5, 0.5]), near: num(r.fog.near, 5, 0), far: num(r.fog.far, 30, 0.01) } : null;
  return {
    format: 'ps2cc.look/1',
    id: typeof r.id === 'string' && r.id ? r.id : 'custom',
    label: typeof r.label === 'string' && r.label ? r.label : 'Custom look',
    lights: {
      sky: rgb(l.sky, [0.3, 0.3, 0.3]),
      ground: rgb(l.ground, rgb(l.sky, [0.3, 0.3, 0.3])),
      key,
      fill,
      spot,
      rim: { color: rgb(l.rim?.color, [1, 1, 1]), strength: num(l.rim?.strength, 0, 0, 4) },
    },
    fog,
    grade: {
      exposure: num(g.exposure, 0, -8, 8),
      tonemap: g.tonemap === 'filmic' ? 'filmic' : 'none',
      lut: typeof g.lut === 'string' && g.lut ? g.lut : null,
      lutStrength: num(g.lutStrength, 1, 0, 1),
      bloom: {
        strength: num(g.bloom?.strength, 0, 0, 4),
        threshold: num(g.bloom?.threshold, 1, 0, 16),
        radius: num(g.bloom?.radius, 0.5, 0, 1),
      },
      grain: num(g.grain, 0, 0, 1),
      vignette: num(g.vignette, 0, 0, 1),
      chromatic: num(g.chromatic, 0, 0, 8),
    },
    background: rgb(r.background, [0, 0, 0]),
  };
}

/** Stable, pretty JSON (parseLook(serializeLook(x)) equals x for a parsed look). */
export function serializeLook(look: Look): string {
  return JSON.stringify(parseLook(JSON.parse(JSON.stringify(look))), null, 2) + '\n';
}
