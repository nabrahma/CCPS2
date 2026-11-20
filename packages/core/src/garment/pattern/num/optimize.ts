/**
 * `scipy.optimize.minimize` as GarmentCode calls it, so the port reaches the same optimum by the same path.
 *
 * - BFGS (no bounds): SciPy's `_minimize_bfgs`, with `_line_search_wolfe12` (MINPACK-2 DCSRCH, then the Wolfe 2
 *   zoom search as fallback), ported line by line.
 * - L-BFGS-B (bounds given, or asked for): the Byrd, Lu, Nocedal and Zhu algorithm in its version 3.0 form
 *   (Morales and Nocedal 2011), as SciPy's Fortran `setulb` runs it: generalized Cauchy point by breakpoints,
 *   subspace minimisation with the projection and backtracking step, DCSRCH line search (ftol 1e-3, gtol 0.9,
 *   xtol 0.1, at most 20 steps), memory 10, factr 1e7, pgtol 1e-5. The limited-memory matrix is formed explicitly
 *   (problems here have at most 5 unknowns), which is algebraically the compact form the Fortran code uses.
 * - Gradients: SciPy's 2-point finite differences with an absolute step (1.49e-8 for BFGS, 1e-8 for L-BFGS-B),
 *   flipped inward at bounds as `approx_derivative` does.
 *
 * Arithmetic is `+ - * /`, `Math.sqrt` and comparisons, in a fixed order.
 */

import { cube, fma, sq } from './sq';

export type Objective = (x: number[]) => number;
export type Bounds = readonly (readonly [number, number])[];

export interface MinimizeResult {
  x: number[];
  fun: number;
  success: boolean;
  nit: number;
  message: string;
}

const EPS = 2.220446049250313e-16;
const SQRT_EPS = 1.4901161193847656e-8;

const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};
const infNorm = (a: readonly number[]): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const l2 = (a: readonly number[]): number => Math.sqrt(dot(a, a));

/** SciPy 2-point finite-difference gradient around x (f0 = f(x)) with an absolute step and bound adjustment. */
export function approxGrad(f: Objective, x0: readonly number[], f0: number, absStep: number, lb?: readonly number[], ub?: readonly number[]): number[] {
  const n = x0.length;
  const h: number[] = [];
  for (let i = 0; i < n; i++) {
    const sign = x0[i]! >= 0 ? 1 : -1;
    let hi = absStep;
    if (x0[i]! + hi - x0[i]! === 0) hi = SQRT_EPS * sign * Math.max(1, Math.abs(x0[i]!));
    h.push(hi);
  }
  if (lb && ub && !lb.every((l, i) => l === -Infinity && ub[i] === Infinity)) {
    for (let i = 0; i < n; i++) {
      const lower = x0[i]! - lb[i]!;
      const upper = ub[i]! - x0[i]!;
      const x = x0[i]! + h[i]!;
      const violated = x < lb[i]! || x > ub[i]!;
      const fitting = Math.abs(h[i]!) <= Math.max(lower, upper);
      if (violated && fitting) h[i] = -h[i]!;
      else if (!fitting) h[i] = upper >= lower ? upper : -lower;
    }
  }
  const g: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] = x0[i]! + h[i]!;
    const dx = x[i]! - x0[i]!;
    g.push((f(x) - f0) / dx);
  }
  return g;
}

