/**
 * The scalp for card hair (PRD F5 step 2): the head skin inside the widest
 * hairline, plus a per-style hairline mask (front, temples, sides, nape).
 * (MakeHuman's helper-hair geometry is a volume helmet 4 to 60 mm off the
 * skin, so it is not used: DECISIONS D-029.)
 *
 * Roots are sampled on the NEUTRAL base mesh (area-weighted dart throwing
 * with a seeded RNG) and stored as triangle + barycentric weights, so the
 * same style picks the same roots on every body; only their positions follow
 * the current shape.
 */
import type { BaseMesh } from '../mesh/basemesh';
import { Rng } from '../random';
import type { HairlineMask } from './style';

export interface ScalpRoot {
  /** hm08 vertices of the scalp triangle. */
  a: number;
  b: number;
  c: number;
  wa: number;
  wb: number;
  wc: number;
  /** Head-frame angles on the neutral body (radians): polar from the crown, azimuth (0 = front, + = character's left). */
  theta: number;
  phi: number;
}

export interface HeadFrame {
  centre: [number, number, number];
}

export class Scalp {
  /** Triangles (hm08 vertex indices) of the scalp skin. */
  readonly triangles: Uint32Array;
  /** Unique scalp vertices. */
  readonly vertices: Uint32Array;
  /** Quads (4 hm08 indices) of the scalp, for the scalp shell. */
  readonly quads: Uint32Array;

  /** `faces`: base-mesh face indices that form the scalp. */
  constructor(base: BaseMesh, faces: readonly number[]) {
    if (faces.length === 0) throw new Error('hair scalp: no faces');
    const tris: number[] = [];
    const quads: number[] = [];
    const verts = new Set<number>();
    for (const f of faces) {
      const q = [0, 1, 2, 3].map((k) => base.faceVerts[f * 4 + k]!);
      quads.push(...q);
      tris.push(q[0]!, q[1]!, q[2]!);
      if (q[3] !== q[2]) tris.push(q[0]!, q[2]!, q[3]!);
      for (const v of q) verts.add(v);
    }
    this.triangles = Uint32Array.from(tris);
    this.quads = Uint32Array.from(quads);
    this.vertices = Uint32Array.from([...verts].sort((x, y) => x - y));
  }

  /** Polar and azimuth angles of a point in a head frame. */
  static angles(p: ArrayLike<number>, frame: HeadFrame): { theta: number; phi: number } {
    const x = p[0]! - frame.centre[0];
    const y = p[1]! - frame.centre[1];
    const z = p[2]! - frame.centre[2];
    const r = Math.hypot(x, y, z) || 1;
    return { theta: Math.acos(Math.min(1, Math.max(-1, y / r))), phi: Math.atan2(x, z) };
  }

  /**
   * Largest polar angle (radians) the mask allows at an azimuth. Control points
   * by |azimuth|: front 0°, temples 50°, sides (sideburns) 88°, a notch over the
   * ears at 106° (sides - 4°), behind the ears at 122° (nape - 2°), and the nape at 180°.
   */
  static maskLimit(mask: HairlineMask, phi: number): number {
    const a = Math.abs((phi * 180) / Math.PI);
    // Just above the top of the ear (about 96 degrees on the neutral head), then steeply down to the nape behind it.
    const ears = mask.sides - 4;
    const pts: [number, number][] = [[0, mask.front], [50, mask.temples], [88, mask.sides], [106, ears], [122, mask.nape - 2], [180, mask.nape]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a0, v0] = pts[i]!;
      const [a1, v1] = pts[i + 1]!;
      if (a <= a1) return ((v0 + ((a - a0) / (a1 - a0)) * (v1 - v0)) * Math.PI) / 180;
    }
    return (mask.nape * Math.PI) / 180;
  }

  /**
   * Up to `count` well-spread roots inside the mask, deterministic for a seed.
   * `neutral` are the base mesh rest positions; `frame` the neutral head frame.
   */
  sampleRoots(count: number, seed: number, mask: HairlineMask, neutral: ArrayLike<number>, frame: HeadFrame): ScalpRoot[] {
    if (count <= 0) return [];
    const T = this.triangles;
    const nTri = T.length / 3;
    const cdf = new Float64Array(nTri);
    let total = 0;
    for (let t = 0; t < nTri; t++) {
      total += triangleArea(neutral, T[t * 3]!, T[t * 3 + 1]!, T[t * 3 + 2]!);
      cdf[t] = total;
    }
    const rng = new Rng(seed);
    const candidates: { root: ScalpRoot; p: [number, number, number] }[] = [];
    const want = count * 12;
    for (let tries = 0; candidates.length < want && tries < want * 6; tries++) {
      const t = lowerBound(cdf, rng.next() * total);
      let u = rng.next();
      let v = rng.next();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const a = T[t * 3]!;
      const b = T[t * 3 + 1]!;
      const c = T[t * 3 + 2]!;
      const wa = 1 - u - v;
      const p: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) p[k] = wa * neutral[a * 3 + k]! + u * neutral[b * 3 + k]! + v * neutral[c * 3 + k]!;
      const { theta, phi } = Scalp.angles(p, frame);
      if (theta > Scalp.maskLimit(mask, phi)) continue;
      candidates.push({ root: { a, b, c, wa, wb: u, wc: v, theta, phi }, p });
    }
    if (candidates.length === 0) return [];
    // Dart throwing: keep candidates farther than r from every kept one, relaxing r until enough are kept.
    let maskedArea = total * (candidates.length / Math.max(1, want));
    maskedArea = Math.max(maskedArea, 1e-6);
    let r = Math.sqrt(maskedArea / (count * Math.PI)) * 1.1;
    let kept: typeof candidates = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      kept = [];
      for (const cand of candidates) {
        if (kept.length >= count) break;
        if (kept.every((k) => (k.p[0] - cand.p[0]) ** 2 + (k.p[1] - cand.p[1]) ** 2 + (k.p[2] - cand.p[2]) ** 2 >= r * r)) kept.push(cand);
      }
      if (kept.length >= count) break;
      r *= 0.85;
    }
    return kept.slice(0, count).map((k) => k.root);
  }
}

export function triangleArea(P: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = P[b * 3]! - P[a * 3]!;
  const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
  const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
  const vx = P[c * 3]! - P[a * 3]!;
  const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
  const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function lowerBound(cdf: Float64Array, x: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
