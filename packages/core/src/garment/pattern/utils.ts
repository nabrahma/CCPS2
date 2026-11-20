/**
 * Helpers shared by the GarmentCode port: pygarment's vector utilities, numpy's `linspace` rounding, Python's
 * slicing, and a `deepcopy` that keeps shared references shared (Python's memo), which pygarment relies on for
 * vertices shared between chained edges.
 */
import { acos, cos, sin } from '../../math/dmath';
import { fma } from './num/sq';

export type Vert = number[];

/** pygarment close_enough. */
export const closeEnough = (f1: number, f2 = 0, tol = 1e-4): boolean => Math.abs(f1 - f2) < tol;

/** numpy linspace(0, 1, n, endpoint=False): i * (1 / n). */
export function linspaceNoEnd(n: number): number[] {
  const step = 1 / n;
  return Array.from({ length: n }, (_, i) => i * step);
}

/** numpy linspace(0, 1, n) with the end point: i * (1 / (n - 1)), last exactly 1. */
export function linspace01(n: number): number[] {
  if (n === 1) return [0];
  const step = 1 / (n - 1);
  const out = Array.from({ length: n }, (_, i) => i * step);
  out[n - 1] = 1;
  return out;
}

export const norm2 = (v: readonly number[]): number => {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
};

export const cross2 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[1]! - a[1]! * b[0]!;

/** numpy sign. */
export const npSign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : v === 0 ? 0 : NaN);

/** pygarment.garmentcode.utils.vector_angle (no clipping of the cosine, as in GarmentCode). */
export function vectorAngle(v1: readonly number[], v2: readonly number[]): number {
  const c = (v1[0]! * v2[0]! + v1[1]! * v2[1]!) / (norm2(v1) * norm2(v2));
  let angle = acos(c);
  const cr = cross2(v1, v2);
  if (Math.abs(cr) > 1e-5) angle *= npSign(cr);
  return angle;
}

/** pygarment.pattern.utils.vector_angle (clips the cosine). */
export function vectorAngleClipped(v1: readonly number[], v2: readonly number[]): number {
  let c = (v1[0]! * v2[0]! + v1[1]! * v2[1]!) / (norm2(v1) * norm2(v2));
  c = Math.max(Math.min(c, 1), -1);
  let angle = acos(c);
  const cr = cross2(v1, v2);
  if (Math.abs(cr) > 1e-5) angle *= npSign(cr);
  return angle;
}

/** numpy matmul of a 2x2 matrix and a 2-vector (OpenBLAS FMA kernel): [fma(a00, v0, a01 v1), fma(a10, v0, a11 v1)]. */
export function matvec2(a00: number, a01: number, a10: number, a11: number, v0: number, v1: number): Vert {
  return [fma(a00, v0, a01 * v1), fma(a10, v0, a11 * v1)];
}

/** 2D rotation applied as numpy matmul(R2D(angle), v). */
export function rot2(angle: number, v: readonly number[]): Vert {
  const c = cos(angle);
  const s = sin(angle);
  return matvec2(c, -s, s, c, v[0]!, v[1]!);
}

/** pygarment rel_to_abs_2d. */
export function relToAbs2d(start: readonly number[], end: readonly number[], rel: readonly number[]): Vert {
  const ex = end[0]! - start[0]!;
  const ey = end[1]! - start[1]!;
  const px = -ey;
  const py = ex;
  const ax = start[0]! + rel[0]! * ex;
  const ay = start[1]! + rel[0]! * ey;
  return [ax + rel[1]! * px, ay + rel[1]! * py];
}

/** pygarment abs_to_rel_2d. */
export function absToRel2d(start: readonly number[], end: readonly number[], point: readonly number[], asVector = false): Vert {
  const ex = end[0]! - start[0]!;
  const ey = end[1]! - start[1]!;
  const edgeLen = Math.sqrt(ex * ex + ey * ey);
  const vx = asVector ? point[0]! : point[0]! - start[0]!;
  const vy = asVector ? point[1]! : point[1]! - start[1]!;
  const projectedLen = (ex * vx + ey * vy) / edgeLen;
  const r0 = projectedLen / edgeLen;
  const qx = vx - ex * r0;
  const qy = vy - ey * r0;
  let r1 = Math.sqrt(qx * qx + qy * qy) / edgeLen;
  r1 *= npSign(ex * vy - ey * vx);
  return [r0, r1];
}

/** pygarment lin_interpolation. */
export function linInterpolation(v1: number, v2: number, factor: number): number {
  if (factor < 0 || factor > 1) throw new RangeError(`lin_interpolation::ERROR::Expected a factor in [0, 1], got ${factor}`);
  return (1 - factor) * v1 + factor * v2;
}

/** Python slice bounds [start, stop) for a sequence of length n. */
export function pySlice(n: number, start?: number, stop?: number): [number, number] {
  const norm = (v: number | undefined, def: number): number => {
    if (v === undefined) return def;
    if (v < 0) return Math.max(0, n + v);
    return Math.min(v, n);
  };
  return [norm(start, 0), norm(stop, n)];
}

/** Python index (negative from the end); throws on out of range like IndexError. */
export function pyIndex(n: number, i: number): number {
  const k = i < 0 ? n + i : i;
  if (k < 0 || k >= n) throw new RangeError('list index out of range');
  return k;
}

/** Python list.insert semantics. */
export function pyInsert<T>(arr: T[], i: number, item: T): void {
  let k = i < 0 ? Math.max(0, arr.length + i) : Math.min(i, arr.length);
  if (k < 0) k = 0;
  arr.splice(k, 0, item);
}

/**
 * Python copy.deepcopy: class instances and arrays are copied recursively with a memo, so objects shared inside
 * the copied structure stay shared, and cycles are preserved. Objects that declare `deepcopyShare = true`
 * (immutable values such as rotations) are shared, which deepcopy of an immutable value amounts to.
 */
export function deepcopy<T>(value: T, memo: Map<object, unknown> = new Map()): T {
  if (value === null || typeof value !== 'object') return value;
  const obj = value as unknown as object;
  if (memo.has(obj)) return memo.get(obj) as T;
  if ((obj as { deepcopyShare?: boolean }).deepcopyShare) return value;
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    memo.set(obj, out);
    for (const v of obj) out.push(deepcopy(v, memo));
    return out as T;
  }
  const out = Object.create(Object.getPrototypeOf(obj)) as Record<string, unknown>;
  memo.set(obj, out);
  for (const key of Object.keys(obj)) out[key] = deepcopy((obj as Record<string, unknown>)[key], memo);
  return out as T;
}

/** Python copy.copy for a list or plain vertex. */
export const shallow = <T>(v: T[]): T[] => v.slice();
