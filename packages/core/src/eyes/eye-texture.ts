/**
 * Generated eyes (PRD Part 2 F19): an iris library made of procedurally drawn
 * radial fibre textures in many colours, a sclera with edge darkening and
 * faint veins, an adjustable pupil, a baked shadow ring from the lids, and a
 * painted catch-light for Classic (per-vertex lighting has no specular to
 * make the eye look wet; Enhanced and Hero get a real highlight instead).
 *
 * The texture is drawn in the UV layout of MakeHuman's eyes (both the low-
 * and high-poly meshes use it): two discs, one per eye, measured on
 * MakeHuman's own eye textures. +v is up on both discs; the right eye's disc
 * is mirrored (+u is towards the nose there), so the catch-light is placed
 * per disc to land on the same side of both eyes.
 */
import { createImage, type RgbaImage } from '../skin/image';
import { hash3, fbm, smoothstep, valueNoise } from '../skin/noise';

export interface EyeLook {
  /** Iris colour (hex) at mid-radius. */
  iris: string;
  /** Lighter colour around the pupil (the collarette), hex. */
  inner: string;
  /** Contrast of the radial fibres, 0..1. */
  fibres: number;
  /** Dark ring at the iris edge (the limbal ring), 0..1. */
  limbal: number;
  /** Pupil radius as a fraction of the iris radius (0.15..0.6). */
  pupil: number;
  /** Sclera colour (hex). */
  sclera: string;
  /** Visible veins in the sclera, 0..1. */
  veins: number;
  /** Shadow from the lids: a darker ring around the visible eye and a band under the upper lid, 0..1. */
  lidShadow: number;
  seed: number;
}

/** The eye texture's UV layout, measured on MakeHuman's eye textures (colour_*.jpg). */
export const EYE_UV = {
  /** Disc centres: the character's left eye (+x), then the right eye (mirrored in u). */
  discs: [
    { centre: [0.7055, 0.704] as const, mirror: false },
    { centre: [0.2915, 0.2945] as const, mirror: true },
  ],
  /** Iris radius (the limbus) in UV units. */
  iris: 0.11,
} as const;

export interface IrisPreset {
  id: string;
  name: string;
  look: Pick<EyeLook, 'iris' | 'inner' | 'fibres' | 'limbal'>;
}

/** The iris library: one fibre generator, many colours. */
export const IRIS_LIBRARY: readonly IrisPreset[] = [
  { id: 'dark-brown', name: 'Dark brown', look: { iris: '#3a2416', inner: '#5a3a1e', fibres: 0.45, limbal: 0.7 } },
  { id: 'brown', name: 'Brown', look: { iris: '#5c3a1f', inner: '#8a5a26', fibres: 0.55, limbal: 0.65 } },
  { id: 'light-brown', name: 'Light brown', look: { iris: '#7a5230', inner: '#a6782e', fibres: 0.6, limbal: 0.6 } },
  { id: 'amber', name: 'Amber', look: { iris: '#8a5a1c', inner: '#c08a2c', fibres: 0.55, limbal: 0.55 } },
  { id: 'hazel', name: 'Hazel', look: { iris: '#6a6236', inner: '#9a6a2a', fibres: 0.65, limbal: 0.6 } },
  { id: 'green', name: 'Green', look: { iris: '#4f6a3e', inner: '#8a7a3a', fibres: 0.65, limbal: 0.6 } },
  { id: 'grey-green', name: 'Grey-green', look: { iris: '#66756a', inner: '#8c845a', fibres: 0.6, limbal: 0.55 } },
  { id: 'blue', name: 'Blue', look: { iris: '#4a6a90', inner: '#7a8a9a', fibres: 0.7, limbal: 0.65 } },
  { id: 'light-blue', name: 'Light blue', look: { iris: '#7896b4', inner: '#a4b4bc', fibres: 0.7, limbal: 0.6 } },
  { id: 'grey', name: 'Grey', look: { iris: '#727a80', inner: '#9a9a90', fibres: 0.6, limbal: 0.6 } },
  { id: 'steel', name: 'Steel grey', look: { iris: '#4e575e', inner: '#76786e', fibres: 0.55, limbal: 0.7 } },
  { id: 'violet-grey', name: 'Violet grey', look: { iris: '#5e5a72', inner: '#86808a', fibres: 0.6, limbal: 0.65 } },
];

