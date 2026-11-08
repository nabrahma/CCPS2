/**
 * Binding of generated hair to the body (PRD F5 step 6), like an MHCLO asset:
 * every card vertex is bound to its nearest triangle of the head, neck and
 * shoulder surface. The offset is stored in that triangle's own frame: along
 * its edges e1, e2 (so it scales with the triangle) and along its unit normal
 * in metres (so hair keeps its distance from the skin when the head grows).
 * The point is exact on the body it was generated for and turns with the
 * triangle when sliders change the shape.
 *
 * Skin weights come from the bound triangle's vertices, limited to the head
 * and neck bones (PRD: "skin card vertices to head, and neck for long hair").
 */
import { TriangleBVH } from '../mesh/bvh';
import type { SparseWeights } from '../skeleton/weights';

export class HairBinding {
  /** hm08 vertices of the bound triangle, 3 per point. */
  readonly tri: Uint32Array;
  /** Local coordinates (u along e1, v along e2, w in metres along the unit normal), 3 per point. */
  readonly local: Float64Array;
  /** Barycentric weights of the closest point, for skin weights. */
  readonly bary: Float32Array;

  /**
   * @param positions hm08 positions of the body the points were generated on
   * @param triangles candidate surface triangles (hm08 indices)
   * @param points    points to bind, xyz
   */
  constructor(positions: ArrayLike<number>, triangles: Uint32Array, points: ArrayLike<number>) {
    const n = points.length / 3;
    this.tri = new Uint32Array(n * 3);
    this.local = new Float64Array(n * 3);
    this.bary = new Float32Array(n * 3);
    const bvh = new TriangleBVH(positions, triangles);
    const p = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      p[0] = points[i * 3]!;
      p[1] = points[i * 3 + 1]!;
      p[2] = points[i * 3 + 2]!;
      const hit = bvh.closestPoint(p);
      if (!hit) throw new Error('hair binding: empty surface');
      const a = triangles[hit.triangle * 3]!;
      const b = triangles[hit.triangle * 3 + 1]!;
      const c = triangles[hit.triangle * 3 + 2]!;
      this.tri.set([a, b, c], i * 3);
      this.bary.set(hit.bary, i * 3);
      const [u, v, w] = toLocal(positions, a, b, c, p);
      this.local[i * 3] = u;
      this.local[i * 3 + 1] = v;
      this.local[i * 3 + 2] = w;
    }
  }

  get count(): number {
    return this.tri.length / 3;
  }

  /** Bound point positions on a (morphed) body. */
  fit(positions: ArrayLike<number>, out: Float32Array = new Float32Array(this.count * 3)): Float32Array {
    for (let i = 0; i < this.count; i++) {
      const a = this.tri[i * 3]! * 3;
      const b = this.tri[i * 3 + 1]! * 3;
      const c = this.tri[i * 3 + 2]! * 3;
      const e1 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
      const e2 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
      const m = unitNormal(e1, e2);
      const u = this.local[i * 3]!;
      const v = this.local[i * 3 + 1]!;
      const w = this.local[i * 3 + 2]!;
      for (let k = 0; k < 3; k++) out[i * 3 + k] = positions[a + k]! + u * e1[k]! + v * e2[k]! + w * m[k]!;
    }
    return out;
  }

  /** Skin weights per point from the bound triangle, limited to `bones` (renormalised). */
  weights(sparse: SparseWeights, bones: ReadonlySet<number>, fallbackBone: number): SparseWeights {
    const out: SparseWeights = [];
    for (let i = 0; i < this.count; i++) {
      const acc = new Map<number, number>();
      for (let k = 0; k < 3; k++) {
        const wk = this.bary[i * 3 + k]!;
        for (const [bone, w] of sparse[this.tri[i * 3 + k]!] ?? []) {
          if (bones.has(bone)) acc.set(bone, (acc.get(bone) ?? 0) + wk * w);
        }
      }
      const total = [...acc.values()].reduce((s, w) => s + w, 0);
      out.push(total > 1e-6 ? [...acc.entries()].map(([b, w]) => [b, w / total] as [number, number]) : [[fallbackBone, 1]]);
    }
    return out;
  }
}

function unitNormal(e1: number[], e2: number[]): number[] {
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!);
  const s = len > 1e-30 ? 1 / len : 0;
  return [n[0]! * s, n[1]! * s, n[2]! * s];
}

/** Solve p - a = u e1 + v e2 + w m (m is the unit normal, perpendicular to e1 and e2). */
function toLocal(P: ArrayLike<number>, a: number, b: number, c: number, p: number[]): [number, number, number] {
  const e1 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
  const e2 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
  const d = [p[0]! - P[a * 3]!, p[1]! - P[a * 3 + 1]!, p[2]! - P[a * 3 + 2]!];
  const m = unitNormal(e1, e2);
  const mm = m[0]! ** 2 + m[1]! ** 2 + m[2]! ** 2;
  const w = mm > 0 ? (d[0]! * m[0]! + d[1]! * m[1]! + d[2]! * m[2]!) / mm : 0;
  const dot = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  const g11 = dot(e1, e1);
  const g12 = dot(e1, e2);
  const g22 = dot(e2, e2);
  const det = g11 * g22 - g12 * g12;
  if (Math.abs(det) < 1e-30) return [0, 0, w];
  const r1 = dot(d, e1);
  const r2 = dot(d, e2);
  return [(r1 * g22 - r2 * g12) / det, (r2 * g11 - r1 * g12) / det, w];
}
