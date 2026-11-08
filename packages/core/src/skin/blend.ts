/**
 * Skin layer compositing (PRD F6): reference implementation.
 *
 * The viewport composites on the GPU (packages/viewport/src/skin-compositor.ts)
 * and must match this code; the M6 acceptance test checks it pixel by pixel.
 * The rules, chosen to match how image editors treat 8-bit layers:
 *  - Colours are blended as stored (sRGB-encoded 0..1), not linearised.
 *  - result = below + (B(below, layer) - below) * a, a = layer alpha * opacity * mask.
 *  - B is normal: s; multiply: b*s; screen: 1-(1-b)(1-s);
 *    overlay: b < 0.5 ? 2bs : 1-2(1-b)(1-s).
 *  - Adjustment layers (tone tint) compute s from the colour below
 *    (hue shift, saturation and value scale in HSV).
 *  - Layers are applied bottom to top ("top wins"); each step is rounded to
 *    8 bits, as an 8-bit render target does.
 *  - The base alpha is forced to opaque.
 */
import type { BlendMode, RegionMask } from '../character/doc';
import { sampleBilinear, texelUv, type RgbaImage } from './image';

export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'overlay', 'screen'];
export const BLEND_MODE_ID: Record<BlendMode, number> = { normal: 0, multiply: 1, overlay: 2, screen: 3 };
/** Channel of the region-mask image per mask (-1: no mask). */
export const MASK_CHANNEL: Record<RegionMask, number> = { none: -1, face: 0, body: 1, hands: 2 };

export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return b * s;
    case 'screen':
      return 1 - (1 - b) * (1 - s);
    case 'overlay':
      return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    default:
      return s;
  }
}

/** HSV adjustment: hue shift in degrees, saturation and value multipliers. */
export interface HsvAdjust {
  hue: number;
  saturation: number;
  value: number;
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max > 1e-6 ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  // The same branch-free form as the shader: k = (n + 6h) mod 6, c = v - v*s*clamp(min(k, 4-k), 0, 1).
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(1, Math.min(k, 4 - k)));
  };
  return [f(5), f(3), f(1)];
}

export function adjustHsv(r: number, g: number, b: number, adj: HsvAdjust): [number, number, number] {
  const [h, s, v] = rgbToHsv(r, g, b);
  let nh = h + adj.hue / 360;
  nh -= Math.floor(nh);
  return hsvToRgb(nh, Math.min(1, Math.max(0, s * adj.saturation)), Math.min(1, Math.max(0, v * adj.value)));
}

/** A layer ready to composite: pixels or an adjustment, plus how to blend it. */
export type CompositeSource = { kind: 'pixels'; image: RgbaImage } | { kind: 'adjust'; hsv: HsvAdjust };

export interface CompositeLayer {
  source: CompositeSource;
  blend: BlendMode;
  opacity: number;
  mask: RegionMask;
}

/**
 * Composite a layer stack at size x size. Every input is sampled bilinearly at
 * texel centres (GL LINEAR, clamp to edge), so inputs of the composite size are
 * read texel for texel.
 */
export function compositeReference(base: RgbaImage, layers: readonly CompositeLayer[], masks: RgbaImage | null, size: number): RgbaImage {
  const n = size * size;
  const acc = new Uint8ClampedArray(n * 4);
  const tmp = [0, 0, 0, 0];
  const mtmp = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [u, v] = texelUv(x, y, size, size);
      sampleBilinear(base, u, v, tmp);
      const i = (y * size + x) * 4;
      acc[i] = Math.round(tmp[0]!);
      acc[i + 1] = Math.round(tmp[1]!);
      acc[i + 2] = Math.round(tmp[2]!);
      acc[i + 3] = 255;
    }
  }
  for (const layer of layers) {
    if (layer.opacity <= 0) continue;
    const ch = MASK_CHANNEL[layer.mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const [u, v] = texelUv(x, y, size, size);
        let m = 1;
        if (ch >= 0 && masks) {
          sampleBilinear(masks, u, v, mtmp);
          m = Math.round(mtmp[ch]!) / 255;
        }
        const b0 = acc[i]! / 255;
        const b1 = acc[i + 1]! / 255;
        const b2 = acc[i + 2]! / 255;
        let s: [number, number, number];
        let a: number;
        if (layer.source.kind === 'adjust') {
          s = adjustHsv(b0, b1, b2, layer.source.hsv);
          a = 1;
        } else {
          sampleBilinear(layer.source.image, u, v, tmp);
          s = [Math.round(tmp[0]!) / 255, Math.round(tmp[1]!) / 255, Math.round(tmp[2]!) / 255];
          a = Math.round(tmp[3]!) / 255;
        }
        const w = a * layer.opacity * m;
        if (w <= 0) continue;
        acc[i] = Math.round((b0 + (blendChannel(layer.blend, b0, s[0]) - b0) * w) * 255);
        acc[i + 1] = Math.round((b1 + (blendChannel(layer.blend, b1, s[1]) - b1) * w) * 255);
        acc[i + 2] = Math.round((b2 + (blendChannel(layer.blend, b2, s[2]) - b2) * w) * 255);
      }
    }
  }
  return { width: size, height: size, data: acc };
}
