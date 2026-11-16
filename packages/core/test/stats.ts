/**
 * Test-only statistics: CDFs and the Kolmogorov-Smirnov test. These check the
 * seeded distributions, so they use the engine's Math freely.
 */

/** ln Gamma(x), Lanczos approximation (g = 7, n = 9). */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let a = c[0]!;
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised incomplete beta function I_x(a, b) by Lentz's continued fraction. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (aa: number, bb: number, xx: number) => {
    const tiny = 1e-300;
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let f = d;
    for (let m = 1; m <= 400; m++) {
      const m2 = 2 * m;
      let num = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + num * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + num / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      f *= d * c;
      num = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + num * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + num / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-15) break;
    }
    return f;
  };
  if (x < (a + 1) / (a + b + 2)) return (front * cf(a, b, x)) / a;
  return 1 - (front * cf(b, a, 1 - x)) / b;
}

export function normalCdf(x: number): number {
  // erf by Abramowitz-Stegun 7.1.26 is too coarse for a KS test at n = 20000; use a series/continued fraction.
  const z = Math.abs(x) / Math.SQRT2;
  let erf: number;
  if (z < 2.5) {
    let sum = z;
    let term = z;
    for (let n = 1; n < 200; n++) {
      term *= (-z * z) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17) break;
    }
    erf = (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    // erfc by continued fraction.
    let f = 0;
    for (let k = 60; k >= 1; k--) f = k / 2 / (z + f);
    erf = 1 - Math.exp(-z * z) / (Math.sqrt(Math.PI) * (z + f));
  }
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** KS statistic of a sample against a CDF. */
export function ksStatistic(sample: readonly number[], cdf: (x: number) => number): number {
  const xs = [...sample].sort((a, b) => a - b);
  const n = xs.length;
  let dmax = 0;
  for (let i = 0; i < n; i++) {
    const f = cdf(xs[i]!);
    dmax = Math.max(dmax, Math.abs(f - i / n), Math.abs((i + 1) / n - f));
  }
  return dmax;
}

/** Asymptotic p-value of a KS statistic (Kolmogorov distribution, with Stephens' small-sample correction). */
export function ksPValue(dstat: number, n: number): number {
  const s = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * dstat;
  if (s < 0.2) return 1;
  let sum = 0;
  for (let k = 1; k <= 100; k++) sum += (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * s * s);
  return Math.min(1, Math.max(0, 2 * sum));
}
