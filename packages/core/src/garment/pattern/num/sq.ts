/** Exact small powers (the lint bans `**`, which engines need not round correctly). */
export const sq = (x: number): number => x * x;

const SPLIT = 134217729; // 2^27 + 1 (Dekker)

/** Exact error of a * b: a * b = p + twoProdErr(a, b, p) (Dekker, no FMA needed). */
function twoProdErr(a: number, b: number, p: number): number {
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  return al * bl - (p - ah * bh - al * bh - ah * bl);
}

/**
 * x^3 rounded as a correctly rounded pow(x, 3) would be (numpy's `x**3` is, but for rare cases): the cube is
 * formed in double-double and rounded once. `x * x * x` rounds twice and differs in about a quarter of cases.
 */
export function cube(x: number): number {
  const p = x * x;
  const e1 = twoProdErr(x, x, p);
  const q = p * x;
  const e2 = twoProdErr(p, x, q);
  return q + (e2 + e1 * x);
}

/** x^n for a small non-negative integer n, by repeated multiplication. */
export function ipow(x: number, n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= x;
  return r;
}

/**
 * a * b + c rounded once (fused multiply-add), from Dekker's exact product and Knuth's exact sum; correctly
 * rounded except for rare double-rounding ties. numpy's 2x2 matrix products go through OpenBLAS kernels that use
 * FMA instructions, so the BFGS port needs it to follow SciPy bit for bit.
 */
export function fma(a: number, b: number, c: number): number {
  const p = a * b;
  const e = twoProdErr(a, b, p);
  const s = p + c;
  const bb = s - p;
  const err = p - (s - bb) + (c - bb);
  return s + (err + e);
}
