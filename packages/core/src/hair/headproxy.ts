/**
 * Head-and-shoulders collision proxy for hair (PRD F5 step 3): a cranium
 * ellipsoid, a face ellipsoid, and neck, upper-torso and shoulder capsules,
 * fitted to the current body from the vertices each bone dominates.
 *
 * Every shape is then shrunk until the whole scalp (MakeHuman's helper-hair
 * cap) lies outside it, so roots sit on the scalp and are never "inside".
 * Strands and card vertices are pushed out of all shapes.
 */
import type { BaseMesh } from '../mesh/basemesh';
import type { RigDefinition } from '../skeleton/rig';
import type { FittedSkeleton } from '../skeleton/rig';
import type { SparseWeights } from '../skeleton/weights';

type Vec3 = [number, number, number];

export interface Ellipsoid {
  kind: 'ellipsoid';
  name: string;
  centre: Vec3;
  radii: Vec3;
}

export interface Capsule {
  kind: 'capsule';
  name: string;
  a: Vec3;
  b: Vec3;
  radius: number;
}

export type ProxyShape = Ellipsoid | Capsule;

/** Dominant bone (index, weight) per hm08 vertex; computed once per weight set. */
export function dominantBones(weights: SparseWeights): { bone: Int16Array; weight: Float32Array } {
  const bone = new Int16Array(weights.length).fill(-1);
  const weight = new Float32Array(weights.length);
  weights.forEach((list, v) => {
    for (const [b, w] of list) {
      if (w > weight[v]!) {
        weight[v] = w;
        bone[v] = b;
      }
    }
  });
  return { bone, weight };
}

export class HeadProxy {
  constructor(readonly shapes: ProxyShape[]) {}

  /**
   * Fit to a body: `positions` are current hm08 positions, `scalp` the
   * helper-hair vertex indices.
   */
  static fit(
    base: BaseMesh,
    rig: RigDefinition,
    skeleton: FittedSkeleton,
    dominant: { bone: Int16Array; weight: Float32Array },
    positions: ArrayLike<number>,
    scalp: ArrayLike<number>,
  ): HeadProxy {
    const idx = (name: string) => {
      const i = rig.index.get(name);
      if (i === undefined) throw new Error(`hair proxy: rig has no bone ${name}`);
      return i;
    };
    const head = (b: number): Vec3 => [skeleton.heads[b * 3]!, skeleton.heads[b * 3 + 1]!, skeleton.heads[b * 3 + 2]!];
    const P = (v: number): Vec3 => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
    const vertsOf = (bones: number[], min: number) => {
      const out: number[] = [];
      for (let v = 0; v < base.bodyVertexCount; v++) if (bones.includes(dominant.bone[v]!) && dominant.weight[v]! >= min) out.push(v);
      return out;
    };

    const headBone = idx('head');
    const neck = idx('neck_01');
    const spine3 = idx('spine_03');
    const clavicles = [idx('clavicle_l'), idx('clavicle_r')];
    const upperL = idx('upperarm_l');
    const upperR = idx('upperarm_r');

    const headVerts = vertsOf([headBone], 0.6);
    const scalpPts: Vec3[] = [];
    for (let i = 0; i < scalp.length; i++) scalpPts.push(P(scalp[i]!));
    // The cranium follows the scalp cap (least squares); the bounding box of the head is the fallback.
    const cranium = fitEllipsoid('cranium', scalpPts) ?? bboxEllipsoid('cranium', headVerts.map(P));
    // The face: head vertices well in front of the cranium centre and below its upper third.
    const scalpSet = new Set(Array.from({ length: scalp.length }, (_, i) => scalp[i]!));
    const faceVerts = headVerts.filter(
      (v) => !scalpSet.has(v) && positions[v * 3 + 2]! > cranium.centre[2] + 0.3 * cranium.radii[2] && positions[v * 3 + 1]! < cranium.centre[1] + 0.35 * cranium.radii[1],
    );
    const shapes: ProxyShape[] = [cranium];
    if (faceVerts.length > 20) shapes.push(bboxEllipsoid('face', faceVerts.map(P)));

    const neckA = head(neck);
    const neckB = head(headBone);
    shapes.push({ kind: 'capsule', name: 'neck', a: neckA, b: neckB, radius: percentileDistance(vertsOf([neck], 0.5).map(P), neckA, neckB, 0.7) });
    // Upper torso: from the chest up to 60% of the way to the neck base, so it does not swell around the neck.
    const chestA = head(spine3);
    const chestB: Vec3 = [chestA[0] + (neckA[0] - chestA[0]) * 0.6, chestA[1] + (neckA[1] - chestA[1]) * 0.6, chestA[2] + (neckA[2] - chestA[2]) * 0.6];
    shapes.push({ kind: 'capsule', name: 'upper-torso', a: chestA, b: chestB, radius: percentileDistance(vertsOf([spine3], 0.5).map(P), chestA, chestB, 0.5) });
    const shL = head(upperL);
    const shR = head(upperR);
    shapes.push({ kind: 'capsule', name: 'shoulders', a: shL, b: shR, radius: percentileDistance(vertsOf(clavicles, 0.5).map(P), shL, shR, 0.6) });

    // Shrink each shape until every scalp vertex is outside it (with a small margin).
    return new HeadProxy(shapes.map((s) => shrinkToExclude(s, scalpPts, 0.001)));
  }

