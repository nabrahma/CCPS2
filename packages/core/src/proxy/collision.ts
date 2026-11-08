/**
 * Garment/body collision (PRD M4: no garment vertex more than 2 mm inside the
 * body). MakeHuman has no collision step; its garments already dip into the
 * skin in places (collars into necks, flats into feet), and body sliders make
 * it worse. PS2CC corrects this after MHCLO fitting:
 *
 * 1. Anchor: every garment vertex within ANCHOR_RANGE of the visible body is
 *    bound to the body triangle closest to it. In
 *    creases (necks, toes) pushing out of one triangle lands inside another,
 *    so the push is simulated and up to MAX_ANCHORS further anchors are added
 *    where the vertex ends up. Anchors are rebuilt on the current body
 *    whenever the shape settles (not during a drag), so the result depends
 *    only on the shape, never on edit history.
 * 2. Resolve (every refit): the vertex is projected onto each anchor
 *    triangle of the current body; closer than CLEARANCE along the normal
 *    interpolated there, it is pushed out along that normal. The push is spread to neighbouring
 *    garment vertices (half strength per ring) so the cloth bulges instead of
 *    spiking.
 *
 * Hidden body triangles are not part of the surface, and a closest point on
 * the open edge around them is ignored: a garment vertex there floats over a
 * hole, where there is no skin to poke through.
 */
import { closestPointOnTriangle, TriangleBVH, type ClosestHit } from '../mesh/bvh';

/** Distance kept between garment and skin, in metres. */
export const CLEARANCE = 0.0015;
/** Only garment vertices this close to the neutral body take part. */
export const ANCHOR_RANGE = 0.05;
const MAX_ANCHORS = 3;
const SPREAD_RINGS = 2;

type Vec3 = [number, number, number];

/** The visible body surface: triangles, smooth normals and its open boundary. */
export class BodySurface {
  readonly bvh: TriangleBVH;
  private readonly boundaryEdges = new Set<number>();
  private readonly boundaryVerts = new Set<number>();

  constructor(
    readonly positions: ArrayLike<number>,
    readonly normals: ArrayLike<number>,
    readonly indices: ArrayLike<number>,
  ) {
    this.bvh = new TriangleBVH(positions, indices);
    const count = new Map<number, number>();
    for (let t = 0; t < indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const k = edgeKey(indices[t + e]!, indices[t + ((e + 1) % 3)]!);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const [k, c] of count) {
      if (c !== 1) continue;
      this.boundaryEdges.add(k);
      this.boundaryVerts.add(Math.floor(k / EDGE_BASE));
      this.boundaryVerts.add(k % EDGE_BASE);
    }
  }

  /** Closest point within maxDistance that is not on the open boundary, or null. */
  closest(p: ArrayLike<number>, maxDistance: number): ClosestHit | null {
    const hit = this.bvh.closestPoint(p, maxDistance);
    return hit && !this.onBoundary(hit) ? hit : null;
  }

  /** Signed distance along the interpolated normal at a closest hit (negative = inside). */
  signedDistance(p: ArrayLike<number>, hit: ClosestHit): number {
    const N = this.normals;
    const I = this.indices;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      const v = I[hit.triangle * 3 + k]! * 3;
      nx += hit.bary[k]! * N[v]!;
      ny += hit.bary[k]! * N[v + 1]!;
      nz += hit.bary[k]! * N[v + 2]!;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    return ((p[0]! - hit.point[0]) * nx + (p[1]! - hit.point[1]) * ny + (p[2]! - hit.point[2]) * nz) / len;
  }

  private onBoundary(hit: ClosestHit): boolean {
    const I = this.indices;
    const v = [I[hit.triangle * 3]!, I[hit.triangle * 3 + 1]!, I[hit.triangle * 3 + 2]!];
    const zero = hit.bary.map((w) => w < 1e-6);
    const zeros = zero.filter(Boolean).length;
    if (zeros === 2) return this.boundaryVerts.has(v[zero.indexOf(false)]!);
    if (zeros === 1) {
      const k = zero.indexOf(true);
      return this.boundaryEdges.has(edgeKey(v[(k + 1) % 3]!, v[(k + 2) % 3]!));
    }
    return false;
  }
}

