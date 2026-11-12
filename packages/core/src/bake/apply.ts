/**
 * Baked maps into diffuse textures (F16, F22): the exporter multiplies each
 * garment's texture by its baked occlusion, cavity and (Classic) light, so
 * Unity gets them in the one diffuse it uses. The body gets them through the
 * skin stack's baked layers instead.
 */
import type { RgbaImage } from '../skin/image';

export interface BakeStrength {
  ao: number;
  cavity: number;
  light: number;
}

/** Garment strengths: full occlusion, half cavity; light only when the light bake is on. */
export function garmentBakeStrength(bakeLight: boolean): BakeStrength {
  return { ao: 1, cavity: 0.5, light: bakeLight ? 1 : 0 };
}

/**
 * `image` times the baked map (resampled bilinearly to the image's size; both
 * rows top first, the same UV space). Alpha is kept.
 */
export function multiplyBaked(image: RgbaImage, map: RgbaImage, s: BakeStrength): RgbaImage {
  const { width: w, height: h } = image;
  const out = new Uint8ClampedArray(image.data);
  const mw = map.width;
  const mh = map.height;
  const at = (x: number, y: number, c: number) => map.data[(Math.min(mh - 1, Math.max(0, y)) * mw + Math.min(mw - 1, Math.max(0, x))) * 4 + c]! / 255;
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) / h) * mh - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) / w) * mw - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sample = (c: number) =>
        (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) + (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty;
      const ao = 1 + s.ao * (sample(0) - 1);
      const cavity = 1 + s.cavity * (sample(1) - 1);
      const light = 1 + s.light * (sample(3) - 1);
      const f = ao * cavity * light;
      const i = (y * w + x) * 4;
      out[i] = image.data[i]! * f;
      out[i + 1] = image.data[i + 1]! * f;
      out[i + 2] = image.data[i + 2]! * f;
    }
  }
  return { width: w, height: h, data: out };
}
