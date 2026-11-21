/**
 * Deterministic skyline packing of rectangles (F31: pattern pieces into the garment atlas at one texel
 * density). Rectangles go in order of decreasing height (ties: wider first, then input order), each at the
 * lowest position along the skyline where it fits, leftmost on ties. The atlas width is the square root of
 * the total area times a factor; the result is scaled into the unit square by its larger side.
 */
export interface PackRect {
  w: number;
  h: number;
}

export interface Packed {
  /** Lower-left corner of each rectangle, in the packing's units. */
  x: Float64Array;
  y: Float64Array;
  width: number;
  height: number;
}

function skyline(rects: readonly PackRect[], width: number): Packed {
  const order = rects.map((_, i) => i).sort((a, b) => rects[b]!.h - rects[a]!.h || rects[b]!.w - rects[a]!.w || a - b);
  // Skyline segments: [x, y, w].
  let sky: [number, number, number][] = [[0, 0, width]];
  const x = new Float64Array(rects.length);
  const y = new Float64Array(rects.length);
  let height = 0;
  let maxW = width;
  for (const i of order) {
    const r = rects[i]!;
    let bestX = 0;
    let bestY = Infinity;
    for (let s = 0; s < sky.length; s++) {
      const sx = sky[s]![0];
      if (sx + r.w > width + 1e-9 && s > 0) continue;
      // The height under [sx, sx + w].
      let top = 0;
      let covered = 0;
      for (let k = s; k < sky.length && covered < r.w - 1e-12; k++) {
        top = Math.max(top, sky[k]![1]);
        covered = sky[k]![0] + sky[k]![2] - sx;
      }
      if (top < bestY - 1e-12) {
        bestY = top;
        bestX = sx;
      }
    }
    x[i] = bestX;
    y[i] = bestY;
    height = Math.max(height, bestY + r.h);
    maxW = Math.max(maxW, bestX + r.w);
    // Raise the skyline under the rectangle.
    const x0 = bestX;
    const x1 = bestX + r.w;
    const next: [number, number, number][] = [];
    for (const [sx, sy, sw] of sky) {
      const e = sx + sw;
      if (e <= x0 || sx >= x1) {
        next.push([sx, sy, sw]);
        continue;
      }
      if (sx < x0) next.push([sx, sy, x0 - sx]);
      if (e > x1) next.push([x1, sy, e - x1]);
    }
    next.push([x0, bestY + r.h, r.w]);
    next.sort((a, b) => a[0] - b[0]);
    // Merge neighbours at the same height.
    sky = [];
    for (const seg of next) {
      const last = sky[sky.length - 1];
      if (last && Math.abs(last[1] - seg[1]) < 1e-12 && Math.abs(last[0] + last[2] - seg[0]) < 1e-12) last[2] += seg[2];
      else sky.push([seg[0], seg[1], seg[2]]);
    }
  }
  return { x, y, width: maxW, height };
}

/** Pack into the most nearly square layout of a few candidate widths. */
export function packRects(rects: readonly PackRect[]): Packed {
  let area = 0;
  let widest = 0;
  for (const r of rects) {
    area += r.w * r.h;
    widest = Math.max(widest, r.w);
  }
  let best: Packed | null = null;
  for (const f of [0.9, 1, 1.1, 1.2, 1.35, 1.5]) {
    const p = skyline(rects, Math.max(widest, Math.sqrt(area) * f));
    if (!best || Math.max(p.width, p.height) < Math.max(best.width, best.height) - 1e-12) best = p;
  }
  return best!;
}
