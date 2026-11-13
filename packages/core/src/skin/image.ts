/**
 * Small RGBA image type and the pixel operations the skin stack needs
 * (sampling, resizing, sharpening, cropping). Pure TypeScript, so the same
 * code runs in Node tests, the app and the exporter.
 *
 * Convention (same as the textures and D-027): row 0 is the top of the image,
 * which is UV v = 1. The centre of pixel (x, y) is UV ((x + 0.5) / w, 1 - (y + 0.5) / h).
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, rows top first, not premultiplied. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function createImage(width: number, height: number, fill?: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill && fill.some((c) => c !== 0)) for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

/** Wrap existing pixels (copied into a fresh buffer). */
export function imageFrom(width: number, height: number, pixels: ArrayLike<number>): RgbaImage {
  if (pixels.length !== width * height * 4) throw new Error(`expected ${width}x${height} RGBA pixels, got ${pixels.length / 4}`);
  const data = new Uint8ClampedArray(width * height * 4);
  data.set(pixels);
  return { width, height, data };
}

/** UV of the centre of pixel (x, y) in an image of the given size. */
export function texelUv(x: number, y: number, width: number, height: number): [number, number] {
  return [(x + 0.5) / width, 1 - (y + 0.5) / height];
}

/**
 * Bilinear sample at UV (clamp to edge), the same filter as GL LINEAR:
 * texel centres sit at half-pixel offsets. Writes 0..255 floats into `out`.
 */
export function sampleBilinear(img: RgbaImage, u: number, v: number, out: Float32Array | number[]): void {
  const fx = u * img.width - 0.5;
  const fy = (1 - v) * img.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const cx0 = clampInt(x0, img.width);
  const cx1 = clampInt(x0 + 1, img.width);
  const cy0 = clampInt(y0, img.height);
  const cy1 = clampInt(y0 + 1, img.height);
  const d = img.data;
  const w = img.width;
  const i00 = (cy0 * w + cx0) * 4;
  const i10 = (cy0 * w + cx1) * 4;
  const i01 = (cy1 * w + cx0) * 4;
  const i11 = (cy1 * w + cx1) * 4;
  for (let k = 0; k < 4; k++) {
    const top = d[i00 + k]! + (d[i10 + k]! - d[i00 + k]!) * tx;
    const bottom = d[i01 + k]! + (d[i11 + k]! - d[i01 + k]!) * tx;
    out[k] = top + (bottom - top) * ty;
  }
}

/** Sample with pixel coordinates (x right, y down, pixel centres at +0.5), clamp to edge. */
export function samplePixel(img: RgbaImage, px: number, py: number, out: Float32Array | number[]): void {
  sampleBilinear(img, px / img.width, 1 - py / img.height, out);
}

function clampInt(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Resize with a box prefilter when shrinking (average of the covered source
 * pixels) and bilinear when growing. Shrinking by an integer factor is an
 * exact box average.
 */
export function resizeImage(src: RgbaImage, width: number, height: number): RgbaImage {
  if (width === src.width && height === src.height) return imageFrom(width, height, src.data);
  const out = createImage(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  const tmp = [0, 0, 0, 0];
  if (sx <= 1 && sy <= 1) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [u, v] = texelUv(x, y, width, height);
        sampleBilinear(src, u, v, tmp);
        out.data.set(tmp, (y * width + x) * 4);
      }
    }
    return out;
  }
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      // Colour is weighted by alpha, so transparent texels (often black) do not darken the edges
      // of cutouts such as hair strands; alpha itself is a plain average. Opaque images are unaffected.
      const acc = [0, 0, 0, 0];
      const accA = [0, 0, 0];
      let wsum = 0;
      let asum = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (wy <= 0 || py >= src.height) continue;
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const wx = Math.min(x1, px + 1) - Math.max(x0, px);
          if (wx <= 0 || px >= src.width) continue;
          const w = wx * wy;
          const i = (py * src.width + px) * 4;
          const wa = w * src.data[i + 3]!;
          for (let k = 0; k < 4; k++) acc[k]! += src.data[i + k]! * w;
          for (let k = 0; k < 3; k++) accA[k]! += src.data[i + k]! * wa;
          wsum += w;
          asum += wa;
        }
      }
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) out.data[o + k] = asum > 0 ? accA[k]! / asum : acc[k]! / wsum;
      out.data[o + 3] = acc[3]! / wsum;
    }
  }
  return out;
}

