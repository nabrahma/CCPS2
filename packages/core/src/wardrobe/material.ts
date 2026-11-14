/**
 * Material library (Part 2 F18): CC0 PBR materials turned into the era's one
 * diffuse texture.
 *
 * `pbrToEra` bakes a material's albedo, normal map and occlusion under one
 * fixed soft top light into a single tileable diffuse, so a garment drawn with
 * it unlit (Classic) or lit flat still shows the weave, grain and creases
 * that the normal map carried. The lighting is normalised so that a flat
 * texel keeps its albedo: the era diffuse is the albedo times how much more or
 * less light that texel gets than flat cloth, times occlusion and cavity.
 *
 * The light is the same one the SSIM check renders the PBR original under
 * (`ERA_LIGHT`): a directional key from above and in front of the surface,
 * and a hemisphere fill. Directions are in the texture's tangent space:
 * +x right, +y up (towards v = 1), +z out of the surface.
 */
import type { RgbaImage } from '../skin/image';
import { createImage } from '../skin/image';

export type MaterialKind = 'leather' | 'suede' | 'denim' | 'cotton' | 'canvas' | 'wool' | 'knit' | 'nylon' | 'fur';

export interface CatalogMaterial {
  /** e.g. "ps2cc:materials/leather_smooth" */
  id: string;
  name: string;
  kind: MaterialKind;
  /** The era diffuse (tileable), relative to assets/core. */
  diffuse: string;
  diffuseSize: number;
  /** The PBR maps it was made from, kept at 1024 for the in-app reference render. */
  pbr: { albedo: string; normal: string; arm: string; size: number };
  /** Physical size of one tile, metres. */
  tileMetres: number;
  /** Mean roughness of the source (0 smooth .. 1 rough). */
  roughness: number;
  /** Specular strength used for the material's surfaces (F14 gloss). */
  gloss: number;
  /** Mean colour of the era diffuse, 0..1 sRGB (for swatches and flat fallbacks). */
  swatch: [number, number, number];
  /** Where it comes from: a CC0 site for the library, 'user' for Material Studio's (never shipped with the app). */
  source: { site: 'Poly Haven' | 'ambientCG'; asset: string; url: string; licence: 'CC0-1.0'; author: string } | { site: 'user'; asset: string; url: ''; licence: 'user'; author: '' };
}

export interface EraLight {
  /** Unit direction towards the key light, tangent space. */
  key: [number, number, number];
  keyIntensity: number;
  sky: number;
  ground: number;
  /** Cavity darkening from the normal map's concavity, 0..1. */
  cavity: number;
}

/** The fixed soft top light (F18): key from above and in front, hemisphere fill. */
export const ERA_LIGHT: EraLight = (() => {
  const k: [number, number, number] = [0, 0.55, 0.835];
  const n = Math.hypot(...k);
  return { key: [k[0] / n, k[1] / n, k[2] / n], keyIntensity: 2.2, sky: 0.9, ground: 0.35, cavity: 0.5 };
})();

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Light reaching a texel whose normal is n (tangent space), with occlusion
 * `ao` on the fill: the key's N.L plus the hemisphere (up is +y), the model
 * three.js uses for a DirectionalLight and a HemisphereLight.
 */
export function eraIrradiance(n: readonly [number, number, number], ao: number, light: EraLight = ERA_LIGHT): number {
  const ndl = Math.max(0, n[0] * light.key[0] + n[1] * light.key[1] + n[2] * light.key[2]);
  const hemi = light.ground + (light.sky - light.ground) * (0.5 + 0.5 * n[1]);
  return light.keyIntensity * ndl + ao * hemi;
}

export interface PbrMaps {
  albedo: RgbaImage;
  /** OpenGL convention (green up). */
  normal: RgbaImage;
  /** R = ambient occlusion, G = roughness, B = metalness (glTF ARM). */
  arm: RgbaImage;
}

/**
 * The era diffuse of a PBR material: albedo x irradiance(n, ao) /
 * irradiance(flat, 1) x cavity, in linear light, back to sRGB. All maps the
 * same size; the result is that size and tiles like its inputs.
 */
