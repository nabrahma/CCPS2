/**
 * Engine-independent transcendental functions (PRD Part 3, 0.2 rule 2).
 *
 * `Math.sin` and the like are not required to round the same way in every
 * JavaScript engine, so a generator that used them could give different bytes
 * in Node (CI) and WebView2 (the app). Everything here is built only from
 * `+ - * /`, `Math.sqrt`, comparisons and `Math.floor`/`Math.abs`, which IEEE 754
 * rounds exactly, with fixed-order polynomial and rational approximations. The
 * same input therefore gives the same bits everywhere.
 *
 * The approximations and their constants are the classic fdlibm ones
 * (Sun Microsystems, freely usable), accurate to about 1 ulp:
 * sin/cos kernels with a Cody-Waite reduction by pi/2, atan by range
 * reduction and an odd polynomial, exp by reduction by ln 2 and a rational
 * form, log by a split into exponent and mantissa.
 *
 * Valid input range for sin/cos/tan: |x| <= 1e6 (the reduction keeps about
 * 118 bits of pi/2); generators stay far inside it.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const LN2 = 0.6931471805599453;
export const SQRT2 = 1.4142135623730951;

const TWO32 = 4294967296;
const INV_TWO32 = 1 / 4294967296;

// ---------------------------------------------------------------- sin, cos, tan

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;

/** sin on [-pi/4, pi/4]; `y` is the tail of x. */
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos on [-pi/4, pi/4]; `y` is the tail of x. */
function kernelCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const ax = Math.abs(x);
  if (ax < 0.3) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ax > 0.78125 ? 0.28125 : ax * 0.25;
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

let remHi = 0;
let remLo = 0;

/** Reduce x by multiples of pi/2: sets remHi + remLo to the remainder in [-pi/4, pi/4] and returns the quadrant 0..3. */
function remPio2(x: number): number {
  const fn = Math.floor(x * INV_PIO2 + 0.5);
  // Two steps of 33 bits of pi/2 each, for the cancellation when x is near a multiple of pi/2.
  const t = x - fn * PIO2_1;
  const w2 = fn * PIO2_2;
  const r = t - w2;
  const w = fn * PIO2_2T - (t - r - w2);
  remHi = r - w;
  remLo = r - remHi - w;
  return fn - 4 * Math.floor(fn / 4);
}

export function sin(x: number): number {
  if (!(Math.abs(x) <= 1e300)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return x === 0 ? x : kernelSin(x, 0);
  const q = remPio2(x);
  if (q === 0) return kernelSin(remHi, remLo);
  if (q === 1) return kernelCos(remHi, remLo);
  if (q === 2) return -kernelSin(remHi, remLo);
  return -kernelCos(remHi, remLo);
}

export function cos(x: number): number {
  if (!(Math.abs(x) <= 1e300)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kernelCos(x, 0);
  const q = remPio2(x);
  if (q === 0) return kernelCos(remHi, remLo);
  if (q === 1) return -kernelSin(remHi, remLo);
  if (q === 2) return -kernelCos(remHi, remLo);
  return kernelSin(remHi, remLo);
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

// ---------------------------------------------------------------- atan, atan2, asin, acos

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
];

export function atan(v: number): number {
  if (v !== v) return NaN;
  const neg = v < 0;
  let x = neg ? -v : v;
  if (x >= 7.378697629483821e19) return neg ? -HALF_PI : HALF_PI; // 2^66
  let id: number;
  if (x < 0.4375) {
    id = -1;
  } else if (x < 1.1875) {
    if (x < 0.6875) {
      id = 0;
      x = (2 * x - 1) / (2 + x);
    } else {
      id = 1;
      x = (x - 1) / (x + 1);
    }
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) {
    const r = x - x * (s1 + s2);
    return neg ? -r : r;
  }
  const r = ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
  return neg ? -r : r;
}

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (y === 0) return x > 0 || (x === 0 && 1 / x > 0) ? y : y < 0 || 1 / y < 0 ? -PI : PI;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  if (x === Infinity) return y === Infinity ? PI / 4 : y === -Infinity ? -PI / 4 : y > 0 ? 0 : -0;
  if (x === -Infinity) return y === Infinity ? (3 * PI) / 4 : y === -Infinity ? (-3 * PI) / 4 : y > 0 ? PI : -PI;
  if (y === Infinity) return HALF_PI;
  if (y === -Infinity) return -HALF_PI;
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - z : z - PI;
}

export function asin(x: number): number {
  if (!(x >= -1 && x <= 1)) return NaN;
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

export function acos(x: number): number {
  if (!(x >= -1 && x <= 1)) return NaN;
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

// ---------------------------------------------------------------- exp, log, pow

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

/** x * 2^k, exact while the result is a normal number. */
export function ldexp(x: number, k: number): number {
  let r = x;
  let n = k;
  while (n >= 32) {
    r *= TWO32;
    n -= 32;
  }
  while (n <= -32) {
    r *= INV_TWO32;
    n += 32;
  }
  while (n > 0) {
    r *= 2;
    n--;
  }
  while (n < 0) {
    r *= 0.5;
    n++;
  }
  return r;
}

export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  let hi = x;
  let lo = 0;
  let k = 0;
  if (Math.abs(x) > 0.34657359027997264) {
    k = Math.floor(x * INV_LN2 + 0.5);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
  }
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return ldexp(y, k);
}

const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const SQRT1_2 = 0.7071067811865476;

/** Natural logarithm. */
export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m * 2^k with m in [sqrt(1/2), sqrt(2)); halving and doubling are exact.
  let m = x;
  let k = 0;
  while (m >= TWO32) {
    m *= INV_TWO32;
    k += 32;
  }
  while (m < INV_TWO32) {
    m *= TWO32;
    k -= 32;
  }
  while (m >= SQRT2) {
    m *= 0.5;
    k++;
  }
  while (m < SQRT1_2) {
    m *= 2;
    k--;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}

/** x^y. Integer powers up to 1024 are repeated multiplication; others are exp(y log x), about 1e-13 relative. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (y === 0.5) return Math.sqrt(x);
  if (Math.floor(y) === y && Math.abs(y) <= 1024) {
    let n = Math.abs(y);
    let base = x;
    let r = 1;
    while (n > 0) {
      if (n - 2 * Math.floor(n / 2) === 1) r *= base;
      base *= base;
      n = Math.floor(n / 2);
    }
    return y < 0 ? 1 / r : r;
  }
  if (x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  return exp(y * log(x));
}

export function hypot(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Degrees to radians and back (plain multiplications). */
export const DEG = PI / 180;
export function degrees(rad: number): number {
  return (rad * 180) / PI;
}
