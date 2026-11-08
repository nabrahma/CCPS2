/**
 * Piecewise-affine warp between two point sets that share one triangulation
 * (PRD F7 step 4): a point inside triangle t of the source set maps to the
 * same barycentric position in triangle t of the target set.
 */
import { boundaryEdges } from './delaunay';

export class PiecewiseAffine {
  private readonly grid: Int32Array[];
  private readonly gx: number;
  private readonly gy: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cell: number;
  /** Hull edges of the source triangulation (pairs of point indices). */
  readonly hull: [number, number][];

  constructor(
    readonly src: Float64Array,
    readonly dst: Float64Array,
    readonly triangles: Uint32Array,
  ) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < src.length; i += 2) {
      minX = Math.min(minX, src[i]!);
      maxX = Math.max(maxX, src[i]!);
      minY = Math.min(minY, src[i + 1]!);
      maxY = Math.max(maxY, src[i + 1]!);
    }
    const count = triangles.length / 3;
    const side = Math.max(1, Math.ceil(Math.sqrt(count)));
    this.cell = Math.max(maxX - minX, maxY - minY) / side || 1;
    this.minX = minX;
    this.minY = minY;
    this.gx = Math.max(1, Math.ceil((maxX - minX) / this.cell));
    this.gy = Math.max(1, Math.ceil((maxY - minY) / this.cell));
    const buckets: number[][] = Array.from({ length: this.gx * this.gy }, () => []);
    for (let t = 0; t < count; t++) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = triangles[t * 3 + k]!;
        x0 = Math.min(x0, src[i * 2]!);
        x1 = Math.max(x1, src[i * 2]!);
        y0 = Math.min(y0, src[i * 2 + 1]!);
        y1 = Math.max(y1, src[i * 2 + 1]!);
      }
      for (let cy = this.cellY(y0); cy <= this.cellY(y1); cy++) for (let cx = this.cellX(x0); cx <= this.cellX(x1); cx++) buckets[cy * this.gx + cx]!.push(t);
    }
    this.grid = buckets.map((b) => Int32Array.from(b));
    this.hull = boundaryEdges(triangles);
  }

  private cellX(x: number): number {
    return Math.min(this.gx - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
  }

  private cellY(y: number): number {
    return Math.min(this.gy - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)));
  }

  /** Map a source point; returns false outside the triangulation. */
  map(x: number, y: number, out: Float64Array | number[]): boolean {
    const fx = (x - this.minX) / this.cell;
    const fy = (y - this.minY) / this.cell;
    if (fx < 0 || fy < 0 || fx > this.gx || fy > this.gy) return false;
    // Points on the far edge belong to the last cell.
    const cx = Math.min(this.gx - 1, Math.floor(fx));
    const cy = Math.min(this.gy - 1, Math.floor(fy));
    const s = this.src;
    for (const t of this.grid[cy * this.gx + cx]!) {
      const a = this.triangles[t * 3]!;
      const b = this.triangles[t * 3 + 1]!;
      const c = this.triangles[t * 3 + 2]!;
      const ax = s[a * 2]!;
      const ay = s[a * 2 + 1]!;
      const det = (s[b * 2]! - ax) * (s[c * 2 + 1]! - ay) - (s[c * 2]! - ax) * (s[b * 2 + 1]! - ay);
      if (Math.abs(det) < 1e-18) continue;
      const l1 = ((x - ax) * (s[c * 2 + 1]! - ay) - (s[c * 2]! - ax) * (y - ay)) / det;
      const l2 = ((s[b * 2]! - ax) * (y - ay) - (x - ax) * (s[b * 2 + 1]! - ay)) / det;
      const l0 = 1 - l1 - l2;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const d = this.dst;
      out[0] = l0 * d[a * 2]! + l1 * d[b * 2]! + l2 * d[c * 2]!;
      out[1] = l0 * d[a * 2 + 1]! + l1 * d[b * 2 + 1]! + l2 * d[c * 2 + 1]!;
      return true;
    }
    return false;
  }

  /** Distance from a source point to the nearest hull edge. */
  distanceToHull(x: number, y: number): number {
    let best = Infinity;
    const s = this.src;
    for (const [u, v] of this.hull) {
      const ax = s[u * 2]!;
      const ay = s[u * 2 + 1]!;
      const ex = s[v * 2]! - ax;
      const ey = s[v * 2 + 1]! - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * ex, y - ay - t * ey));
    }
    return best;
  }
}
