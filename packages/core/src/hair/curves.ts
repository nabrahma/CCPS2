/**
 * Curve tools for hair: the operations Blender's curve nodes give the
 * "Hair cards from curves" setup this hair system is ported from
 * (docs/hair-system.md). Curves are polylines of points in metres.
 */

export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function normalized(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [fallback[0], fallback[1], fallback[2]];
}

/** Rotate v about a unit axis (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * k, v[1] * c + x[1] * s + axis[1] * k, v[2] * c + x[2] * s + axis[2] * k];
}

/** Angle that rotates `from` onto `to` about `axis` (all unit; from and to perpendicular to the axis). */
export function signedAngle(from: Vec3, to: Vec3, axis: Vec3): number {
  return Math.atan2(dot(cross(from, to), axis), dot(from, to));
}

/** Cumulative arc length at each point; the last entry is the curve's length. */
export function arcLengths(pts: readonly Vec3[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + distance(pts[i]!, pts[i - 1]!));
  return out;
}

export function curveLength(pts: readonly Vec3[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += distance(pts[i]!, pts[i - 1]!);
  return l;
}

/** Point at an arc length (clamped to the curve), with the segment it lies on. */
export function pointAt(pts: readonly Vec3[], arcs: readonly number[], arc: number): { point: Vec3; segment: number; t: number } {
  const last = pts.length - 1;
  if (arc <= 0) return { point: [...pts[0]!], segment: 0, t: 0 };
  if (arc >= arcs[last]!) return { point: [...pts[last]!], segment: Math.max(0, last - 1), t: 1 };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid]! <= arc) lo = mid;
    else hi = mid;
  }
  const span = arcs[lo + 1]! - arcs[lo]!;
  const t = span > 1e-12 ? (arc - arcs[lo]!) / span : 0;
  return { point: lerp(pts[lo]!, pts[lo + 1]!, t), segment: lo, t };
}

/** `count` points evenly spaced along the curve (Resample Curve / Redistribute Curve Points). */
export function resample(pts: readonly Vec3[], count: number): Vec3[] {
  if (pts.length === 0) return [];
  const n = Math.max(2, count);
  const arcs = arcLengths(pts);
  const total = arcs[arcs.length - 1]!;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) out.push(pointAt(pts, arcs, (total * i) / (n - 1)).point);
  return out;
}

/** The curve from its root to `factor` of its length (Trim Curve, start 0). */
export function trim(pts: readonly Vec3[], factor: number): Vec3[] {
  const f = Math.min(1, Math.max(0, factor));
  if (f >= 1 || pts.length < 2) return pts.map((p) => [...p] as Vec3);
  const arcs = arcLengths(pts);
  const end = Math.max(arcs[arcs.length - 1]! * f, 1e-6);
  const cut = pointAt(pts, arcs, end);
  const out: Vec3[] = [];
  for (let i = 0; i <= cut.segment; i++) out.push([...pts[i]!]);
  if (distance(out[out.length - 1]!, cut.point) > 1e-9) out.push(cut.point);
  if (out.length < 2) out.push(cut.point);
  return out;
}

/** Unit tangent at every point (central differences, one-sided at the ends). */
export function tangents(pts: readonly Vec3[]): Vec3[] {
  const n = pts.length;
  const out: Vec3[] = [];
  let prev: Vec3 = [0, -1, 0];
  for (let i = 0; i < n; i++) {
    const t = normalized(sub(pts[Math.min(n - 1, i + 1)]!, pts[Math.max(0, i - 1)]!), prev);
    out.push(t);
    prev = t;
  }
  return out;
}

/**
 * The normal a curve starts with when nothing else is said: horizontal and
 * perpendicular to the tangent. Blender's minimum-twist curves start the same
 * way (there about its Z axis; here the world is Y up).
 */
export function worldNormal(tangent: Vec3): Vec3 {
  const h = Math.hypot(tangent[0], tangent[2]);
  return h < 1e-6 ? [1, 0, 0] : [tangent[2] / h, 0, -tangent[0] / h];
}

/**
 * Minimum-twist normals: `n0` (made perpendicular to the first tangent) is
 * carried along the curve by the smallest rotation that turns each tangent
 * into the next, so the frame never spins about the curve on its own.
 */
export function transportNormals(tans: readonly Vec3[], n0: Vec3): Vec3[] {
  const out: Vec3[] = [];
  let n = normalized(sub(n0, mul(tans[0]!, dot(n0, tans[0]!))), worldNormal(tans[0]!));
  out.push(n);
  for (let i = 1; i < tans.length; i++) {
    const axis = cross(tans[i - 1]!, tans[i]!);
    const s = length(axis);
    if (s > 1e-9) n = rotateAbout(n, mul(axis, 1 / s), Math.atan2(s, dot(tans[i - 1]!, tans[i]!)));
    // Remove drift so the normal stays exactly perpendicular.
    n = normalized(sub(n, mul(tans[i]!, dot(n, tans[i]!))), n);
    out.push(n);
  }
  return out;
}

/**
 * Port of Blender's `shape_range` node group, which shapes every "along the
 * hair" falloff in its hair nodes (clump, noise, the lift of the sparse layer).
 * `x` runs 0 at the root to 1 at the tip. Shape 0 gives 1 everywhere; positive
 * shapes rise towards the tip, sooner for small values and later for large
 * ones; negative shapes mirror that from the root.
 */
export function shapeRange(x: number, shape: number, base = 2): number {
  if (Math.abs(shape) < 1e-5) return 1;
  const a = Math.min(Math.abs(shape), 0.999999);
  const high = a > 0.5;
  const negative = shape < 0;
  const v = Math.min(1, Math.max(0, x));
  const value = (high ? !negative : negative) ? 1 - v : v;
  const b = Math.max(base, 1.00001);
  const pingpong = a <= 0.5 ? a : 1 - a;
  const exponent = -Math.log(Math.max(1 - pingpong * (1 - 1 / b) * 2, 1e-5)) / Math.log(b);
  const y = Math.pow(value, exponent);
  return Math.min(1, Math.max(0, high ? 1 - y : y));
}

/** Closest point on a polyline, with the distance to it. */
export function closestOnPolyline(pts: readonly Vec3[], p: Vec3): { point: Vec3; distance: number } {
  let best: Vec3 = [...pts[0]!];
  let bestD = distance(best, p);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const ab = sub(pts[i]!, a);
    const l2 = dot(ab, ab);
    const t = l2 > 1e-18 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
    const q = add(a, mul(ab, t));
    const d = distance(q, p);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return { point: best, distance: bestD };
}