// ------------------------------------------------------------------ MINPACK-2 DCSRCH (SciPy _dcsrch.py)

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function dcstep(
  stx: number,
  fx: number,
  dx: number,
  sty: number,
  fy: number,
  dy: number,
  stp: number,
  fp: number,
  dp: number,
  brackt: boolean,
  stpmin: number,
  stpmax: number,
): [number, number, number, number, number, number, number, boolean] {
  const sgnd = sign(dp) * sign(dx);
  let stpf: number;
  if (fp > fx) {
    const theta = (3.0 * (fx - fp)) / (stp - stx) + dx + dp;
    const s = Math.max(Math.abs(theta), Math.abs(dx), Math.abs(dp));
    let gamma = s * Math.sqrt(sq(theta / s) - (dx / s) * (dp / s));
    if (stp < stx) gamma *= -1;
    const p = gamma - dx + theta;
    const q = gamma - dx + gamma + dp;
    const r = p / q;
    const stpc = stx + r * (stp - stx);
    const stpq = stx + (dx / ((fx - fp) / (stp - stx) + dx) / 2.0) * (stp - stx);
    stpf = Math.abs(stpc - stx) <= Math.abs(stpq - stx) ? stpc : stpc + (stpq - stpc) / 2.0;
    brackt = true;
  } else if (sgnd < 0.0) {
    const theta = (3 * (fx - fp)) / (stp - stx) + dx + dp;
    const s = Math.max(Math.abs(theta), Math.abs(dx), Math.abs(dp));
    let gamma = s * Math.sqrt(sq(theta / s) - (dx / s) * (dp / s));
    if (stp > stx) gamma *= -1;
    const p = gamma - dp + theta;
    const q = gamma - dp + gamma + dx;
    const r = p / q;
    const stpc = stp + r * (stx - stp);
    const stpq = stp + (dp / (dp - dx)) * (stx - stp);
    stpf = Math.abs(stpc - stp) > Math.abs(stpq - stp) ? stpc : stpq;
    brackt = true;
  } else if (Math.abs(dp) < Math.abs(dx)) {
    const theta = (3 * (fx - fp)) / (stp - stx) + dx + dp;
    const s = Math.max(Math.abs(theta), Math.abs(dx), Math.abs(dp));
    let gamma = s * Math.sqrt(Math.max(0, sq(theta / s) - (dx / s) * (dp / s)));
    if (stp > stx) gamma = -gamma;
    const p = gamma - dp + theta;
    const q = gamma + (dx - dp) + gamma;
    const r = p / q;
    let stpc: number;
    if (r < 0 && gamma !== 0) stpc = stp + r * (stx - stp);
    else if (stp > stx) stpc = stpmax;
    else stpc = stpmin;
    const stpq = stp + (dp / (dp - dx)) * (stx - stp);
    if (brackt) {
      stpf = Math.abs(stpc - stp) < Math.abs(stpq - stp) ? stpc : stpq;
      if (stp > stx) stpf = Math.min(stp + 0.66 * (sty - stp), stpf);
      else stpf = Math.max(stp + 0.66 * (sty - stp), stpf);
    } else {
      stpf = Math.abs(stpc - stp) > Math.abs(stpq - stp) ? stpc : stpq;
      stpf = Math.min(Math.max(stpf, stpmin), stpmax);
    }
  } else if (brackt) {
    const theta = (3.0 * (fp - fy)) / (sty - stp) + dy + dp;
    const s = Math.max(Math.abs(theta), Math.abs(dy), Math.abs(dp));
    let gamma = s * Math.sqrt(sq(theta / s) - (dy / s) * (dp / s));
    if (stp > sty) gamma = -gamma;
    const p = gamma - dp + theta;
    const q = gamma - dp + gamma + dy;
    const r = p / q;
    stpf = stp + r * (sty - stp);
  } else if (stp > stx) stpf = stpmax;
  else stpf = stpmin;
  if (fp > fx) {
    sty = stp;
    fy = fp;
    dy = dp;
  } else {
    if (sgnd < 0) {
      sty = stx;
      fy = fx;
      dy = dx;
    }
    stx = stp;
    fx = fp;
    dx = dp;
  }
  return [stx, fx, dx, sty, fy, dy, stpf, brackt];
}

/** MINPACK-2 dcsrch state machine (reverse communication). */
export class Dcsrch {
  private brackt = false;
  private stage = 1;
  private ginit = 0;
  private gtest = 0;
  private gx = 0;
  private gy = 0;
  private finit = 0;
  private fx = 0;
  private fy = 0;
  private stx = 0;
  private sty = 0;
  private stmin = 0;
  private stmax = 0;
  private width = 0;
  private width1 = 0;

  constructor(
    private readonly ftol: number,
    private readonly gtol: number,
    private readonly xtol: number,
    private readonly stpmin: number,
    private readonly stpmax: number,
  ) {}

