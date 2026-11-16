/**
 * PRD Part 3, 0.2: engine-independent maths, the small solvers and the seeded
 * distributions. Accuracy is checked against the engine's own Math (which is
 * accurate, just not guaranteed bit-identical between engines); the hashes of
 * fixed input sweeps are checked in Node here and in WebView2 by
 * e2e/determinism.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import * as d from '../src/math/dmath';
import { beta, dirichletUniform, interpolate, normal, truncatedNormal } from '../src/math/distributions';
import { cholesky, choleskySolve, conjugateGradient, csrFromTriples, ldlt, ldltSolve, levenbergMarquardt } from '../src/math/linalg';
import { Rng } from '../src/random';
import { betaCdf, ksStatistic, ksPValue, normalCdf } from './stats';

function sweep(lo: number, hi: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n);
  return out;
}

function maxRelError(fn: (x: number) => number, ref: (x: number) => number, xs: number[], floor = 1e-300): number {
  let worst = 0;
  for (const x of xs) {
    const a = fn(x);
    const b = ref(x);
    const err = Math.abs(a - b) / Math.max(Math.abs(b), floor);
    if (err > worst || Number.isNaN(err)) worst = Number.isNaN(err) ? Infinity : err;
  }
  return worst;
}

describe('dmath', () => {
  it('sin, cos and tan match Math to a few ulp over a wide range', () => {
    const xs = [...sweep(-10, 10, 20001), ...sweep(-1000, 1000, 20001), ...sweep(-1e5, 1e5, 4001)];
    expect(maxRelError(d.sin, Math.sin, xs, 1e-12)).toBeLessThan(2e-15 * 1e3);
    expect(maxRelError(d.cos, Math.cos, xs, 1e-12)).toBeLessThan(2e-15 * 1e3);
    // Absolute error is what matters near the zeros.
    for (const x of xs) {
      expect(Math.abs(d.sin(x) - Math.sin(x))).toBeLessThan(4e-16);
      expect(Math.abs(d.cos(x) - Math.cos(x))).toBeLessThan(4e-16);
    }
    expect(maxRelError(d.tan, Math.tan, sweep(-1.5, 1.5, 3001), 1e-12)).toBeLessThan(1e-14);
  });

  it('atan, atan2, asin and acos match Math', () => {
    expect(maxRelError(d.atan, Math.atan, [...sweep(-50, 50, 20001), 1e10, -1e10, 1e30], 1e-300)).toBeLessThan(4e-16);
    let worst = 0;
    for (const y of sweep(-3, 3, 121)) for (const x of sweep(-3, 3, 121)) worst = Math.max(worst, Math.abs(d.atan2(y, x) - Math.atan2(y, x)));
    expect(worst).toBeLessThan(5e-16);
    for (const x of sweep(-1, 1, 4001)) {
      expect(Math.abs(d.asin(x) - Math.asin(x))).toBeLessThan(5e-16);
      expect(Math.abs(d.acos(x) - Math.acos(x))).toBeLessThan(5e-16);
    }
    expect(d.atan2(0, -1)).toBe(Math.PI);
    expect(d.atan2(1, 0)).toBe(Math.PI / 2);
    expect(Object.is(d.atan2(0, 1), 0)).toBe(true);
  });

  it('exp, log and pow match Math', () => {
    expect(maxRelError(d.exp, Math.exp, sweep(-700, 700, 28001))).toBeLessThan(4e-16);
    const xs = [...sweep(1e-6, 10, 20001), ...sweep(10, 1e6, 20001), 1e-300, 1e300, 5e-324, 0.5, 1, 2];
    for (const x of xs) {
      const a = d.log(x);
      const b = Math.log(x);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(Math.abs(b) * 4e-16, 2.3e-16));
    }
    expect(d.log(1)).toBe(0);
    expect(d.exp(0)).toBe(1);
    expect(d.pow(2, 10)).toBe(1024);
    expect(d.pow(3, -2)).toBeCloseTo(1 / 9, 15);
    for (const x of sweep(0.1, 20, 200)) for (const y of [-2.5, -0.3, 0.37, 1.7, 3.2]) expect(Math.abs(d.pow(x, y) / Math.pow(x, y) - 1)).toBeLessThan(1e-13);
  });
});

describe('linalg', () => {
  it('Cholesky and LDLt solve a symmetric system', () => {
    const n = 6;
    const rng = new Rng(7);
    const b = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) b[i] = rng.range(-1, 1);
    const a = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = i === j ? 0.5 : 0;
      for (let k = 0; k < n; k++) s += b[i * n + k]! * b[j * n + k]!;
      a[i * n + j] = s;
    }
    const x0 = Float64Array.from({ length: n }, (_v, i) => i - 2.5);
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rhs[i] = rhs[i]! + a[i * n + j]! * x0[j]!;
    const l = cholesky(a, n)!;
    const x = choleskySolve(l, n, rhs);
    const f = ldlt(a, n)!;
    const y = ldltSolve(f, n, rhs);
    for (let i = 0; i < n; i++) {
      expect(x[i]).toBeCloseTo(x0[i]!, 10);
      expect(y[i]).toBeCloseTo(x0[i]!, 10);
    }
    expect(cholesky(Float64Array.from([1, 2, 2, 1]), 2)).toBeNull();
  });

  it('conjugate gradient solves a sparse Laplacian system', () => {
    const n = 50;
    const rows: number[] = [];
    const cols: number[] = [];
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      rows.push(i);
      cols.push(i);
      vals.push(2.01);
      if (i > 0) {
        rows.push(i);
        cols.push(i - 1);
        vals.push(-1);
      }
      if (i < n - 1) {
        rows.push(i);
        cols.push(i + 1);
        vals.push(-1);
      }
    }
    const m = csrFromTriples(n, rows, cols, vals);
    const want = Float64Array.from({ length: n }, (_v, i) => Math.sin(i / 5));
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = 2.01 * want[i]! - (i > 0 ? want[i - 1]! : 0) - (i < n - 1 ? want[i + 1]! : 0);
    const x = conjugateGradient(m, b, 60);
    for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(want[i]!, 8);
  });

  it('projected Levenberg-Marquardt fits a curve and respects the box', () => {
    const ts = sweep(0, 4, 40);
    const truth = [2.5, -0.7, 0.4];
    const model = (p: ArrayLike<number>, t: number) => p[0]! * Math.exp(p[1]! * t) + p[2]!;
    const ys = ts.map((t) => model(truth, t));
    const problem = {
      n: 3,
      m: ts.length,
      residuals(p: Float64Array, out: Float64Array) {
        ts.forEach((t, i) => (out[i] = model(p, t) - ys[i]!));
      },
      jacobian(p: Float64Array, out: Float64Array) {
        ts.forEach((t, i) => {
          out[i * 3] = Math.exp(p[1]! * t);
          out[i * 3 + 1] = p[0]! * t * Math.exp(p[1]! * t);
          out[i * 3 + 2] = 1;
        });
      },
      lower: [0, -5, -5],
      upper: [10, 5, 5],
    };
    const free = levenbergMarquardt(problem, [1, 0, 0], 60);
    expect(free.cost).toBeLessThan(1e-16);
    truth.forEach((v, i) => expect(free.p[i]).toBeCloseTo(v, 6));
    const boxed = levenbergMarquardt({ ...problem, upper: [2, 5, 5] }, [1, 0, 0], 60);
    expect(boxed.p[0]).toBeLessThanOrEqual(2);
    expect(boxed.cost).toBeGreaterThan(1e-6);
  });
});

describe('seeded distributions', () => {
  const N = 20000;
  it('normal and truncated normal', () => {
    const rng = new Rng(11);
    const xs = Array.from({ length: N }, () => normal(rng));
    expect(ksPValue(ksStatistic(xs, normalCdf), N)).toBeGreaterThan(0.01);
    const ts = Array.from({ length: N }, () => truncatedNormal(rng, 2.5));
    expect(Math.max(...ts.map(Math.abs))).toBeLessThanOrEqual(2.5);
    const z = normalCdf(2.5) - normalCdf(-2.5);
    expect(ksPValue(ksStatistic(ts, (x) => (normalCdf(x) - normalCdf(-2.5)) / z), N)).toBeGreaterThan(0.01);
  });

  it('Beta follows its distribution for every shape regime (Cheng BB and BC)', () => {
    const shapes: [number, number][] = [
      [16.4956, 25.6562],
      [2, 5],
      [5, 2],
      [1, 1],
      [0.2341, 0.6836],
      [0.6836, 0.2341],
      [0.7, 3.2],
      [3.2, 0.7],
      [1, 2.5],
      [0.3145, 0.2214],
    ];
    shapes.forEach(([a, b], k) => {
      const rng = new Rng(100 + k);
      const xs = Array.from({ length: N }, () => beta(rng, a, b));
      for (const x of xs) expect(x >= 0 && x <= 1).toBe(true);
      const p = ksPValue(ksStatistic(xs, (x) => betaCdf(x, a, b)), N);
      expect(p, `Beta(${a}, ${b})`).toBeGreaterThan(0.01);
    });
  });

  it('Dirichlet(1,1,1) is uniform on the simplex', () => {
    const rng = new Rng(5);
    const firsts: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = dirichletUniform(rng, 3);
      expect(v[0]! + v[1]! + v[2]!).toBeCloseTo(1, 12);
      firsts.push(v[0]!);
    }
    // Each coordinate of a uniform point on the 2-simplex is Beta(1, 2).
    expect(ksPValue(ksStatistic(firsts, (x) => betaCdf(x, 1, 2)), N)).toBeGreaterThan(0.01);
  });

  it('interpolate is linear between anchors and constant outside', () => {
    expect(interpolate(0.5, [0, 1, 3], [10, 20, 40])).toBe(15);
    expect(interpolate(2, [0, 1, 3], [10, 20, 40])).toBe(30);
    expect(interpolate(-1, [0, 1, 3], [10, 20, 40])).toBe(10);
    expect(interpolate(9, [0, 1, 3], [10, 20, 40])).toBe(40);
  });

  it('a seed gives the same draws every time', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(beta(a, 2.3, 0.8)).toBe(beta(b, 2.3, 0.8));
  });
});
