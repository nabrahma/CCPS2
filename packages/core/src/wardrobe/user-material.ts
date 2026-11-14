/**
 * Material Studio (Part 2 F20): your own materials for garment looks. A
 * material starts from a library material or from your images (a colour map,
 * and optionally normal, roughness, occlusion or height maps, or just one
 * photo), is adjusted, made seamless if it is not, converted to an era diffuse
 * by the same converter as the library (pbrToEra), and saved to the library
 * as `<name>.ps2mat` beside `<name>_diffuse.png`.
 */
import { createImage, resizeImage, type RgbaImage } from '../skin/image';
import { adjustHsv } from '../skin/blend';
import { aoFromHeight, channelMean, glossFromRoughness, packArm, pbrToEra, type CatalogMaterial, type MaterialKind } from './material';

export const MATERIAL_KINDS: readonly MaterialKind[] = ['leather', 'suede', 'denim', 'cotton', 'canvas', 'wool', 'knit', 'nylon', 'fur'];

/** How a material is changed before conversion. */
export interface MaterialAdjust {
  /** Hue shift, degrees. */
  hue: number;
  saturation: number;
  brightness: number;
  contrast: number;
  /** Strength of the relief (normal map), 0 flat .. 2 doubled. */
  relief: number;
  /** Strength of the occlusion, 0 none .. 2 doubled. */
  occlusion: number;
  /** Width of the seam blend for images that do not tile, as a fraction of the tile (0 = off). */
  seamless: number;
}

export const NEUTRAL_MATERIAL_ADJUST: Readonly<MaterialAdjust> = Object.freeze({ hue: 0, saturation: 1, brightness: 1, contrast: 1, relief: 1, occlusion: 1, seamless: 0 });

/** The maps a material is made from; only the colour map is required. */
export interface MaterialSources {
  albedo: RgbaImage;
  normal?: RgbaImage | null;
  /** Greyscale, white = rough. */
  roughness?: RgbaImage | null;
  /** Greyscale, white = open. */
  ao?: RgbaImage | null;
  /** Greyscale, white = high. Gives relief and occlusion when there is no normal or occlusion map. */
  height?: RgbaImage | null;
  /** glTF ARM (occlusion, roughness, metal), as the library ships them; used for missing ao and roughness. */
  arm?: RgbaImage | null;
}

/** What a user material saves (`.ps2mat`). */
export interface MaterialDoc {
  name: string;
  kind: MaterialKind;
  /** Physical size of one tile, metres. */
  tileMetres: number;
  roughness: number;
  gloss: number;
  swatch: [number, number, number];
  /** The era diffuse, a file name beside the document. */
  diffuse: string;
  diffuseSize: number;
  /** The library material it started from, or null for your images. */
  from: string | null;
  adjust: MaterialAdjust;
}

export interface MaterialFile {
  format: 'ps2cc.material/1';
  material: MaterialDoc;
}

/** User materials are converted at this size. */
export const USER_MATERIAL_SIZE = 1024;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);

export function sanitiseMaterialAdjust(raw: unknown): MaterialAdjust {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = NEUTRAL_MATERIAL_ADJUST;
  return {
    hue: num(r.hue, n.hue, -180, 180),
    saturation: num(r.saturation, n.saturation, 0, 2),
    brightness: num(r.brightness, n.brightness, 0.2, 2),
    contrast: num(r.contrast, n.contrast, 0.2, 2),
    relief: num(r.relief, n.relief, 0, 2),
    occlusion: num(r.occlusion, n.occlusion, 0, 2),
    seamless: num(r.seamless, n.seamless, 0, 0.4),
  };
}

/** Read a `.ps2mat`: every field checked. Throws when it is not one. */
export function parseMaterialFile(raw: unknown): MaterialDoc {
  const file = raw as Partial<MaterialFile> | null;
  if (!file || file.format !== 'ps2cc.material/1' || typeof file.material !== 'object' || file.material === null) throw new Error('not a PS2CC material');
  const m = file.material as Partial<MaterialDoc>;
  if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('the material has no name');
  if (typeof m.diffuse !== 'string' || !/^[\w .-]+\.(png|jpg)$/i.test(m.diffuse)) throw new Error('the material has no diffuse image');
  const sw = Array.isArray(m.swatch) ? m.swatch : [];
  return {
    name: m.name.trim().slice(0, 64),
    kind: MATERIAL_KINDS.includes(m.kind as MaterialKind) ? (m.kind as MaterialKind) : 'cotton',
    tileMetres: num(m.tileMetres, 0.3, 0.01, 4),
    roughness: num(m.roughness, 0.7, 0, 1),
    gloss: num(m.gloss, 0.1, 0, 1),
    swatch: [num(sw[0], 0.5, 0, 1), num(sw[1], 0.5, 0, 1), num(sw[2], 0.5, 0, 1)],
    diffuse: m.diffuse,
    diffuseSize: Math.round(num(m.diffuseSize, USER_MATERIAL_SIZE, 16, 4096)),
    from: typeof m.from === 'string' && m.from ? m.from.slice(0, 200) : null,
    adjust: sanitiseMaterialAdjust(m.adjust),
  };
}