  /** One step; task is 'START', 'FG', 'CONVERGENCE', 'WARNING...' or 'ERROR...'. */
  iterate(stp: number, f: number, g: number, task: string): [number, string] {
    if (task.startsWith('START')) {
      if (stp < this.stpmin) task = 'ERROR: STP .LT. STPMIN';
      if (stp > this.stpmax) task = 'ERROR: STP .GT. STPMAX';
      if (g >= 0) task = 'ERROR: INITIAL G .GE. ZERO';
      if (this.stpmax < this.stpmin) task = 'ERROR: STPMAX .LT. STPMIN';
      if (task.startsWith('ERROR')) return [stp, task];
      this.brackt = false;
      this.stage = 1;
      this.finit = f;
      this.ginit = g;
      this.gtest = this.ftol * this.ginit;
      this.width = this.stpmax - this.stpmin;
      this.width1 = this.width / 0.5;
      this.stx = 0;
      this.fx = this.finit;
      this.gx = this.ginit;
      this.sty = 0;
      this.fy = this.finit;
      this.gy = this.ginit;
      this.stmin = 0;
      this.stmax = stp + 4.0 * stp;
      return [stp, 'FG'];
    }
    const ftest = this.finit + stp * this.gtest;
    if (this.stage === 1 && f <= ftest && g >= 0) this.stage = 2;
    if (this.brackt && (stp <= this.stmin || stp >= this.stmax)) task = 'WARNING: ROUNDING ERRORS PREVENT PROGRESS';
    if (this.brackt && this.stmax - this.stmin <= this.xtol * this.stmax) task = 'WARNING: XTOL TEST SATISFIED';
    if (stp === this.stpmax && f <= ftest && g <= this.gtest) task = 'WARNING: STP = STPMAX';
    if (stp === this.stpmin && (f > ftest || g >= this.gtest)) task = 'WARNING: STP = STPMIN';
    if (f <= ftest && Math.abs(g) <= this.gtol * -this.ginit) task = 'CONVERGENCE';
    if (task.startsWith('WARN') || task.startsWith('CONV')) return [stp, task];
    if (this.stage === 1 && f <= this.fx && f > ftest) {
      const fm = f - stp * this.gtest;
      let fxm = this.fx - this.stx * this.gtest;
      let fym = this.fy - this.sty * this.gtest;
      const gm = g - this.gtest;
      let gxm = this.gx - this.gtest;
      let gym = this.gy - this.gtest;
      [this.stx, fxm, gxm, this.sty, fym, gym, stp, this.brackt] = dcstep(this.stx, fxm, gxm, this.sty, fym, gym, stp, fm, gm, this.brackt, this.stmin, this.stmax);
      this.fx = fxm + this.stx * this.gtest;
      this.fy = fym + this.sty * this.gtest;
      this.gx = gxm + this.gtest;
      this.gy = gym + this.gtest;
    } else {
      [this.stx, this.fx, this.gx, this.sty, this.fy, this.gy, stp, this.brackt] = dcstep(this.stx, this.fx, this.gx, this.sty, this.fy, this.gy, stp, f, g, this.brackt, this.stmin, this.stmax);
    }
    if (this.brackt) {
      if (Math.abs(this.sty - this.stx) >= 0.66 * this.width1) stp = this.stx + 0.5 * (this.sty - this.stx);
      this.width1 = this.width;
      this.width = Math.abs(this.sty - this.stx);
    }
    if (this.brackt) {
      this.stmin = Math.min(this.stx, this.sty);
      this.stmax = Math.max(this.stx, this.sty);
    } else {
      this.stmin = stp + 1.1 * (stp - this.stx);
      this.stmax = stp + 4.0 * (stp - this.stx);
    }
    stp = Math.min(Math.max(stp, this.stpmin), this.stpmax);
    if ((this.brackt && (stp <= this.stmin || stp >= this.stmax)) || (this.brackt && this.stmax - this.stmin <= this.xtol * this.stmax)) stp = this.stx;
    return [stp, 'FG'];
  }
}

// ------------------------------------------------------------------ BFGS (SciPy _minimize_bfgs)

interface Evaluator {
  f(x: number[]): number;
  grad(x: number[]): number[];
}

/** ScalarFunction-like evaluator: the gradient at x reuses f(x). */
function evaluator(fun: Objective, absStep: number, lb?: number[], ub?: number[]): Evaluator {
  let lastX: number[] | null = null;
  let lastF = 0;
  const f = (x: number[]): number => {
    if (lastX && lastX.length === x.length && lastX.every((v, i) => v === x[i])) return lastF;
    lastX = x.slice();
    lastF = fun(x.slice());
    return lastF;
  };
  return { f, grad: (x) => approxGrad((y) => fun(y), x, f(x), absStep, lb, ub) };
}

const axpy = (x: readonly number[], s: number, p: readonly number[]): number[] => x.map((v, i) => v + s * p[i]!);

function lineSearchWolfe1(ev: Evaluator, xk: number[], pk: number[], gfk: number[], oldFval: number, oldOldFval: number): { alpha: number | null; fval: number; oldFval: number; g: number[] | null } {
  let gval: number[] = gfk;
  const phi = (s: number): number => ev.f(axpy(xk, s, pk));
  const derphi = (s: number): number => {
    gval = ev.grad(axpy(xk, s, pk));
    return dot(gval, pk);
  };
  const derphi0 = dot(gfk, pk);
  const phi0 = oldFval;
  let alpha1 = 1.0;
  if (derphi0 !== 0) {
    alpha1 = Math.min(1.0, (1.01 * 2 * (phi0 - oldOldFval)) / derphi0);
    if (alpha1 < 0) alpha1 = 1.0;
  }
  const ls = new Dcsrch(1e-4, 0.9, 1e-14, 1e-100, 1e100);
  let phi1 = phi0;
  let derphi1 = derphi0;
  let task = 'START';
  let stp: number | null = alpha1;
  let i = 0;
  for (; i < 100; i++) {
    let s: number;
    [s, task] = ls.iterate(stp!, phi1, derphi1, task);
    stp = s;
    if (!Number.isFinite(stp)) {
      stp = null;
      task = 'WARN';
      break;
    }
    if (task.startsWith('FG')) {
      phi1 = phi(stp);
      derphi1 = derphi(stp);
    } else break;
  }
  if (i === 100) stp = null;
  if (task.startsWith('ERROR') || task.startsWith('WARN')) stp = null;
  return { alpha: stp, fval: phi1, oldFval: phi0, g: gval };
}

