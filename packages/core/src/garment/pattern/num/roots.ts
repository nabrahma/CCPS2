/**
 * Real roots of small real polynomials, standing in for svgpathtools' `polyroots` (which calls `np.roots`).
 *
 * Coefficients are highest power first, as numpy orders them. Roots are found on monotone pieces between the
 * roots of the derivative (recursively), by bisection to full precision, so the result does not depend on an
 * eigenvalue solver. Repeated roots are returned once. Arithmetic is `+ - * /` and `Math.sqrt` only.
 */

/** Horner evaluation, coefficients highest power first. */
export function polyval(c: readonly number[], x: number): number {
  let r = 0;
  for (const a of c) r = r * x + a;
  return r;
}

/** Derivative coefficients (highest power first). */
export function polyder(c: readonly number[]): number[] {
  const n = c.length - 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(c[i]! * (n - i));
  return out;
}

function trim(c: readonly number[]): number[] {
  let i = 0;
  while (i < c.length && c[i] === 0) i++;
  return c.slice(i);
}

/** A root of c in [a, b] where c(a) and c(b) have opposite signs (or one is zero). */
function bisect(c: readonly number[], a: number, b: number): number {
  let fa = polyval(c, a);
  if (fa === 0) return a;
  const fb = polyval(c, b);
  if (fb === 0) return b;
  let lo = a;
  let hi = b;
  for (let it = 0; it < 200; it++) {
    const m = 0.5 * (lo + hi);
    if (m <= lo || m >= hi) break;
    const fm = polyval(c, m);
    if (fm === 0) return m;
    if (fm < 0 === fa < 0) {
      lo = m;
      fa = fm;
    } else hi = m;
  }
  return 0.5 * (lo + hi);
}

/** All distinct real roots in [lo, hi], ascending. */
export function realRootsIn(coeffs: readonly number[], lo: number, hi: number): number[] {
  const c = trim(coeffs);
  const deg = c.length - 1;
  if (deg < 1) return [];
  if (deg === 1) {
    const r = -c[1]! / c[0]!;
    return r >= lo && r <= hi ? [r] : [];
  }
  // Critical points split [lo, hi] into monotone pieces.
  const crit = realRootsIn(polyder(c), lo, hi);
  const knots = [lo, ...crit.filter((x) => x > lo && x < hi), hi];
  const out: number[] = [];
  const scale = c.reduce((s, a) => Math.max(s, Math.abs(a)), 0);
  for (let i = 0; i + 1 < knots.length; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    const fa = polyval(c, a);
    const fb = polyval(c, b);
    let r: number | undefined;
    if (fa === 0) r = a;
    else if (fb === 0) r = b;
    else if (fa < 0 !== fb < 0) r = bisect(c, a, b);
    else if (i > 0 && Math.abs(fa) <= 1e-14 * scale) r = a; // touching (repeated) root at a critical point
    if (r !== undefined && (out.length === 0 || Math.abs(r - out[out.length - 1]!) > 1e-12 * Math.max(1, Math.abs(r)))) out.push(r);
  }
  return out;
}

/** All distinct real roots (any location), ascending: roots lie within the Cauchy bound. */
export function realRoots(coeffs: readonly number[]): number[] {
  const c = trim(coeffs);
  if (c.length < 2) return [];
  let m = 0;
  for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i]! / c[0]!));
  const bound = 1 + m;
  return realRootsIn(c, -bound, bound);
}
