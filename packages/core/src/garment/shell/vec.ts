/** Small 3-vector helpers for the garment generators (float64, + - * / and sqrt only). */
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-15 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
/** The part of `a` perpendicular to unit vector `n`. */
export const reject = (a: Vec3, n: Vec3): Vec3 => sub(a, scale(n, dot(a, n)));
export const get3 = (arr: ArrayLike<number>, i: number): Vec3 => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!];
export function set3(arr: { [i: number]: number }, i: number, v: Vec3): void {
  arr[i * 3] = v[0];
  arr[i * 3 + 1] = v[1];
  arr[i * 3 + 2] = v[2];
}
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