function cubicmin(a: number, fa: number, fpa: number, b: number, fb: number, c: number, fc: number): number | null {
  const C = fpa;
  const db = b - a;
  const dc = c - a;
  const denom = sq(db * dc) * (db - dc);
  const r0 = fb - fa - C * db;
  const r1 = fc - fa - C * dc;
  let A = sq(dc) * r0 + -(sq(db)) * r1;
  let B = -(cube(dc)) * r0 + cube(db) * r1;
  if (denom === 0) return null;
  A /= denom;
  B /= denom;
  const radical = B * B - 3 * A * C;
  if (radical < 0 || A === 0) return null;
  const xmin = a + (-B + Math.sqrt(radical)) / (3 * A);
  return Number.isFinite(xmin) ? xmin : null;
}

function quadmin(a: number, fa: number, fpa: number, b: number, fb: number): number | null {
  const D = fa;
  const C = fpa;
  const db = b - a * 1.0;
  if (db === 0) return null;
  const B = (fb - D - C * db) / (db * db);
  if (B === 0) return null;
  const xmin = a - C / (2.0 * B);
  return Number.isFinite(xmin) ? xmin : null;
}

function lineSearchWolfe2(ev: Evaluator, xk: number[], pk: number[], gfk: number[], oldFval: number, oldOldFval: number): { alpha: number | null; fval: number; oldFval: number; g: number[] | null } {
  const c1 = 1e-4;
  const c2 = 0.9;
  let gval: number[] | null = null;
  const phi = (a: number): number => ev.f(axpy(xk, a, pk));
  const derphi = (a: number): number => {
    gval = ev.grad(axpy(xk, a, pk));
    return dot(gval, pk);
  };
  const derphi0 = dot(gfk, pk);
  let phi0 = oldFval;
  let alpha0 = 0;
  let alpha1 = derphi0 !== 0 ? Math.min(1.0, (1.01 * 2 * (phi0 - oldOldFval)) / derphi0) : 1.0;
  if (alpha1 < 0) alpha1 = 1.0;
  alpha1 = Math.min(alpha1, 1e100);
  let phiA1 = phi(alpha1);
  let phiA0 = phi0;
  let derphiA0 = derphi0;
  let alphaStar: number | null = null;
  let phiStar = phi0;
  let derphiStar: number | null = null;
  const zoom = (aLo: number, aHi: number, phiLo: number, phiHi: number, derphiLo: number): [number | null, number, number | null] => {
    let phiRec = phi0;
    let aRec = 0;
    let i = 0;
    let aJ: number | null = null;
    for (;;) {
      const dalpha = aHi - aLo;
      const a = dalpha < 0 ? aHi : aLo;
      const b = dalpha < 0 ? aLo : aHi;
      let cchk = 0;
      if (i > 0) {
        cchk = 0.2 * dalpha;
        aJ = cubicmin(aLo, phiLo, derphiLo, aHi, phiHi, aRec, phiRec);
      }
      if (i === 0 || aJ === null || aJ > b - cchk || aJ < a + cchk) {
        const qchk = 0.1 * dalpha;
        aJ = quadmin(aLo, phiLo, derphiLo, aHi, phiHi);
        if (aJ === null || aJ > b - qchk || aJ < a + qchk) aJ = aLo + 0.5 * dalpha;
      }
      const phiAj = phi(aJ);
      if (phiAj > phi0 + c1 * aJ * derphi0 || phiAj >= phiLo) {
        phiRec = phiHi;
        aRec = aHi;
        aHi = aJ;
        phiHi = phiAj;
      } else {
        const derphiAj = derphi(aJ);
        if (Math.abs(derphiAj) <= -c2 * derphi0) return [aJ, phiAj, derphiAj];
        if (derphiAj * (aHi - aLo) >= 0) {
          phiRec = phiHi;
          aRec = aHi;
          aHi = aLo;
          phiHi = phiLo;
        } else {
          phiRec = phiLo;
          aRec = aLo;
        }
        aLo = aJ;
        phiLo = phiAj;
        derphiLo = derphiAj;
      }
      i += 1;
      if (i > 10) return [null, NaN, null];
    }
  };
  let done = false;
  for (let i = 0; i < 10; i++) {
    if (alpha1 === 0 || alpha0 > 1e100) {
      alphaStar = null;
      phiStar = phi0;
      phi0 = oldOldFval;
      derphiStar = null;
      done = true;
      break;
    }
    if (phiA1 > phi0 + c1 * alpha1 * derphi0 || (phiA1 >= phiA0 && i > 0)) {
      [alphaStar, phiStar, derphiStar] = zoom(alpha0, alpha1, phiA0, phiA1, derphiA0);
      done = true;
      break;
    }
    const derphiA1 = derphi(alpha1);
    if (Math.abs(derphiA1) <= -c2 * derphi0) {
      alphaStar = alpha1;
      phiStar = phiA1;
      derphiStar = derphiA1;
      done = true;
      break;
    }
    if (derphiA1 >= 0) {
      [alphaStar, phiStar, derphiStar] = zoom(alpha1, alpha0, phiA1, phiA0, derphiA1);
      done = true;
      break;
    }
    const alpha2 = Math.min(2 * alpha1, 1e100);
    alpha0 = alpha1;
    alpha1 = alpha2;
    phiA0 = phiA1;
    phiA1 = phi(alpha1);
    derphiA0 = derphiA1;
  }
  if (!done) {
    alphaStar = alpha1;
    phiStar = phiA1;
    derphiStar = null;
  }
  return { alpha: alphaStar, fval: phiStar, oldFval: phi0, g: derphiStar === null ? null : gval };
}

