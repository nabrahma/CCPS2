/**
 * Small dense solvers and a sparse conjugate-gradient solver (PRD Part 3, 3.2).
 *
 * Everything runs a fixed amount of work in a fixed order (PRD Part 3, 0.2
 * rule 4): no pivoting choices that depend on anything but the numbers, no
 * time-based stops. Matrices are row-major Float64Array.
 */

/** Cholesky factor L (lower, row-major) of a symmetric positive-definite n x n matrix, or null if it is not. */
export function cholesky(a: Float64Array, n: number): Float64Array | null {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= l[i * n + k]! * l[j * n + k]!;
      if (i === j) {
        if (!(sum > 0)) return null;
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j]!;
      }
    }
  }
  return l;
}

/** Solve L Lt x = b for one right-hand side. */
export function choleskySolve(l: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= l[i * n + k]! * x[k]!;
    x[i] = sum / l[i * n + i]!;
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i]! * x[k]!;
    x[i] = sum / l[i * n + i]!;
  }
  return x;
}

/** Solve A x = b for symmetric positive-definite A; null if A is not positive definite. */
export function solveSpd(a: Float64Array, n: number, b: ArrayLike<number>): Float64Array | null {
  const l = cholesky(a, n);
  return l ? choleskySolve(l, n, b) : null;
}

/**
 * L D Lt factorisation (no pivoting) of a symmetric matrix: returns L (unit
 * lower, row-major) and D, or null when a pivot is zero. For symmetric
 * indefinite systems that are known to be well conditioned.
 */
export function ldlt(a: Float64Array, n: number): { l: Float64Array; d: Float64Array } | null {
  const l = new Float64Array(n * n);
  const d = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let dj = a[j * n + j]!;
    for (let k = 0; k < j; k++) dj -= l[j * n + k]! * l[j * n + k]! * d[k]!;
    if (dj === 0 || dj !== dj) return null;
    d[j] = dj;
    l[j * n + j] = 1;
    for (let i = j + 1; i < n; i++) {
      let sum = a[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= l[i * n + k]! * l[j * n + k]! * d[k]!;
      l[i * n + j] = sum / dj;
    }
  }
  return { l, d };
}

export function ldltSolve(f: { l: Float64Array; d: Float64Array }, n: number, b: ArrayLike<number>): Float64Array {
  const { l, d } = f;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= l[i * n + k]! * x[k]!;
    x[i] = sum;
  }
  for (let i = 0; i < n; i++) x[i] = x[i]! / d[i]!;
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i]! * x[k]!;
    x[i] = sum;
  }
  return x;
}

/** A sparse matrix in compressed-row form. */
export interface Csr {
  n: number;
  rowStart: Uint32Array;
  col: Uint32Array;
  val: Float64Array;
}

/** Build a CSR matrix from (row, col, value) triples; duplicates are summed, columns sorted. */
export function csrFromTriples(n: number, rows: ArrayLike<number>, cols: ArrayLike<number>, vals: ArrayLike<number>): Csr {
  const count = new Uint32Array(n + 1);
  for (let i = 0; i < rows.length; i++) count[rows[i]! + 1] = count[rows[i]! + 1]! + 1;
  for (let i = 0; i < n; i++) count[i + 1] = count[i + 1]! + count[i]!;
  const order = new Uint32Array(rows.length);
  const fill = count.slice(0, n);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    order[fill[r]!] = i;
    fill[r] = fill[r]! + 1;
  }
  const rowStart = new Uint32Array(n + 1);
  const col: number[] = [];
  const val: number[] = [];
  for (let r = 0; r < n; r++) {
    const items: [number, number][] = [];
    for (let k = count[r]!; k < count[r + 1]!; k++) items.push([cols[order[k]!]!, vals[order[k]!]!]);
    items.sort((p, q) => p[0] - q[0]);
    rowStart[r] = col.length;
    for (let k = 0; k < items.length; k++) {
      if (col.length > rowStart[r]! && col[col.length - 1] === items[k]![0]) val[val.length - 1] = val[val.length - 1]! + items[k]![1];
      else {
        col.push(items[k]![0]);
        val.push(items[k]![1]);
      }
    }
  }
  rowStart[n] = col.length;
  return { n, rowStart, col: Uint32Array.from(col), val: Float64Array.from(val) };
}

export function csrMultiply(m: Csr, x: Float64Array, out: Float64Array): void {
  for (let r = 0; r < m.n; r++) {
    let sum = 0;
    for (let k = m.rowStart[r]!; k < m.rowStart[r + 1]!; k++) sum += m.val[k]! * x[m.col[k]!]!;
    out[r] = sum;
  }
}

/**
 * Conjugate gradient for a symmetric positive-definite sparse system, with
 * a Jacobi preconditioner. Runs exactly `iterations` steps unless the
 * residual becomes exactly zero (a fixed amount of work, PRD 0.2 rule 4).
 */
