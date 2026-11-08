/**
 * UV templates (PRD F4/F5: "Export UV template": a 1024 px PNG with the UV
 * wireframe over the current texture) so users can paint textures that fit.
 * Pure rasterisation into an RGBA buffer; the app encodes it to PNG.
 *
 * Image convention: row 0 is the top, UV v = 1 (the same as the textures,
 * which the viewport loads with flipY).
 */

export type Rgba = [number, number, number, number];

export interface UvTemplateOptions {
  /** Width and height in pixels (default 1024). */
  size?: number;
  /** size x size RGBA pixels to draw over (the current texture); default a dark fill. */
  background?: Uint8Array | Uint8ClampedArray;
  line?: Rgba;
  fill?: Rgba;
}

export const UV_TEMPLATE_LINE: Rgba = [255, 64, 160, 255];
const DEFAULT_FILL: Rgba = [24, 24, 28, 255];

/** Unique UV edges of quad faces (4 UV indices per face; triangles repeat the last). */
export function uvEdges(faceUvs: ArrayLike<number>): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let f = 0; f < faceUvs.length; f += 4) {
    const q = [faceUvs[f]!, faceUvs[f + 1]!, faceUvs[f + 2]!, faceUvs[f + 3]!];
    const corners = q[3] === q[2] ? q.slice(0, 3) : q;
    for (let k = 0; k < corners.length; k++) {
      const a = corners[k]!;
      const b = corners[(k + 1) % corners.length]!;
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

/** UV (0..1, v up) to continuous image coordinates (0..size, y down). */
export function uvToImage(u: number, v: number, size: number): [number, number] {
  return [u * size, (1 - v) * size];
}

/** The pixel containing a continuous image coordinate (UV 1.0 maps to the last pixel). */
export function pixelOf(x: number, size: number): number {
  return Math.min(size - 1, Math.floor(x));
}

/** Render the UV wireframe of a mesh into a new RGBA buffer of size x size. */
export function renderUvTemplate(uvs: ArrayLike<number>, faceUvs: ArrayLike<number>, opts: UvTemplateOptions = {}): Uint8ClampedArray<ArrayBuffer> {
  const size = opts.size ?? 1024;
  const out = new Uint8ClampedArray(size * size * 4);
  if (opts.background) {
    if (opts.background.length !== out.length) throw new Error(`background must be ${size}x${size} RGBA`);
    out.set(opts.background);
  } else {
    const fill = opts.fill ?? DEFAULT_FILL;
    for (let i = 0; i < size * size; i++) out.set(fill, i * 4);
  }
  const line = opts.line ?? UV_TEMPLATE_LINE;
  for (const [a, b] of uvEdges(faceUvs)) {
    const [x0, y0] = uvToImage(uvs[a * 2]!, uvs[a * 2 + 1]!, size);
    const [x1, y1] = uvToImage(uvs[b * 2]!, uvs[b * 2 + 1]!, size);
    drawLine(out, size, x0, y0, x1, y1, line);
  }
  return out;
}

/** 1 px DDA line in continuous image coordinates, clipped to the image. Both endpoints are drawn. */
function drawLine(img: Uint8ClampedArray, size: number, x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const fx = x0 + (x1 - x0) * t;
    const fy = y0 + (y1 - y0) * t;
    if (fx < 0 || fy < 0 || fx > size || fy > size) continue;
    const x = pixelOf(fx, size);
    const y = pixelOf(fy, size);
    img.set(c, (y * size + x) * 4);
  }
}