/** SciPy minimize(method='BFGS') with finite-difference gradients. */
export function minimizeBFGS(fun: Objective, x0: readonly number[], gtol = 1e-5, callback?: (x: number[]) => void): MinimizeResult {
  const ev = evaluator(fun, SQRT_EPS);
  const N = x0.length;
  const maxiter = N * 200;
  let xk = x0.slice();
  let oldFval = ev.f(xk);
  let gfk = ev.grad(xk);
  let k = 0;
  let Hk: number[][] = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 1 : 0)));
  let oldOldFval = oldFval + l2(gfk) / 2;
  let warnflag = 0;
  let gnorm = infNorm(gfk);
  while (gnorm > gtol && k < maxiter) {
    // numpy's dot of a 2x2 matrix and a vector runs through OpenBLAS's FMA kernel: fma(a0, g0, a1 * g1).
    const pk = N === 2 ? Hk.map((row) => -fma(row[0]!, gfk[0]!, row[1]! * gfk[1]!)) : Hk.map((row) => -dot(row, gfk));
    let ls = lineSearchWolfe1(ev, xk, pk, gfk, oldFval, oldOldFval);
    if (ls.alpha === null) ls = lineSearchWolfe2(ev, xk, pk, gfk, oldFval, oldOldFval);
    if (ls.alpha === null) {
      warnflag = 2;
      break;
    }
    const alphaK = ls.alpha;
    oldOldFval = ls.oldFval;
    oldFval = ls.fval;
    const sk = pk.map((p) => alphaK * p);
    const xkp1 = xk.map((v, i) => v + sk[i]!);
    xk = xkp1;
    const gfkp1 = ls.g ?? ev.grad(xkp1);
    const yk = gfkp1.map((v, i) => v - gfk[i]!);
    gfk = gfkp1;
    k += 1;
    callback?.(xk.slice());
    gnorm = infNorm(gfk);
    if (gnorm <= gtol) break;
    if (!Number.isFinite(oldFval)) {
      warnflag = 2;
      break;
    }
    const rhokInv = dot(yk, sk);
    const rhok = rhokInv === 0 ? 1000.0 : 1 / rhokInv;
    const A1 = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 1 : 0) - sk[i]! * yk[j]! * rhok));
    const A2 = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 1 : 0) - yk[i]! * sk[j]! * rhok));
    const HA2 = N === 2 ? matmul2(Hk, A2) : matmul(Hk, A2);
    const prod = N === 2 ? matmul2(A1, HA2) : matmul(A1, HA2);
    Hk = prod.map((row, i) => row.map((v, j) => v + rhok * sk[i]! * sk[j]!));
  }
  if (k >= maxiter && warnflag === 0) warnflag = 1;
  return { x: xk, fun: oldFval, success: warnflag === 0, nit: k, message: warnflag === 0 ? 'Optimization terminated successfully.' : warnflag === 2 ? 'Desired error not necessarily achieved due to precision loss.' : 'Maximum number of iterations has been exceeded.' };
}

/** numpy's 2x2 matrix product through OpenBLAS: fma(a1, b1, a0 * b0) per entry. */
function matmul2(A: number[][], B: number[][]): number[][] {
  return [0, 1].map((i) => [0, 1].map((j) => fma(A[i]![1]!, B[1]![j]!, A[i]![0]! * B[0]![j]!)));
}

function matmul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0]!.length;
  const K = B.length;
  const C: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let k = 0; k < K; k++) s += A[i]![k]! * B[k]![j]!;
      row.push(s);
    }
    C.push(row);
  }
  return C;
}

// ------------------------------------------------------------------ L-BFGS-B (version 3.0)

/** Solve the symmetric positive definite system A x = b (Cholesky). */
function cholSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (!(s > 0)) return null;
        L[i]![i] = Math.sqrt(s);
      } else L[i]![j] = s / L[j]![j]!;
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

/** The L-BFGS matrix B = BFGS updates of theta*I by the stored (s, y) pairs, oldest first. */
function lbfgsMatrix(n: number, theta: number, S: number[][], Y: number[][]): number[][] {
  let B: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? theta : 0)));
  for (let p = 0; p < S.length; p++) {
    const s = S[p]!;
    const y = Y[p]!;
    const Bs = B.map((row) => dot(row, s));
    const sBs = dot(s, Bs);
    const ys = dot(y, s);
    B = B.map((row, i) => row.map((v, j) => v - (Bs[i]! * Bs[j]!) / sBs + (y[i]! * y[j]!) / ys));
  }
  return B;
}