export function pbrToEra(maps: PbrMaps, light: EraLight = ERA_LIGHT): RgbaImage {
  const { width: w, height: h } = maps.albedo;
  for (const m of [maps.normal, maps.arm]) if (m.width !== w || m.height !== h) throw new Error('PBR maps must be the same size');
  const flat = eraIrradiance([0, 0, 1], 1, light);
  const out = createImage(w, h);
  const nx = new Float32Array(w * h);
  const ny = new Float32Array(w * h);
  const nz = new Float32Array(w * h);
  const N = maps.normal.data;
  for (let i = 0; i < w * h; i++) {
    let x = N[i * 4]! / 127.5 - 1;
    let y = N[i * 4 + 1]! / 127.5 - 1;
    let z = N[i * 4 + 2]! / 127.5 - 1;
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    nx[i] = x;
    ny[i] = y;
    nz[i] = z;
  }
  const A = maps.albedo.data;
  const R = maps.arm.data;
  const n: [number, number, number] = [0, 0, 1];
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w;
    const yd = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Concavity: the normals' divergence (wrapping, so the tile stays seamless). Rows go down, +y goes up.
      const xl = (x - 1 + w) % w;
      const xr = (x + 1) % w;
      const div = (nx[y * w + xr]! - nx[y * w + xl]!) * 0.5 + (ny[yu + x]! - ny[yd + x]!) * 0.5;
      const cavity = 1 - light.cavity * Math.min(1, Math.max(0, div * 2));
      n[0] = nx[i]!;
      n[1] = ny[i]!;
      n[2] = nz[i]!;
      const ao = R[i * 4]! / 255;
      const f = (eraIrradiance(n, ao, light) / flat) * cavity;
      for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(255 * toSrgb(Math.min(1, toLinear(A[i * 4 + c]! / 255) * f)));
      out.data[i * 4 + 3] = 255;
    }
  }
  return out;
}

/**
 * Occlusion from a height map, for materials shipped without one (ambientCG
 * leathers): how far each texel sits below the mean of its neighbourhood.
 * Returns a single-channel image in R (G, B copy it).
 */
export function aoFromHeight(height: RgbaImage, radius = 6, strength = 2.5): RgbaImage {
  const { width: w, height: h } = height;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = height.data[i * 4]! / 255;
  // Box blur with wrap, separable.
  const tmp = new Float32Array(w * h);
  const blur = new Float32Array(w * h);
  const span = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += H[y * w + ((k + w) % w)]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / span;
      s += H[y * w + ((x + radius + 1) % w)]! - H[y * w + ((x - radius + w) % w)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += tmp[((k + h) % h) * w + x]!;
    for (let y = 0; y < h; y++) {
      blur[y * w + x] = s / span;
      s += tmp[((y + radius + 1) % h) * w + x]! - tmp[((y - radius + h) % h) * w + x]!;
    }
  }
  const out = createImage(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(255 * Math.max(0, Math.min(1, 1 - strength * Math.max(0, blur[i]! - H[i]!))));
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Build an ARM image from separate occlusion and roughness maps (either may be missing). */
export function packArm(width: number, height: number, ao: RgbaImage | null, roughness: RgbaImage | null): RgbaImage {
  const out = createImage(width, height);
  for (let i = 0; i < width * height; i++) {
    out.data[i * 4] = ao ? ao.data[i * 4]! : 255;
    out.data[i * 4 + 1] = roughness ? roughness.data[i * 4]! : 200;
    out.data[i * 4 + 2] = 0;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Mean of a channel, 0..1. */
export function channelMean(img: RgbaImage, c: number): number {
  let s = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) s += img.data[i * 4 + c]!;
  return s / n / 255;
}

/** Gloss (F14's specular strength) from mean roughness: smooth leather shines, cloth hardly does. */
export function glossFromRoughness(roughness: number): number {
  return Math.round(Math.max(0.02, Math.min(0.6, (1 - roughness) ** 2 * 0.9)) * 100) / 100;
}

/**
 * Box-filtered mip chain of a square power-of-two tile (wraps, so every level
 * still tiles). Level 0 is the tile itself.
 */
export function tileMips(tile: RgbaImage): RgbaImage[] {
  const out = [tile];
  let cur = tile;
  while (cur.width > 1 && cur.height > 1) {
    const w = cur.width >> 1;
    const h = cur.height >> 1;
    const next = createImage(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          const a = (y * 2 * cur.width + x * 2) * 4 + c;
          const b = a + cur.width * 4;
          next.data[(y * w + x) * 4 + c] = (cur.data[a]! + cur.data[a + 4]! + cur.data[b]! + cur.data[b + 4]! + 2) >> 2;
        }
    out.push(next);
    cur = next;
  }
  return out;
}

/** The mip level whose texels are about as big as `texelsPerTile` output texels across one tile. */
export function mipFor(mips: readonly RgbaImage[], texelsPerTile: number): RgbaImage {
  let level = 0;
  while (level + 1 < mips.length && mips[level]!.width > texelsPerTile * 1.4) level++;
  return mips[level]!;
}
