/**
 * A signed distance field of the body for the drape's contacts (F30). Contact planes taken from the nearest
 * triangle flip between the two sides of a crease (between the breasts, under the chin, at the armpit) and
 * make cloth there jitter; the distance field's normal (its gradient) turns smoothly instead.
 *
 * Two grids: a coarse one (4 cm) over the body's box with an exact signed distance at every node, and a fine
 * one (1 cm) whose nodes within 3 cm of the skin get an exact distance too (closest point on the body's
 * triangles, signed by the smooth normal there); farther fine nodes take the coarse grid's value. Distances
 * are trilinear between nodes.
 */
import type { TriangleBVH } from '../../mesh/bvh';
import type { Collider } from './xpbd';

const COARSE = 0.04;
const FINE = 0.01;
const BAND = 0.03;
const MARGIN = 0.1;

interface Grid {
  ox: number;
  oy: number;
  oz: number;
  h: number;
  nx: number;
  ny: number;
  nz: number;
  d: Float32Array;
}

function sample(g: Grid, x: number, y: number, z: number): number {
  let fx = (x - g.ox) / g.h;
  let fy = (y - g.oy) / g.h;
  let fz = (z - g.oz) / g.h;
  fx = fx < 0 ? 0 : fx > g.nx - 1.000001 ? g.nx - 1.000001 : fx;
  fy = fy < 0 ? 0 : fy > g.ny - 1.000001 ? g.ny - 1.000001 : fy;
  fz = fz < 0 ? 0 : fz > g.nz - 1.000001 ? g.nz - 1.000001 : fz;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const k = Math.floor(fz);
  const tx = fx - i;
  const ty = fy - j;
  const tz = fz - k;
  const sx = g.ny * g.nz;
  const sy = g.nz;
  const b = i * sx + j * sy + k;
  const D = g.d;
  const c00 = D[b]! * (1 - tz) + D[b + 1]! * tz;
  const c01 = D[b + sy]! * (1 - tz) + D[b + sy + 1]! * tz;
  const c10 = D[b + sx]! * (1 - tz) + D[b + sx + 1]! * tz;
  const c11 = D[b + sx + sy]! * (1 - tz) + D[b + sx + sy + 1]! * tz;
  const c0 = c00 * (1 - ty) + c01 * ty;
  const c1 = c10 * (1 - ty) + c11 * ty;
  return c0 * (1 - tx) + c1 * tx;
}

export class BodySdf implements Collider {
  private readonly coarse: Grid;
  private readonly fine: Grid;
  private readonly q = new Float64Array(3);

  constructor(
    positions: ArrayLike<number>,
    private readonly tris: ArrayLike<number>,
    private readonly normals: ArrayLike<number>,
    private readonly bvh: TriangleBVH,
  ) {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    // The box of the body's triangles' vertices.
    for (let t = 0; t < tris.length; t++) {
      const v = tris[t]!;
      x0 = Math.min(x0, positions[v * 3]!);
      x1 = Math.max(x1, positions[v * 3]!);
      y0 = Math.min(y0, positions[v * 3 + 1]!);
      y1 = Math.max(y1, positions[v * 3 + 1]!);
      z0 = Math.min(z0, positions[v * 3 + 2]!);
      z1 = Math.max(z1, positions[v * 3 + 2]!);
    }
    const make = (h: number): Grid => {
      const ox = x0 - MARGIN;
      const oy = y0 - MARGIN;
      const oz = z0 - MARGIN;
      const nx = Math.ceil((x1 + MARGIN - ox) / h) + 1;
      const ny = Math.ceil((y1 + MARGIN - oy) / h) + 1;
      const nz = Math.ceil((z1 + MARGIN - oz) / h) + 1;
      return { ox, oy, oz, h, nx, ny, nz, d: new Float32Array(nx * ny * nz) };
    };
    this.coarse = make(COARSE);
    this.fine = make(FINE);
    const c = this.coarse;
    for (let i = 0; i < c.nx; i++)
      for (let j = 0; j < c.ny; j++)
        for (let k = 0; k < c.nz; k++) c.d[(i * c.ny + j) * c.nz + k] = this.exact(c.ox + i * c.h, c.oy + j * c.h, c.oz + k * c.h, Infinity);
    const f = this.fine;
    for (let i = 0; i < f.nx; i++)
      for (let j = 0; j < f.ny; j++)
        for (let k = 0; k < f.nz; k++) {
          const x = f.ox + i * f.h;
          const y = f.oy + j * f.h;
          const z = f.oz + k * f.h;
          const dc = sample(c, x, y, z);
          // The coarse estimate is within a coarse cell's diagonal of the truth.
          f.d[(i * f.ny + j) * f.nz + k] = Math.abs(dc) > BAND + COARSE * 0.87 ? dc : this.exact(x, y, z, BAND + COARSE);
        }
  }

  /** Signed distance at a point (negative inside), exact to the surface, clamped at `maxDist`. */
  private exact(x: number, y: number, z: number, maxDist: number): number {
    this.q[0] = x;
    this.q[1] = y;
    this.q[2] = z;
    const hit = this.bvh.closestPoint(this.q, maxDist);
    if (!hit) {
      // Farther than maxDist: the coarse grid knows which side.
      const dc = sample(this.coarse, x, y, z);
      return dc >= 0 ? Math.max(dc, maxDist) : Math.min(dc, -maxDist);
    }
    const N = this.normals;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      const v = this.tris[hit.triangle * 3 + k]!;
      const b = hit.bary[k]!;
      nx += N[v * 3]! * b;
      ny += N[v * 3 + 1]! * b;
      nz += N[v * 3 + 2]! * b;
    }
    const s = (x - hit.point[0]) * nx + (y - hit.point[1]) * ny + (z - hit.point[2]) * nz;
    return s >= 0 ? hit.distance : -hit.distance;
  }

  /** Signed distance (m) at a point. */
  distance(x: number, y: number, z: number): number {
    return sample(this.fine, x, y, z);
  }

  /** Distance and outward unit normal (the field's gradient, by central differences over a fine cell). */
  closest(x: number, y: number, z: number, maxDist: number, out: Float64Array): boolean {
    const d = sample(this.fine, x, y, z);
    if (d > maxDist) return false;
    const e = FINE / 2;
    let gx = sample(this.fine, x + e, y, z) - sample(this.fine, x - e, y, z);
    let gy = sample(this.fine, x, y + e, z) - sample(this.fine, x, y - e, z);
    let gz = sample(this.fine, x, y, z + e) - sample(this.fine, x, y, z - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l === 0) return false;
    gx /= l;
    gy /= l;
    gz /= l;
    out[0] = x - gx * d;
    out[1] = y - gy * d;
    out[2] = z - gz * d;
    out[3] = gx;
    out[4] = gy;
    out[5] = gz;
    return true;
  }
}