function projgr(x: number[], g: number[], l: readonly number[], u: readonly number[], nbd: readonly number[]): number {
  let sbgnrm = 0;
  for (let i = 0; i < x.length; i++) {
    let gi = g[i]!;
    if (nbd[i] !== 0) {
      if (gi < 0) {
        if (nbd[i]! >= 2) gi = Math.max(x[i]! - u[i]!, gi);
      } else if (nbd[i]! <= 2) gi = Math.min(x[i]! - l[i]!, gi);
    }
    sbgnrm = Math.max(sbgnrm, Math.abs(gi));
  }
  return sbgnrm;
}

/** SciPy minimize(method='L-BFGS-B') with finite-difference gradients. */
export function minimizeLBFGSB(fun: Objective, x0in: readonly number[], bounds?: Bounds, callback?: (x: number[]) => void): MinimizeResult {
  const n = x0in.length;
  const m = 10;
  const pgtol = 1e-5;
  const tol = (2.2204460492503131e-9 / EPS) * EPS;
  const maxls = 20;
  const maxiter = 15000;
  const maxfun = 15000;
  const l = new Array<number>(n).fill(0);
  const u = new Array<number>(n).fill(0);
  const nbd = new Array<number>(n).fill(0);
  const lb = new Array<number>(n).fill(-Infinity);
  const ub = new Array<number>(n).fill(Infinity);
  let x = x0in.slice();
  if (bounds) {
    if (bounds.length !== n && bounds.length !== 1) throw new Error('length of x0 != length of bounds');
    for (let i = 0; i < n; i++) {
      const [lo, hi] = bounds.length === 1 ? bounds[0]! : bounds[i]!;
      lb[i] = lo;
      ub[i] = hi;
      x[i] = Math.min(Math.max(x[i]!, lo), hi);
      const hasL = Number.isFinite(lo);
      const hasU = Number.isFinite(hi);
      if (hasL) l[i] = lo;
      if (hasU) u[i] = hi;
      nbd[i] = hasL && hasU ? 2 : hasL ? 1 : hasU ? 3 : 0;
    }
  }
  let nfev = 0;
  const fg = (xx: number[]): [number, number[]] => {
    nfev++;
    const f0 = fun(xx.slice());
    nfev += n;
    return [f0, approxGrad(fun, xx, f0, 1e-8, lb, ub)];
  };
  const cnstnd = nbd.some((b) => b !== 0);
  const boxed = nbd.every((b) => b === 2);
  // active: project x, set iwhere
  const iwhere = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (nbd[i]! > 0) {
      if (nbd[i]! <= 2 && x[i]! <= l[i]!) x[i] = l[i]!;
      if (nbd[i]! >= 2 && x[i]! >= u[i]!) x[i] = u[i]!;
    }
    iwhere[i] = nbd[i] === 0 ? -1 : nbd[i] === 2 && u[i]! - l[i]! <= 0 ? 3 : 0;
  }
  let [f, g] = fg(x);
  let sbgnrm = projgr(x, g, l, u, nbd);
  if (sbgnrm <= pgtol) return { x, fun: f, success: true, nit: 0, message: 'CONVERGENCE: NORM_OF_PROJECTED_GRADIENT_<=_PGTOL' };
  let S: number[][] = [];
  let Y: number[][] = [];
  let theta = 1;
  let iter = 0;
  for (;;) {
    const col = S.length;
    const B = lbfgsMatrix(n, theta, S, Y);
    let z: number[];
    let free: number[];
    if (!cnstnd && col > 0) {
      z = x.slice();
      free = Array.from({ length: n }, (_, i) => i);
    } else {
      z = cauchy(x, g, l, u, nbd, iwhere, B, sbgnrm);
      free = [];
      for (let i = 0; i < n; i++) if (iwhere[i]! <= 0) free.push(i);
    }
    if (free.length > 0 && col > 0) {
      // Subspace minimisation from the Cauchy point over the free variables.
      const c = z.map((v, i) => v - x[i]!);
      const Bc = B.map((row) => dot(row, c));
      const r = free.map((k) => -(Bc[k]! + g[k]!));
      const Bf = free.map((i) => free.map((j) => B[i]![j]!));
      const d = cholSolve(Bf, r);
      if (d) subsmProject(z, x, g, d, free, l, u, nbd);
    }
    const d = z.map((v, i) => v - x[i]!);
    // ---- line search (lnsrlb)
    const dtd = dot(d, d);
    const dnorm = Math.sqrt(dtd);
    let stpmx = 1e10;
    if (cnstnd) {
      if (iter === 0) stpmx = 1;
      else {
        for (let i = 0; i < n; i++) {
          const a1 = d[i]!;
          if (nbd[i] !== 0) {
            if (a1 < 0 && nbd[i]! <= 2) {
              const a2 = l[i]! - x[i]!;
              if (a2 >= 0) stpmx = 0;
              else if (a1 * stpmx < a2) stpmx = a2 / a1;
            } else if (a1 > 0 && nbd[i]! >= 2) {
              const a2 = u[i]! - x[i]!;
              if (a2 <= 0) stpmx = 0;
              else if (a1 * stpmx > a2) stpmx = a2 / a1;
            }
          }
        }
      }
    }
    let stp = iter === 0 && !boxed ? Math.min(1 / dnorm, stpmx) : 1;
    const t = x.slice();
    const r = g.slice();
    const fold = f;
    let ifun = 0;
    let task = 'START';
    let gd = dot(g, d);
    const gdold = gd;
    let failed = gd >= 0;
    const ls = new Dcsrch(1e-3, 0.9, 0.1, 0, stpmx);
    if (!failed) {
      for (;;) {
        [stp, task] = ls.iterate(stp, f, gd, task);
        if (task.startsWith('CONV') || task.startsWith('WARN')) break;
        if (task.startsWith('ERROR')) {
          failed = true;
          break;
        }
        ifun += 1;
        if (ifun - 1 >= maxls) {
          failed = true;
          break;
        }
        x = stp === 1 ? z.slice() : d.map((di, i) => stp * di + t[i]!);
        [f, g] = fg(x);
        gd = dot(g, d);
      }
    }
    if (failed) {
      x = t;
      g = r;
      f = fold;
      if (col === 0) return { x, fun: f, success: false, nit: iter + 1, message: 'ABNORMAL_TERMINATION_IN_LNSRCH' };
      S = [];
      Y = [];
      theta = 1;
      continue;
    }
    iter += 1;
    callback?.(x.slice());
    sbgnrm = projgr(x, g, l, u, nbd);
    if (iter >= maxiter) return { x, fun: f, success: false, nit: iter, message: 'STOP: TOTAL NO. of ITERATIONS REACHED LIMIT' };
    if (nfev > maxfun) return { x, fun: f, success: false, nit: iter, message: 'STOP: TOTAL NO. of f AND g EVALUATIONS EXCEEDS LIMIT' };
    if (sbgnrm <= pgtol) return { x, fun: f, success: true, nit: iter, message: 'CONVERGENCE: NORM_OF_PROJECTED_GRADIENT_<=_PGTOL' };
    const ddum0 = Math.max(Math.abs(fold), Math.abs(f), 1);
    if (fold - f <= tol * ddum0) return { x, fun: f, success: true, nit: iter, message: 'CONVERGENCE: REL_REDUCTION_OF_F_<=_FACTR*EPSMCH' };
    const yv = g.map((v, i) => v - r[i]!);
    const rr = dot(yv, yv);
    let dr: number;
    let ddum: number;
    let sv = d;
    if (stp === 1) {
      dr = gd - gdold;
      ddum = -gdold;
    } else {
      dr = (gd - gdold) * stp;
      sv = d.map((v) => stp * v);
      ddum = -gdold * stp;
    }
    if (dr <= EPS * ddum) continue;
    if (S.length === m) {
      S.shift();
      Y.shift();
    }
    S.push(sv);
    Y.push(yv);
    theta = rr / dr;
  }
}