const EDGE_BASE = 1 << 22;
function edgeKey(a: number, b: number): number {
  return a < b ? a * EDGE_BASE + b : b * EDGE_BASE + a;
}

export class GarmentCollider {
  /** CSR: anchors of vertex v are [offsets[v], offsets[v + 1]). */
  private readonly offsets: Uint32Array;
  /** Body render vertices of each anchor triangle (3 per anchor). */
  private readonly anchorVerts: Uint32Array;
  private readonly neighbours: Uint32Array[];
  private readonly push: Float32Array;
  private readonly spread: [Float32Array, Float32Array];
  /** Vertices with at least one anchor. */
  readonly anchored: number;

  /**
   * @param body    the visible body surface (render vertices) of the current shape
   * @param garment garment vertex positions fitted to the same shape
   * @param garmentTriangles garment triangles (garment vertex indices)
   */
  constructor(body: BodySurface, garment: ArrayLike<number>, garmentTriangles: ArrayLike<number>) {
    const n = garment.length / 3;
    const P = body.positions;
    const N = body.normals;
    const I = body.indices;
    const offsets = new Uint32Array(n + 1);
    const verts: number[] = [];
    let anchored = 0;
    const p: Vec3 = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      offsets[v] = verts.length / 3;
      p[0] = garment[v * 3]!;
      p[1] = garment[v * 3 + 1]!;
      p[2] = garment[v * 3 + 2]!;
      const triangles: number[] = [];
      for (let k = 0; k < MAX_ANCHORS; k++) {
        const hit = body.closest(p, ANCHOR_RANGE);
        if (!hit || triangles.includes(hit.triangle)) break;
        const a = I[hit.triangle * 3]!;
        const b = I[hit.triangle * 3 + 1]!;
        const c = I[hit.triangle * 3 + 2]!;
        // The first anchor is always kept; later ones only where the vertex is still inside.
        if (k > 0 && pushOut(p, a, b, c, P, N, false) === 0) break;
        triangles.push(hit.triangle);
        verts.push(a, b, c);
        // Simulate the push, then look again from where the vertex lands.
        let moved = 0;
        for (let j = offsets[v]!; j < verts.length / 3; j++) {
          moved += pushOut(p, verts[j * 3]!, verts[j * 3 + 1]!, verts[j * 3 + 2]!, P, N, true);
        }
        if (moved === 0) break;
      }
      if (triangles.length) anchored++;
    }
    offsets[n] = verts.length / 3;
    this.offsets = offsets;
    this.anchorVerts = Uint32Array.from(verts);
    this.anchored = anchored;
    this.push = new Float32Array(n * 3);
    this.spread = [new Float32Array(n * 3), new Float32Array(n * 3)];
    this.neighbours = vertexNeighbours(n, garmentTriangles);
  }

  /**
   * Push garment vertices out of the body, in place. Returns the largest push
   * in metres (0 when nothing was inside the clearance).
   */
  resolve(garment: Float32Array, bodyPositions: ArrayLike<number>, bodyNormals: ArrayLike<number>): number {
    const n = this.offsets.length - 1;
    const O = this.offsets;
    const A = this.anchorVerts;
    const push = this.push;
    const p: Vec3 = [0, 0, 0];
    let maxPush = 0;
    push.fill(0);
    for (let v = 0; v < n; v++) {
      if (O[v] === O[v + 1]) continue;
      p[0] = garment[v * 3]!;
      p[1] = garment[v * 3 + 1]!;
      p[2] = garment[v * 3 + 2]!;
      // Two sweeps let a vertex settle between the planes of a crease.
      for (let sweep = 0; sweep < 2; sweep++) {
        for (let j = O[v]!; j < O[v + 1]!; j++) {
          pushOut(p, A[j * 3]!, A[j * 3 + 1]!, A[j * 3 + 2]!, bodyPositions, bodyNormals, true);
        }
      }
      const dx = p[0] - garment[v * 3]!;
      const dy = p[1] - garment[v * 3 + 1]!;
      const dz = p[2] - garment[v * 3 + 2]!;
      push[v * 3] = dx;
      push[v * 3 + 1] = dy;
      push[v * 3 + 2] = dz;
      const m = Math.hypot(dx, dy, dz);
      if (m > maxPush) maxPush = m;
    }
    if (maxPush === 0) return 0;
    // Spread: each ring tops up a vertex's own push towards half of its strongest neighbour's,
    // never replacing it (in a crease the two can point different ways).
    let src = push;
    let dst = this.spread[0]!;
    for (let ring = 0; ring < SPREAD_RINGS; ring++) {
      for (let v = 0; v < n; v++) {
        const ox = push[v * 3]!;
        const oy = push[v * 3 + 1]!;
        const oz = push[v * 3 + 2]!;
        let rx = ox;
        let ry = oy;
        let rz = oz;
        if (O[v] !== O[v + 1]) {
          let best = 0;
          let bx = 0;
          let by = 0;
          let bz = 0;
          for (const u of this.neighbours[v]!) {
            const m = src[u * 3]! ** 2 + src[u * 3 + 1]! ** 2 + src[u * 3 + 2]! ** 2;
            if (m > best) {
              best = m;
              bx = src[u * 3]! * 0.5;
              by = src[u * 3 + 1]! * 0.5;
              bz = src[u * 3 + 2]! * 0.5;
            }
          }
          const half = Math.sqrt(best) * 0.5;
          const own = Math.hypot(ox, oy, oz);
          if (half > own) {
            const f = 1 - own / half;
            rx += bx * f;
            ry += by * f;
            rz += bz * f;
          }
        }
        dst[v * 3] = rx;
        dst[v * 3 + 1] = ry;
        dst[v * 3 + 2] = rz;
      }
      src = dst;
      dst = this.spread[(ring + 1) % 2]!;
    }
    for (let i = 0; i < n * 3; i++) garment[i] = garment[i]! + src[i]!;
    return maxPush;
  }
}

