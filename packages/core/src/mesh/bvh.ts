/**
 * Bounding volume hierarchy over an indexed triangle mesh, for ray casts and
 * closest-point queries (hidden-face coverage, poke-through checks, garment
 * collision anchors). Median split on the longest centroid axis; nodes are
 * stored in flat typed arrays. Positions can be refitted in place when the
 * mesh deforms without changing topology.
 */

export interface RayHit {
  triangle: number;
  /** Distance along the (unit) ray direction. */
  t: number;
  /** Barycentric weights of the triangle's second and third vertex. */
  u: number;
  v: number;
}

export interface ClosestHit {
  triangle: number;
  distance: number;
  /** Closest point on the surface. */
  point: [number, number, number];
  /** Barycentric weights of the triangle's three vertices. */
  bary: [number, number, number];
}

const LEAF_SIZE = 4;

export class TriangleBVH {
  readonly triangleCount: number;
  /** min xyz, max xyz per node. */
  private bounds: Float32Array;
  /** Leaf: [first, -count]; inner: [left, right]. */
  private links: Int32Array;
  /** Triangle order referenced by the leaves. */
  private order: Uint32Array;
  private nodeCount = 0;

  constructor(
    private positions: ArrayLike<number>,
    readonly indices: ArrayLike<number>,
  ) {
    const n = indices.length / 3;
    this.triangleCount = n;
    const maxNodes = Math.max(1, 2 * n); // binary tree with non-empty leaves: < 2n nodes
    this.bounds = new Float32Array(maxNodes * 6);
    this.links = new Int32Array(maxNodes * 2);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    const centroids = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        centroids[t * 3 + k] =
          (positions[indices[t * 3]! * 3 + k]! + positions[indices[t * 3 + 1]! * 3 + k]! + positions[indices[t * 3 + 2]! * 3 + k]!) / 3;
      }
    }
    if (n > 0) this.build(0, n, centroids);
  }

  /** The positions the hierarchy was built (or last refitted) on. */
  get positionsView(): ArrayLike<number> {
    return this.positions;
  }

  /** Recompute node bounds after the positions changed (same topology). */
  refit(positions: ArrayLike<number> = this.positions): void {
    this.positions = positions;
    for (let node = this.nodeCount - 1; node >= 0; node--) this.computeBounds(node);
  }

  /** Closest hit along a ray with a unit direction, for t in [tMin, tMax]; both faces count. */
  raycast(o: ArrayLike<number>, d: ArrayLike<number>, tMin: number, tMax: number, accept?: (hit: RayHit) => boolean): RayHit | null {
    if (this.nodeCount === 0) return null;
    const inv = [1 / d[0]!, 1 / d[1]!, 1 / d[2]!];
    let best: RayHit | null = null;
    let far = tMax;
    const stack: number[] = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (!this.rayBox(node, o, inv, tMin, far)) continue;
      const a = this.links[node * 2]!;
      const b = this.links[node * 2 + 1]!;
      if (b <= 0) {
        for (let i = a; i < a - b; i++) {
          const tri = this.order[i]!;
          const hit = this.rayTriangle(tri, o, d);
          if (hit && hit.t >= tMin && hit.t <= far && (!accept || accept(hit))) {
            best = hit;
            far = hit.t;
          }
        }
      } else {
        stack.push(a, b);
      }
    }
    return best;
  }

  /** Closest surface point within maxDistance, or null. */
  closestPoint(p: ArrayLike<number>, maxDistance = Infinity, filter?: (triangle: number) => boolean): ClosestHit | null {
    if (this.nodeCount === 0) return null;
    let best: ClosestHit | null = null;
    let best2 = maxDistance * maxDistance;
    const stack: number[] = [0];
    const q: [number, number, number] = [0, 0, 0];
    const bary: [number, number, number] = [0, 0, 0];
    while (stack.length) {
      const node = stack.pop()!;
      if (this.boxDistance2(node, p) > best2) continue;
      const a = this.links[node * 2]!;
      const b = this.links[node * 2 + 1]!;
      if (b <= 0) {
        for (let i = a; i < a - b; i++) {
          const tri = this.order[i]!;
          if (filter && !filter(tri)) continue;
          closestPointOnTriangle(this.positions, this.indices[tri * 3]!, this.indices[tri * 3 + 1]!, this.indices[tri * 3 + 2]!, p, q, bary);
          const d2 = (q[0] - p[0]!) ** 2 + (q[1] - p[1]!) ** 2 + (q[2] - p[2]!) ** 2;
          if (d2 < best2) {
            best2 = d2;
            best = { triangle: tri, distance: Math.sqrt(d2), point: [q[0], q[1], q[2]], bary: [bary[0], bary[1], bary[2]] };
          }
        }
      } else {
        // Visit the nearer child first (pushed last).
        const da = this.boxDistance2(a, p);
        const db = this.boxDistance2(b, p);
        if (da < db) stack.push(b, a);
        else stack.push(a, b);
      }
    }
    return best;
  }

  /**
   * The hierarchy as flat arrays, for a GPU traversal (the bake engine, F16):
   * node bounds (min xyz, max xyz), links (inner: left, right; leaf: first,
   * -count) and the triangle order the leaves index into.
   */
  exportNodes(): { nodeCount: number; bounds: Float32Array; links: Int32Array; order: Uint32Array } {
    return {
      nodeCount: this.nodeCount,
      bounds: this.bounds.subarray(0, this.nodeCount * 6),
      links: this.links.subarray(0, this.nodeCount * 2),
      order: this.order,
    };
  }

  // ------------------------------------------------------------ internals

  private build(first: number, count: number, centroids: Float32Array): number {
    const node = this.nodeCount++;
    if (count <= LEAF_SIZE) {
      this.links[node * 2] = first;
      this.links[node * 2 + 1] = -count;
      this.computeBounds(node);
      return node;
    }
    // Split on the longest axis of the centroid bounds, at the median.
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = first; i < first + count; i++) {
      const t = this.order[i]!;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, centroids[t * 3 + k]!);
        hi[k] = Math.max(hi[k]!, centroids[t * 3 + k]!);
      }
    }
    const ext = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
    const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
    const slice = Array.from(this.order.subarray(first, first + count));
    slice.sort((x, y) => centroids[x * 3 + axis]! - centroids[y * 3 + axis]!);
    this.order.set(slice, first);
    const half = count >> 1;
    const left = this.build(first, half, centroids);
    const right = this.build(first + half, count - half, centroids);
    this.links[node * 2] = left;
    this.links[node * 2 + 1] = right;
    // Children always have higher indices than their parent, so refit can run back to front.
    this.computeBounds(node);
    return node;
  }

  private computeBounds(node: number): void {
    const B = this.bounds;
    const o = node * 6;
    const a = this.links[node * 2]!;
    const b = this.links[node * 2 + 1]!;
    if (b <= 0) {
      B[o] = B[o + 1] = B[o + 2] = Infinity;
      B[o + 3] = B[o + 4] = B[o + 5] = -Infinity;
      const P = this.positions;
      const I = this.indices;
      for (let i = a; i < a - b; i++) {
        const t = this.order[i]!;
        for (let c = 0; c < 3; c++) {
          const v = I[t * 3 + c]! * 3;
          for (let k = 0; k < 3; k++) {
            const x = P[v + k]!;
            if (x < B[o + k]!) B[o + k] = x;
            if (x > B[o + 3 + k]!) B[o + 3 + k] = x;
          }
        }
      }
    } else {
      for (let k = 0; k < 3; k++) {
        B[o + k] = Math.min(B[a * 6 + k]!, B[b * 6 + k]!);
        B[o + 3 + k] = Math.max(B[a * 6 + 3 + k]!, B[b * 6 + 3 + k]!);
      }
    }
  }

  private rayBox(node: number, o: ArrayLike<number>, inv: number[], tMin: number, tMax: number): boolean {
    const B = this.bounds;
    let t0 = tMin;
    let t1 = tMax;
    for (let k = 0; k < 3; k++) {
      let a = (B[node * 6 + k]! - o[k]!) * inv[k]!;
      let b = (B[node * 6 + 3 + k]! - o[k]!) * inv[k]!;
      if (a > b) [a, b] = [b, a];
      // NaN (0 * Infinity) means the ray lies in the slab plane: keep it.
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }

  private boxDistance2(node: number, p: ArrayLike<number>): number {
    const B = this.bounds;
    let d2 = 0;
    for (let k = 0; k < 3; k++) {
      const x = p[k]!;
      const lo = B[node * 6 + k]!;
      const hi = B[node * 6 + 3 + k]!;
      if (x < lo) d2 += (lo - x) ** 2;
      else if (x > hi) d2 += (x - hi) ** 2;
    }
    return d2;
  }

  /** Möller–Trumbore, two-sided. */
  private rayTriangle(tri: number, o: ArrayLike<number>, d: ArrayLike<number>): RayHit | null {
    const P = this.positions;
    const ia = this.indices[tri * 3]! * 3;
    const ib = this.indices[tri * 3 + 1]! * 3;
    const ic = this.indices[tri * 3 + 2]! * 3;
    const e1x = P[ib]! - P[ia]!;
    const e1y = P[ib + 1]! - P[ia + 1]!;
    const e1z = P[ib + 2]! - P[ia + 2]!;
    const e2x = P[ic]! - P[ia]!;
    const e2y = P[ic + 1]! - P[ia + 1]!;
    const e2z = P[ic + 2]! - P[ia + 2]!;
    const px = d[1]! * e2z - d[2]! * e2y;
    const py = d[2]! * e2x - d[0]! * e2z;
    const pz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return null;
    const invDet = 1 / det;
    const tx = o[0]! - P[ia]!;
    const ty = o[1]! - P[ia + 1]!;
    const tz = o[2]! - P[ia + 2]!;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) return null;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) * invDet;
    if (v < 0 || u + v > 1) return null;
    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return { triangle: tri, t, u, v };
  }
}