/** Generalized Cauchy point along the projected steepest descent path (Fortran `cauchy`). Updates iwhere. */
function cauchy(x: number[], g: number[], l: number[], u: number[], nbd: number[], iwhere: number[], B: number[][], sbgnrm: number): number[] {
  const n = x.length;
  const xcp = x.slice();
  if (sbgnrm <= 0) return xcp;
  const d = new Array<number>(n).fill(0);
  const breaks: { i: number; t: number }[] = [];
  let bnded = true;
  let nfree = n + 1;
  let f1 = 0;
  for (let i = 0; i < n; i++) {
    const neggi = -g[i]!;
    let tl = 0;
    let tu = 0;
    if (iwhere[i] !== 3 && iwhere[i] !== -1) {
      if (nbd[i]! <= 2) tl = x[i]! - l[i]!;
      if (nbd[i]! >= 2) tu = u[i]! - x[i]!;
      const xlower = nbd[i]! <= 2 && tl <= 0;
      const xupper = nbd[i]! >= 2 && tu <= 0;
      iwhere[i] = 0;
      if (xlower) {
        if (neggi <= 0) iwhere[i] = 1;
      } else if (xupper) {
        if (neggi >= 0) iwhere[i] = 2;
      } else if (Math.abs(neggi) <= 0) iwhere[i] = -3;
    }
    if (iwhere[i] !== 0 && iwhere[i] !== -1) d[i] = 0;
    else {
      d[i] = neggi;
      f1 -= neggi * neggi;
      if (nbd[i]! <= 2 && nbd[i] !== 0 && neggi < 0) breaks.push({ i, t: tl / -neggi });
      else if (nbd[i]! >= 2 && neggi > 0) breaks.push({ i, t: tu / neggi });
      else {
        nfree -= 1;
        if (Math.abs(neggi) > 0) bnded = false;
      }
    }
  }
  if (breaks.length === 0 && nfree === n + 1) return xcp;
  const Bd = (): number[] => B.map((row) => dot(row, d));
  let BD = Bd();
  let f2 = dot(d, BD);
  const f2org = f2;
  let dtm = -f1 / f2;
  let tsum = 0;
  if (breaks.length > 0) {
    breaks.sort((a, b) => a.t - b.t || a.i - b.i);
    let tj = 0;
    let nleft = breaks.length;
    let k = 0;
    let reachedAll = false;
    for (;;) {
      const tj0 = tj;
      tj = breaks[k]!.t;
      const ibp = breaks[k]!.i;
      const dt = tj - tj0;
      if (dtm < dt) break;
      tsum += dt;
      nleft -= 1;
      k += 1;
      const dibp = d[ibp]!;
      d[ibp] = 0;
      if (dibp > 0) {
        xcp[ibp] = u[ibp]!;
        iwhere[ibp] = 2;
      } else {
        xcp[ibp] = l[ibp]!;
        iwhere[ibp] = 1;
      }
      if (nleft === 0 && breaks.length === n) {
        dtm = dt;
        reachedAll = true;
        break;
      }
      // Derivatives of the model along the next segment, from the breakpoint xcp(tsum).
      const c = x.map((xi, i) => (d[i] !== 0 ? tsum * d[i]! : xcp[i]! - xi));
      BD = Bd();
      f1 = dot(g, d) + dot(c, BD);
      f2 = dot(d, BD);
      f2 = Math.max(EPS * f2org, f2);
      if (nleft > 0) {
        dtm = -f1 / f2;
        continue;
      } else if (bnded) {
        dtm = 0;
      } else dtm = -f1 / f2;
      break;
    }
    if (reachedAll) return xcp;
  }
  if (dtm <= 0) dtm = 0;
  tsum += dtm;
  for (let i = 0; i < n; i++) xcp[i] = xcp[i]! + tsum * d[i]!;
  return xcp;
}