const scratchPoint: Vec3 = [0, 0, 0];
const scratchBary: Vec3 = [0, 0, 0];

/**
 * Signed distance of p from triangle (a, b, c) along the normal interpolated
 * at its closest point; when `apply`, move p out to CLEARANCE. Returns the push.
 */
function pushOut(p: Vec3, a: number, b: number, c: number, P: ArrayLike<number>, N: ArrayLike<number>, apply: boolean): number {
  closestPointOnTriangle(P, a, b, c, p, scratchPoint, scratchBary);
  const [wa, wb, wc] = scratchBary;
  let nx = wa * N[a * 3]! + wb * N[b * 3]! + wc * N[c * 3]!;
  let ny = wa * N[a * 3 + 1]! + wb * N[b * 3 + 1]! + wc * N[c * 3 + 1]!;
  let nz = wa * N[a * 3 + 2]! + wb * N[b * 3 + 2]! + wc * N[c * 3 + 2]!;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-8) return 0;
  nx /= len;
  ny /= len;
  nz /= len;
  const d = (p[0] - scratchPoint[0]) * nx + (p[1] - scratchPoint[1]) * ny + (p[2] - scratchPoint[2]) * nz;
  if (d >= CLEARANCE) return 0;
  const s = CLEARANCE - d;
  if (apply) {
    p[0] += nx * s;
    p[1] += ny * s;
    p[2] += nz * s;
  }
  return s;
}

function vertexNeighbours(n: number, tris: ArrayLike<number>): Uint32Array[] {
  const sets = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!;
    const b = tris[t + 1]!;
    const c = tris[t + 2]!;
    sets[a]!.add(b).add(c);
    sets[b]!.add(a).add(c);
    sets[c]!.add(a).add(b);
  }
  return sets.map((s) => Uint32Array.from(s));
}