/** The library entry of a user material whose diffuse is at the URL `diffuse`. */
export function userMaterial(doc: MaterialDoc, id: string, diffuse: string): CatalogMaterial {
  return {
    id,
    name: doc.name,
    kind: doc.kind,
    diffuse,
    diffuseSize: doc.diffuseSize,
    pbr: { albedo: diffuse, normal: '', arm: '', size: doc.diffuseSize },
    tileMetres: doc.tileMetres,
    roughness: doc.roughness,
    gloss: doc.gloss,
    swatch: doc.swatch,
    source: { site: 'user', asset: doc.from ?? 'your images', url: '', licence: 'user', author: '' },
  };
}

/** Hue, saturation, brightness and contrast of a colour map (contrast about mid grey, in sRGB). */
export function adjustAlbedo(img: RgbaImage, a: MaterialAdjust): RgbaImage {
  const out = createImage(img.width, img.height);
  const hsv = { hue: a.hue, saturation: a.saturation, value: 1 };
  const neutralColour = a.hue === 0 && a.saturation === 1;
  for (let i = 0; i < img.width * img.height; i++) {
    let r = img.data[i * 4]! / 255;
    let g = img.data[i * 4 + 1]! / 255;
    let b = img.data[i * 4 + 2]! / 255;
    if (!neutralColour) [r, g, b] = adjustHsv(r, g, b, hsv);
    const f = (c: number) => Math.round(255 * clamp((c - 0.5) * a.contrast + 0.5, 0, 1) * a.brightness);
    out.data[i * 4] = clamp(f(r), 0, 255);
    out.data[i * 4 + 1] = clamp(f(g), 0, 255);
    out.data[i * 4 + 2] = clamp(f(b), 0, 255);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** A normal map with its relief scaled (0 = flat). */
export function scaleNormal(img: RgbaImage, strength: number): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const x = (img.data[i * 4]! / 127.5 - 1) * strength;
    const y = (img.data[i * 4 + 1]! / 127.5 - 1) * strength;
    const z = Math.max(1e-3, img.data[i * 4 + 2]! / 127.5 - 1);
    const l = Math.hypot(x, y, z);
    out.data[i * 4] = Math.round((x / l + 1) * 127.5);
    out.data[i * 4 + 1] = Math.round((y / l + 1) * 127.5);
    out.data[i * 4 + 2] = Math.round((z / l + 1) * 127.5);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Occlusion scaled about white (0 = none, 2 = doubled). */
function scaleOcclusion(img: RgbaImage, strength: number): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const v = Math.round(255 * clamp(1 - (1 - img.data[i * 4]! / 255) * strength, 0, 1));
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Luminance as a greyscale image (a photo's stand-in height map). */
export function luminance(img: RgbaImage): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const v = Math.round(0.2126 * img.data[i * 4]! + 0.7152 * img.data[i * 4 + 1]! + 0.0722 * img.data[i * 4 + 2]!);
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** A tangent-space normal map (OpenGL, green up) from a height map, wrapping at the edges. */
export function normalFromHeight(height: RgbaImage, strength = 2): RgbaImage {
  const { width: w, height: h } = height;
  const H = (x: number, y: number) => height.data[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  const out = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Rows go down the image; +y of the normal map is up.
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = Math.round((-dx / l + 1) * 127.5);
      out.data[i + 1] = Math.round((-dy / l + 1) * 127.5);
      out.data[i + 2] = Math.round((1 / l + 1) * 127.5);
      out.data[i + 3] = 255;
    }
  return out;
}

/**
 * Make an image tile: the image is cross-faded with itself shifted by half a
 * tile, the shifted copy taking over near the edges, so the borders meet the
 * shifted copy's seamless middle. `width` is the blend band, a fraction of the
 * tile (0 returns the image unchanged).
 */
export function makeSeamless(img: RgbaImage, width: number): RgbaImage {
  if (width <= 0) return img;
  const { width: w, height: h } = img;
  const out = createImage(w, h);
  const band = Math.max(1e-3, width);
  // Weight of the original: 0 at the borders, 1 once `band` in from them.
  const edge = (t: number) => {
    const d = Math.min(t, 1 - t) / band;
    const s = clamp(d, 0, 1);
    return s * s * (3 - 2 * s);
  };
  for (let y = 0; y < h; y++) {
    const wy = edge((y + 0.5) / h);
    const sy = (y + (h >> 1)) % h;
    for (let x = 0; x < w; x++) {
      const k = Math.min(edge((x + 0.5) / w), wy);
      const i = (y * w + x) * 4;
      const j = (sy * w + ((x + (w >> 1)) % w)) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(img.data[i + c]! * k + img.data[j + c]! * (1 - k));
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * How much the seam shows when the image is tiled, 0..1. Seams that show are
 * steps in brightness or colour, not in fine texture, so each side is the mean
 * of a band a few texels wide: the step between the bands either side of the
 * wrap (last columns against first), less the step between the bands either
 * side of the middle of the image, the same measure where there is no seam.
 * The larger of the two directions, per row or column on average; 0 means
 * the seam is no more visible than the middle of the image.
 */
export function seamDifference(img: RgbaImage): number {
  const { width: w, height: h } = img;
  const step = (n: number, len: number, at: (i: number, k: number, c: number) => number) => {
    const band = Math.max(2, Math.round(n / 32));
    const mean = (from: number, i: number, c: number) => {
      let s = 0;
      for (let k = 0; k < band; k++) s += at(i, (from + k + n) % n, c);
      return s / band;
    };
    let edge = 0;
    let middle = 0;
    const half = n >> 1;
    for (let i = 0; i < len; i++)
      for (let c = 0; c < 3; c++) {
        edge += Math.abs(mean(n - band, i, c) - mean(0, i, c));
        middle += Math.abs(mean(half - band, i, c) - mean(half, i, c));
      }
    return (edge - middle) / (len * 3 * 255);
  };
  const sx = step(w, h, (y, x, c) => img.data[(y * w + x) * 4 + c]!);
  const sy = step(h, w, (x, y, c) => img.data[(y * w + x) * 4 + c]!);
  return Math.max(0, sx, sy);
}

/** Mean colour, 0..1 sRGB. */
function meanColour(img: RgbaImage): [number, number, number] {
  return [channelMean(img, 0), channelMean(img, 1), channelMean(img, 2)].map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
}

const square = (img: RgbaImage, size: number) => (img.width === size && img.height === size ? img : resizeImage(img, size, size));

/** What the converter makes of a material's sources. */
export interface ConvertedMaterial {
  diffuse: RgbaImage;
  roughness: number;
  gloss: number;
  swatch: [number, number, number];
}

/**
 * Convert sources to an era diffuse at `size`: adjust the colour, make every
 * map seamless if asked, derive relief and occlusion from a height map (or the
 * colour map's luminance, for a single photo), scale them, then pbrToEra.
 */
export function convertMaterial(src: MaterialSources, adjust: MaterialAdjust, size = USER_MATERIAL_SIZE): ConvertedMaterial {
  const fit = (img: RgbaImage | null | undefined) => (img ? makeSeamless(square(img, size), adjust.seamless) : null);
  const albedo = adjustAlbedo(fit(src.albedo)!, adjust);
  const arm = fit(src.arm);
  const photoOnly = !src.normal && !src.height && !src.ao && !arm;
  const height = fit(src.height) ?? (photoOnly ? luminance(fit(src.albedo)!) : null);
  const normalIn = fit(src.normal) ?? (height ? normalFromHeight(height, photoOnly ? 1.5 : 3) : null);
  const normal = normalIn ? scaleNormal(normalIn, adjust.relief) : flatNormal(size);
  const aoIn = fit(src.ao) ?? (arm ? channelImage(arm, 0) : height ? aoFromHeight(height) : null);
  const ao = aoIn ? scaleOcclusion(aoIn, adjust.occlusion) : null;
  const rough = fit(src.roughness) ?? (arm ? channelImage(arm, 1) : null);
  const diffuse = pbrToEra({ albedo, normal, arm: packArm(size, size, ao, rough) });
  const roughness = rough ? Math.round(channelMean(rough, 0) * 1000) / 1000 : 0.8;
  return { diffuse, roughness, gloss: glossFromRoughness(roughness), swatch: meanColour(diffuse) };
}

function flatNormal(size: number): RgbaImage {
  return createImage(size, size, [128, 128, 255, 255]);
}

/** One channel of an image as greyscale. */
function channelImage(img: RgbaImage, c: number): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const v = img.data[i * 4 + c]!;
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** A material file for a converted material. */
export function materialFile(name: string, kind: MaterialKind, tileMetres: number, converted: ConvertedMaterial, diffuse: string, from: string | null, adjust: MaterialAdjust): MaterialFile {
  return {
    format: 'ps2cc.material/1',
    material: {
      name,
      kind,
      tileMetres,
      roughness: converted.roughness,
      gloss: converted.gloss,
      swatch: converted.swatch,
      diffuse,
      diffuseSize: converted.diffuse.width,
      from,
      adjust: { ...adjust },
    },
  };
}