/** Version 3.0 subspace step: try the projected Newton point, else backtrack along d from the Cauchy point. */
function subsmProject(z: number[], xx: number[], gg: number[], d: number[], ind: number[], l: number[], u: number[], nbd: number[]): void {
  const xp = z.slice();
  let iword = 0;
  for (let i = 0; i < ind.length; i++) {
    const k = ind[i]!;
    const dk = d[i]!;
    const xk = z[k]!;
    if (nbd[k] !== 0) {
      if (nbd[k] === 1) {
        z[k] = Math.max(l[k]!, xk + dk);
        if (z[k] === l[k]) iword = 1;
      } else if (nbd[k] === 2) {
        const t = Math.max(l[k]!, xk + dk);
        z[k] = Math.min(u[k]!, t);
        if (z[k] === l[k] || z[k] === u[k]) iword = 1;
      } else if (nbd[k] === 3) {
        z[k] = Math.min(u[k]!, xk + dk);
        if (z[k] === u[k]) iword = 1;
      }
    } else z[k] = xk + dk;
  }
  if (iword === 0) return;
  let ddP = 0;
  for (let i = 0; i < z.length; i++) ddP += (z[i]! - xx[i]!) * gg[i]!;
  if (!(ddP > 0)) return;
  for (let i = 0; i < z.length; i++) z[i] = xp[i]!;
  let alpha = 1;
  let temp1 = alpha;
  let ibd = -1;
  for (let i = 0; i < ind.length; i++) {
    const k = ind[i]!;
    const dk = d[i]!;
    if (nbd[k] !== 0) {
      if (dk < 0 && nbd[k]! <= 2) {
        const temp2 = l[k]! - z[k]!;
        if (temp2 >= 0) temp1 = 0;
        else if (dk * alpha < temp2) temp1 = temp2 / dk;
      } else if (dk > 0 && nbd[k]! >= 2) {
        const temp2 = u[k]! - z[k]!;
        if (temp2 <= 0) temp1 = 0;
        else if (dk * alpha > temp2) temp1 = temp2 / dk;
      }
      if (temp1 < alpha) {
        alpha = temp1;
        ibd = i;
      }
    }
  }
  if (alpha < 1 && ibd >= 0) {
    const dk = d[ibd]!;
    const k = ind[ibd]!;
    if (dk > 0) {
      z[k] = u[k]!;
      d[ibd] = 0;
    } else if (dk < 0) {
      z[k] = l[k]!;
      d[ibd] = 0;
    }
  }
  for (let i = 0; i < ind.length; i++) {
    const k = ind[i]!;
    z[k] = z[k]! + alpha * d[i]!;
  }
}

/** scipy.optimize.minimize as GarmentCode calls it: BFGS without bounds, L-BFGS-B with bounds or when asked. */
export function minimize(fun: Objective, x0: readonly number[], opts: { bounds?: Bounds; method?: 'BFGS' | 'L-BFGS-B' } = {}): MinimizeResult {
  const method = opts.method ?? (opts.bounds ? 'L-BFGS-B' : 'BFGS');
  return method === 'BFGS' ? minimizeBFGS(fun, x0) : minimizeLBFGSB(fun, x0, opts.bounds);
}