/**
 * Closest point on triangle (a, b, c) of a position array to p, with its
 * barycentric weights (Ericson, Real-Time Collision Detection 5.1.5).
 */
export function closestPointOnTriangle(P: ArrayLike<number>, a: number, b: number, c: number, p: ArrayLike<number>,
  out: [number, number, number], bary: [number, number, number]): void {
  const ia = a * 3;
  const ib = b * 3;
  const ic = c * 3;
  const ax = P[ia]!, ay = P[ia + 1]!, az = P[ia + 2]!;
  const abx = P[ib]! - ax, aby = P[ib + 1]! - ay, abz = P[ib + 2]! - az;
  const acx = P[ic]! - ax, acy = P[ic + 1]! - ay, acz = P[ic + 2]! - az;
  const apx = p[0]! - ax, apy = p[1]! - ay, apz = p[2]! - az;
  const set = (wa: number, wb: number, wc: number) => {
    bary[0] = wa;
    bary[1] = wb;
    bary[2] = wc;
    out[0] = ax + abx * wb + acx * wc;
    out[1] = ay + aby * wb + acy * wc;
    out[2] = az + abz * wb + acz * wc;
  };
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return set(1, 0, 0);
  const bpx = p[0]! - P[ib]!, bpy = p[1]! - P[ib + 1]!, bpz = p[2]! - P[ib + 2]!;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return set(1 - v, v, 0);
  }
  const cpx = p[0]! - P[ic]!, cpy = p[1]! - P[ic + 1]!, cpz = p[2]! - P[ic + 2]!;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return set(1 - w, 0, w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return set(0, 1 - w, w);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return set(1 - v - w, v, w);
}