export const DEFAULT_EYE_LOOK: EyeLook = {
  ...IRIS_LIBRARY[1]!.look,
  pupil: 0.3,
  sclera: '#e6ddd2',
  veins: 0.35,
  lidShadow: 0.6,
  seed: 1,
};

export function sanitiseEyeLook(raw: unknown): EyeLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EyeLook, unknown>>;
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const d = DEFAULT_EYE_LOOK;
  return {
    iris: hex(r.iris, d.iris),
    inner: hex(r.inner, d.inner),
    fibres: num(r.fibres, d.fibres, 0, 1),
    limbal: num(r.limbal, d.limbal, 0, 1),
    pupil: num(r.pupil, d.pupil, 0.15, 0.6),
    sclera: hex(r.sclera, d.sclera),
    veins: num(r.veins, d.veins, 0, 1),
    lidShadow: num(r.lidShadow, d.lidShadow, 0, 1),
    seed: Math.round(num(r.seed, d.seed, 1, 9999)),
  };
}

/** Generated eye textures are drawn at MakeHuman's eye texture size. */
export const EYE_TEXTURE_SIZE = 512;

export function eyeLookKey(look: EyeLook, catchLight: boolean): string {
  return JSON.stringify([look, catchLight]);
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Draw the eye texture (sRGB, opaque) at `size` px. `catchLight` paints the
 * wet highlight into the texture (Classic); per-pixel lighting draws a real
 * one instead.
 */
export function eyeTexture(look: EyeLook, size = EYE_TEXTURE_SIZE, catchLight = false): RgbaImage {
  const img = createImage(size, size, [0, 0, 0, 255]);
  const irisC = rgb(look.iris);
  const innerC = rgb(look.inner);
  const scleraC = rgb(look.sclera);
  const veinC: [number, number, number] = [150, 40, 40];
  const R = EYE_UV.iris;
  const seed = look.seed;
  const out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      // The nearer disc (the background between them is sclera at the edge's tone).
      const disc = Math.hypot(u - EYE_UV.discs[0].centre[0], v - EYE_UV.discs[0].centre[1]) < Math.hypot(u - EYE_UV.discs[1].centre[0], v - EYE_UV.discs[1].centre[1]) ? EYE_UV.discs[0] : EYE_UV.discs[1];
      // dx is towards the character's left (+x) on both discs, dy up.
      const dx = (u - disc.centre[0]) * (disc.mirror ? -1 : 1);
      const dy = v - disc.centre[1];
      const r = Math.hypot(dx, dy);
      const ri = r / R;
      const ang = Math.atan2(dy, dx);
      const side = disc.mirror ? 7 : 0; // each eye its own pattern
      // Sclera: warm off-white, darker and pinker towards the edge, faint veins.
      const edge = smoothstep(1.5, 2.6, ri);
      let c0 = scleraC[0] * (1 - 0.22 * edge);
      let c1 = scleraC[1] * (1 - 0.3 * edge);
      let c2 = scleraC[2] * (1 - 0.32 * edge);
      const mottling = 0.94 + 0.06 * fbm(dx * 40, dy * 40, side, seed + 3, 3);
      c0 *= mottling;
      c1 *= mottling;
      c2 *= mottling;
      if (look.veins > 0 && ri > 1.2) {
        // Veins: thin ridges of noise in polar coordinates, running in from the edge.
        const n = fbm(Math.cos(ang) * 6, Math.sin(ang) * 6, r * 14 + side, seed + 11, 3);
        const ridge = 1 - smoothstep(0, 0.035, Math.abs(n - 0.5));
        const w = look.veins * ridge * smoothstep(1.2, 2.2, ri) * (0.55 + 0.45 * valueNoise(ang * 3, side, 0, seed + 13));
        c0 = mix(c0, veinC[0], w * 0.6);
        c1 = mix(c1, veinC[1], w * 0.6);
        c2 = mix(c2, veinC[2], w * 0.6);
      }
      // Iris: radial fibres, a lighter collarette, crypts and a dark limbal ring, blended into the sclera at the limbus.
      const irisW = 1 - smoothstep(0.94, 1.04, ri);
      if (irisW > 0) {
        const fib = fbm(Math.cos(ang) * 22, Math.sin(ang) * 22, ri * 3 + side, seed + 21, 3);
        const fine = valueNoise(Math.cos(ang) * 70, Math.sin(ang) * 70, ri * 6 + side, seed + 23);
        const streak = 1 + look.fibres * ((fib - 0.5) * 1.1 + (fine - 0.5) * 0.6);
        const collarette = 1 - smoothstep(look.pupil + 0.1, look.pupil + 0.32, ri);
        const crypt = smoothstep(0.62, 0.8, fbm(Math.cos(ang) * 9, Math.sin(ang) * 9, ri * 5 + side, seed + 29, 2)) * smoothstep(look.pupil + 0.05, 0.5, ri);
        const limbal = 1 - look.limbal * smoothstep(0.72, 0.97, ri);
        const k = streak * limbal * (1 - 0.35 * crypt);
        out[0] = mix(irisC[0], innerC[0], collarette) * k;
        out[1] = mix(irisC[1], innerC[1], collarette) * k;
        out[2] = mix(irisC[2], innerC[2], collarette) * k;
        // Pupil, with a soft edge.
        const pupil = 1 - smoothstep(look.pupil - 0.03, look.pupil + 0.02, ri + 0.012 * (valueNoise(Math.cos(ang) * 8, Math.sin(ang) * 8, side, seed + 31) - 0.5));
        for (let i = 0; i < 3; i++) out[i] = mix(out[i]!, 6, pupil);
        c0 = mix(c0, out[0]!, irisW);
        c1 = mix(c1, out[1]!, irisW);
        c2 = mix(c2, out[2]!, irisW);
      }
      // Lid shadow: a ring around the part the lids leave open, and a band under the upper lid.
      if (look.lidShadow > 0) {
        const ring = smoothstep(1.3, 2.2, ri);
        // (Only on the eyeball's disc: beyond it no part of the mesh samples the texture.)
        const upper = smoothstep(0.3 * R, 0.95 * R, dy) * (1 - smoothstep(2.4, 2.7, ri));
        const s = 1 - look.lidShadow * Math.min(0.7, 0.3 * ring + 0.5 * upper);
        c0 *= s;
        c1 *= s;
        c2 *= s;
      }
      // Painted catch-light (Classic): one soft spot up and to the character's right of the pupil on both eyes,
      // and a faint second one opposite.
      if (catchLight) {
        const main = 1 - smoothstep(0.1, 0.19, Math.hypot(dx / R + 0.36, dy / R - 0.36));
        const second = 0.35 * (1 - smoothstep(0.03, 0.08, Math.hypot(dx / R - 0.42, dy / R + 0.3)));
        const w = Math.max(main, second) * irisW;
        c0 = mix(c0, 252, w);
        c1 = mix(c1, 250, w);
        c2 = mix(c2, 246, w);
      }
      const dither = (hash3(x, y, 0, seed) - 0.5) * 1.5;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(Math.min(255, Math.max(0, c0 + dither)));
      img.data[i + 1] = Math.round(Math.min(255, Math.max(0, c1 + dither)));
      img.data[i + 2] = Math.round(Math.min(255, Math.max(0, c2 + dither)));
    }
  }
  return img;
}

/** Pixel colour of an eye texture at a UV (nearest texel), for tests. */
export function eyeTexel(img: RgbaImage, u: number, v: number): [number, number, number] {
  const x = Math.min(img.width - 1, Math.floor(u * img.width));
  const y = Math.min(img.height - 1, Math.floor((1 - v) * img.height));
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}