/**
 * Mild unsharp mask on RGB (PRD F6: "downscales on export, bilinear plus a
 * mild sharpen"): out = in + amount * (in - blur3x3(in)). Alpha is kept.
 */
export function sharpen(src: RgbaImage, amount = 0.35): RgbaImage {
  const { width: w, height: h, data: d } = src;
  const out = imageFrom(w, h, d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = clampInt(y + dy, h);
          for (let dx = -1; dx <= 1; dx++) sum += d[(yy * w + clampInt(x + dx, w)) * 4 + k]! * (dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1);
        }
        const blur = sum / 16;
        out.data[i + k] = d[i + k]! + amount * (d[i + k]! - blur);
      }
    }
  }
  return out;
}

/** Copy a source rectangle (pixel units, may be fractional) into a destination rectangle, resampled. */
export function blitResampled(
  src: RgbaImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dst: RgbaImage,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const tmp = [0, 0, 0, 0];
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(dst.width, Math.ceil(dx + dw));
  const y1 = Math.min(dst.height, Math.ceil(dy + dh));
  // Shrinking more than 2x: box-filter the source first so the copy does not alias.
  const factor = Math.max(1, Math.floor(Math.min(sw / dw, sh / dh)));
  let source = src;
  let scale = 1;
  if (factor >= 2) {
    source = resizeImage(src, Math.max(1, Math.round(src.width / factor)), Math.max(1, Math.round(src.height / factor)));
    scale = source.width / src.width;
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = (sx + ((x + 0.5 - dx) / dw) * sw) * scale;
      const py = (sy + ((y + 0.5 - dy) / dh) * sh) * scale;
      samplePixel(source, px, py, tmp);
      dst.data.set(tmp, (y * dst.width + x) * 4);
    }
  }
}

/**
 * Grow opaque pixels into transparent ones (RGB only, alpha untouched), so
 * bilinear filtering and mipmaps at island edges do not pull in black.
 * `coverage[i] > 0` marks pixels that hold real colour.
 */
export function dilateRgb(img: RgbaImage, coverage: Uint8Array, passes: number, channels: 3 | 4 = 3): void {
  const { width: w, height: h, data: d } = img;
  let filled = coverage.slice();
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let n = 0;
        const acc = [0, 0, 0, 0];
        for (const [ox, oy] of NEIGHBOURS) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!filled[j]) continue;
          for (let k = 0; k < channels; k++) acc[k]! += d[j * 4 + k]!;
          n++;
        }
        if (n === 0) continue;
        for (let k = 0; k < channels; k++) d[i * 4 + k] = acc[k]! / n;
        next[i] = 1;
      }
    }
    filled = next;
  }
}

const NEIGHBOURS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/** Separable box blur of a single-channel float map, `radius` pixels, `passes` times (≈ Gaussian). */
export function blurChannel(src: Float32Array, w: number, h: number, radius: number, passes = 2): Float32Array {
  let a = src.slice();
  let b = new Float32Array(a.length);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return a;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + clampInt(x, w)]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + clampInt(x + r + 1, w)]! - a[y * w + clampInt(x - r, w)]!;
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += a[clampInt(y, h) * w + x]!;
      for (let y = 0; y < h; y++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[clampInt(y + r + 1, h) * w + x]! - a[clampInt(y - r, h) * w + x]!;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}