  /** The largest penetration of p into any shape (metres, > 0 means inside). */
  depth(p: ArrayLike<number>): number {
    let worst = -Infinity;
    for (const s of this.shapes) worst = Math.max(worst, shapeDepth(s, p));
    return worst;
  }

  /** Push p (in place) out of every shape, to `margin` outside. */
  pushOut(p: Vec3, margin: number): void {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const s of this.shapes) if (projectOut(s, p, margin)) moved = true;
      if (!moved) return;
    }
  }

  /** Cranium centre and radii (the head frame for hair generation). */
  get cranium(): Ellipsoid {
    return this.shapes[0] as Ellipsoid;
  }
}

function bboxEllipsoid(name: string, pts: Vec3[]): Ellipsoid {
  if (pts.length === 0) throw new Error(`hair proxy: no vertices for ${name}`);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, p[k]!);
    hi[k] = Math.max(hi[k]!, p[k]!);
  }
  return {
    kind: 'ellipsoid',
    name,
    centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    radii: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2],
  };
}

/**
 * Axis-aligned least-squares ellipsoid through points:
 * a x^2 + b y^2 + c z^2 + d x + e y + f z = 1 (coordinates centred first).
 * Returns null when the fit is not an ellipsoid.
 */
function fitEllipsoid(name: string, pts: Vec3[]): Ellipsoid | null {
  if (pts.length < 12) return null;
  const m: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) m[k] = m[k]! + p[k]! / pts.length;
  const N = Array.from({ length: 6 }, () => new Float64Array(7));
  for (const p of pts) {
    const x = p[0] - m[0];
    const y = p[1] - m[1];
    const z = p[2] - m[2];
    const row = [x * x, y * y, z * z, x, y, z];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) N[i]![j] = N[i]![j]! + row[i]! * row[j]!;
      N[i]![6] = N[i]![6]! + row[i]!;
    }
  }
  const sol = solve(N);
  if (!sol) return null;
  const [a, b, c, d, e, f] = sol as [number, number, number, number, number, number];
  if (!(a > 0 && b > 0 && c > 0)) return null;
  const g = 1 + (d * d) / (4 * a) + (e * e) / (4 * b) + (f * f) / (4 * c);
  const radii: Vec3 = [Math.sqrt(g / a), Math.sqrt(g / b), Math.sqrt(g / c)];
  if (!radii.every((r) => Number.isFinite(r) && r > 0.03 && r < 0.3)) return null;
  return { kind: 'ellipsoid', name, centre: [m[0] - d / (2 * a), m[1] - e / (2 * b), m[2] - f / (2 * c)], radii };
}

