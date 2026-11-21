/**
 * Colliders for the drape (F30): the body (closest point on its triangles from a BVH, with the smooth
 * normal there pointing out), and analytic shapes for the solver's tests.
 */
import { TriangleBVH } from '../../mesh/bvh';
import type { Collider } from './xpbd';

export class MeshCollider implements Collider {
  readonly bvh: TriangleBVH;
  private readonly p = new Float64Array(3);

  /** `positions` and `normals` per vertex (smooth, outward), `tris` a closed triangle mesh. */
  constructor(
    readonly positions: ArrayLike<number>,
    readonly tris: ArrayLike<number>,
    readonly normals: ArrayLike<number>,
    bvh?: TriangleBVH,
  ) {
    this.bvh = bvh ?? new TriangleBVH(positions, tris);
  }

  closest(x: number, y: number, z: number, maxDist: number, out: Float64Array): boolean {
    this.p[0] = x;
    this.p[1] = y;
    this.p[2] = z;
    const hit = this.bvh.closestPoint(this.p, maxDist);
    if (!hit) return false;
    const t = hit.triangle;
    const N = this.normals;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      const v = this.tris[t * 3 + k]!;
      const b = hit.bary[k]!;
      nx += N[v * 3]! * b;
      ny += N[v * 3 + 1]! * b;
      nz += N[v * 3 + 2]! * b;
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[0] = hit.point[0];
    out[1] = hit.point[1];
    out[2] = hit.point[2];
    out[3] = nx / l;
    out[4] = ny / l;
    out[5] = nz / l;
    return true;
  }
}

/** An infinite vertical cylinder (axis through (cx, cz)), for tests. */
export class CylinderCollider implements Collider {
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly radius: number,
  ) {}

  closest(x: number, _y: number, z: number, maxDist: number, out: Float64Array): boolean {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r - this.radius > maxDist || r === 0) return false;
    const nx = dx / r;
    const nz = dz / r;
    out[0] = this.cx + nx * this.radius;
    out[1] = _y;
    out[2] = this.cz + nz * this.radius;
    out[3] = nx;
    out[4] = 0;
    out[5] = nz;
    return true;
  }
}