export function conjugateGradient(m: Csr, b: Float64Array, iterations: number, x0?: Float64Array): Float64Array {
  const n = m.n;
  const x = x0 ? Float64Array.from(x0) : new Float64Array(n);
  const inv = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    let diag = 1;
    for (let k = m.rowStart[r]!; k < m.rowStart[r + 1]!; k++) if (m.col[k] === r) diag = m.val[k]!;
    inv[r] = diag !== 0 ? 1 / diag : 1;
  }
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const ap = new Float64Array(n);
  csrMultiply(m, x, ap);
  let rz = 0;
  for (let i = 0; i < n; i++) {
    r[i] = b[i]! - ap[i]!;
    z[i] = inv[i]! * r[i]!;
    p[i] = z[i]!;
    rz += r[i]! * z[i]!;
  }
  for (let it = 0; it < iterations; it++) {
    if (rz === 0) break;
    csrMultiply(m, p, ap);
    let pap = 0;
    for (let i = 0; i < n; i++) pap += p[i]! * ap[i]!;
    if (pap === 0) break;
    const alpha = rz / pap;
    let next = 0;
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * ap[i]!;
      z[i] = inv[i]! * r[i]!;
      next += r[i]! * z[i]!;
    }
    const beta = next / rz;
    rz = next;
    for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
  }
  return x;
}

export interface LmProblem {
  /** Number of parameters. */
  n: number;
  /** Number of residuals. */
  m: number;
  /** Residuals r(p) (already weighted), written into `out`. */
  residuals(p: Float64Array, out: Float64Array): void;
  /** Jacobian dr_i/dp_j, row-major m x n, written into `out`. */
  jacobian(p: Float64Array, out: Float64Array): void;
  lower: ArrayLike<number>;
  upper: ArrayLike<number>;
}

export interface LmResult {
  p: Float64Array;
  /** Sum of squared residuals at p. */
  cost: number;
  iterations: number;
}

/**
 * Projected Levenberg-Marquardt for box-constrained least squares, with a
 * fixed number of iterations. Each iteration solves
 * (JtJ + lambda diag(JtJ)) step = -Jt r, with the parameters that sit on a
 * bound and want to leave the box held fixed, projects the step into the box,
 * and accepts it only if the cost goes down (lambda is then divided by 3,
 * else multiplied by 4 and the step retried on the next iteration).
 */
export function levenbergMarquardt(problem: LmProblem, start: ArrayLike<number>, iterations: number, lambda0 = 1e-3): LmResult {
  const { n, m } = problem;
  const clamp = (v: number, j: number) => Math.min(problem.upper[j]!, Math.max(problem.lower[j]!, v));
  let p = new Float64Array(n);
  for (let j = 0; j < n; j++) p[j] = clamp(start[j]!, j);
  const r = new Float64Array(m);
  const trial = new Float64Array(m);
  const jac = new Float64Array(m * n);
  const cost = (res: Float64Array) => {
    let s = 0;
    for (let i = 0; i < m; i++) s += res[i]! * res[i]!;
    return s;
  };
  problem.residuals(p, r);
  let current = cost(r);
  let lambda = lambda0;
  let fresh = true;
  const jtj = new Float64Array(n * n);
  const jtr = new Float64Array(n);
  let done = 0;
  for (let it = 0; it < iterations; it++) {
    done = it + 1;
    if (fresh) {
      problem.jacobian(p, jac);
      jtj.fill(0);
      jtr.fill(0);
      for (let i = 0; i < m; i++) {
        const row = i * n;
        const ri = r[i]!;
        for (let a = 0; a < n; a++) {
          const ja = jac[row + a]!;
          if (ja === 0) continue;
          jtr[a] = jtr[a]! + ja * ri;
          for (let b = a; b < n; b++) jtj[a * n + b] = jtj[a * n + b]! + ja * jac[row + b]!;
        }
      }
      for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) jtj[a * n + b] = jtj[b * n + a]!;
      fresh = false;
    }
    // Free set: parameters not pinned against a bound by the gradient.
    const free: number[] = [];
    for (let j = 0; j < n; j++) {
      const atLower = p[j]! <= problem.lower[j]! && jtr[j]! > 0;
      const atUpper = p[j]! >= problem.upper[j]! && jtr[j]! < 0;
      if (!atLower && !atUpper) free.push(j);
    }
    const k = free.length;
    if (k === 0) continue;
    const a = new Float64Array(k * k);
    const g = new Float64Array(k);
    for (let x = 0; x < k; x++) {
      g[x] = -jtr[free[x]!]!;
      for (let y = 0; y < k; y++) a[x * k + y] = jtj[free[x]! * n + free[y]!]!;
      const d = jtj[free[x]! * n + free[x]!]!;
      a[x * k + x] = d + lambda * (d > 0 ? d : 1);
    }
    const step = solveSpd(a, k, g);
    if (!step) {
      lambda *= 4;
      continue;
    }
    const next = Float64Array.from(p);
    for (let x = 0; x < k; x++) next[free[x]!] = clamp(p[free[x]!]! + step[x]!, free[x]!);
    problem.residuals(next, trial);
    const c = cost(trial);
    if (c < current) {
      p = next;
      r.set(trial);
      current = c;
      lambda = Math.max(lambda / 3, 1e-12);
      fresh = true;
    } else {
      lambda = Math.min(lambda * 4, 1e12);
    }
  }
  return { p, cost: current, iterations: done };
}