/** Gaussian elimination with partial pivoting on an n x (n+1) augmented matrix. */
function solve(M: Float64Array[]): number[] | null {
  const n = M.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-18) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const k = M[r]![col]! / M[col]![col]!;
      for (let j = col; j <= n; j++) M[r]![j] = M[r]![j]! - k * M[col]![j]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function closestOnSegment(p: ArrayLike<number>, a: Vec3, b: Vec3): Vec3 {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2 || 1;
  const t = Math.min(1, Math.max(0, ((p[0]! - a[0]) * ab[0]! + (p[1]! - a[1]) * ab[1]! + (p[2]! - a[2]) * ab[2]!) / len2));
  return [a[0] + ab[0]! * t, a[1] + ab[1]! * t, a[2] + ab[2]! * t];
}

function percentileDistance(pts: Vec3[], a: Vec3, b: Vec3, q: number): number {
  if (pts.length === 0) return 0.02;
  const d = pts.map((p) => {
    const c = closestOnSegment(p, a, b);
    return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  });
  d.sort((x, y) => x - y);
  return d[Math.min(d.length - 1, Math.floor(d.length * q))]!;
}

/** Normalised radius of p in an ellipsoid (1 = on the surface). */
function ellipsoidK(e: Ellipsoid, p: ArrayLike<number>): number {
  return Math.hypot((p[0]! - e.centre[0]) / e.radii[0], (p[1]! - e.centre[1]) / e.radii[1], (p[2]! - e.centre[2]) / e.radii[2]);
}

function shapeDepth(s: ProxyShape, p: ArrayLike<number>): number {
  if (s.kind === 'capsule') {
    const c = closestOnSegment(p, s.a, s.b);
    return s.radius - Math.hypot(p[0]! - c[0], p[1]! - c[1], p[2]! - c[2]);
  }
  // Approximate metric depth along the ray from the centre.
  const k = ellipsoidK(s, p);
  const r = Math.hypot(p[0]! - s.centre[0], p[1]! - s.centre[1], p[2]! - s.centre[2]);
  return k > 1e-9 ? r / k - r : Math.min(...s.radii);
}

function projectOut(s: ProxyShape, p: Vec3, margin: number): boolean {
  if (s.kind === 'capsule') {
    const c = closestOnSegment(p, s.a, s.b);
    const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    const want = s.radius + margin;
    if (d >= want) return false;
    if (d < 1e-9) {
      p[2] = c[2] - want; // degenerate: push backwards
      return true;
    }
    for (let k = 0; k < 3; k++) p[k] = c[k]! + ((p[k]! - c[k]!) / d) * want;
    return true;
  }
  const k = ellipsoidK(s, p);
  const r = Math.hypot(p[0] - s.centre[0], p[1] - s.centre[1], p[2] - s.centre[2]);
  if (r < 1e-9) {
    p[1] = s.centre[1] + s.radii[1] + margin;
    return true;
  }
  const surface = r / k;
  if (r >= surface + margin) return false;
  const f = (surface + margin) / r;
  for (let j = 0; j < 3; j++) p[j] = s.centre[j]! + (p[j]! - s.centre[j]!) * f;
  return true;
}

function shrinkToExclude(s: ProxyShape, pts: Vec3[], margin: number): ProxyShape {
  if (s.kind === 'capsule') {
    let r = s.radius;
    for (const p of pts) {
      const c = closestOnSegment(p, s.a, s.b);
      r = Math.min(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - margin);
    }
    return { ...s, radius: Math.max(0.005, r) };
  }
  let f = 1;
  for (const p of pts) {
    const k = ellipsoidK(s, p);
    const r = Math.hypot(p[0] - s.centre[0], p[1] - s.centre[1], p[2] - s.centre[2]);
    // Scaling all radii by f scales the surface distance along this ray by f.
    if (r > 0) f = Math.min(f, (r - margin) / (r / k));
  }
  f = Math.max(0.3, f);
  return { ...s, radii: [s.radii[0] * f, s.radii[1] * f, s.radii[2] * f] };
}
