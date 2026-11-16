/**
 * Seeded distributions for generators (PRD Part 3, 0.2 rule 3). All of them
 * draw only from `Rng` and use only `dmath`, with fixed algorithms, so a seed
 * gives the same numbers in every JavaScript engine:
 *
 * - normal: Box-Muller (the cosine branch; two uniforms per draw);
 * - truncated normal: redraw until inside the bound;
 * - Beta: Cheng's BB (both shapes > 1) and BC (otherwise), "Generating Beta
 *   Variates with Nonintegral Shape Parameters", CACM 1978, as laid out in
 *   R's rbeta.c;
 * - Dirichlet(1, ..., 1): normalised exponentials.
 */
import type { Rng } from '../random';
import { cos, exp, log, TAU } from './dmath';

/** Standard normal. */
export function normal(rng: Rng): number {
  const u1 = 1 - rng.next(); // (0, 1]
  const u2 = rng.next();
  return Math.sqrt(-2 * log(u1)) * cos(TAU * u2);
}

/** Standard normal kept to |z| <= bound. */
export function truncatedNormal(rng: Rng, bound: number): number {
  for (;;) {
    const z = normal(rng);
    if (Math.abs(z) <= bound) return z;
  }
}

const EXP_MAX = 709;

/** Beta(a, b) on [0, 1]. */
export function beta(rng: Rng, aa: number, bb: number): number {
  if (!(aa > 0 && bb > 0)) throw new Error(`beta: shapes must be positive, got ${aa}, ${bb}`);
  const a = Math.min(aa, bb);
  const b = Math.max(aa, bb);
  const alpha = a + b;
  let v = 0;
  let w = 0;
  const vw = (u1: number, scale: number) => {
    v = betaScale * log(u1 / (1 - u1));
    w = v <= EXP_MAX ? scale * exp(v) : Number.MAX_VALUE;
    if (!(w <= Number.MAX_VALUE)) w = Number.MAX_VALUE;
  };
  let betaScale: number;
  if (a <= 1) {
    // Algorithm BC.
    betaScale = 1 / a;
    const delta = 1 + b - a;
    const k1 = (delta * (0.0138889 + 0.0416667 * a)) / (b * betaScale - 0.777778);
    const k2 = 0.25 + (0.5 + 0.25 / delta) * a;
    for (;;) {
      const u1 = uniformOpen(rng);
      const u2 = rng.next();
      let z: number;
      if (u1 < 0.5) {
        const y = u1 * u2;
        z = u1 * y;
        if (0.25 * u2 + z - y >= k1) continue;
      } else {
        z = u1 * u1 * u2;
        if (z <= 0.25) {
          vw(u1, b);
          break;
        }
        if (z >= k2) continue;
      }
      vw(u1, b);
      if (alpha * (log(alpha / (a + w)) + v) - 1.3862944 >= log(z)) break;
    }
    return aa === a ? a / (a + w) : w / (a + w);
  }
  // Algorithm BB.
  betaScale = Math.sqrt((alpha - 2) / (2 * a * b - alpha));
  const gamma = a + 1 / betaScale;
  for (;;) {
    const u1 = uniformOpen(rng);
    const u2 = rng.next();
    vw(u1, a);
    const z = u1 * u1 * u2;
    const r = gamma * v - 1.3862944;
    const s = a + r - w;
    if (s + 2.609438 >= 5 * z) break;
    const t = log(z);
    if (s > t) break;
    if (r + alpha * log(alpha / (b + w)) >= t) break;
  }
  return aa !== a ? b / (b + w) : w / (b + w);
}

/** Uniform in (0, 1): never exactly 0 or 1, so logit(u) is finite. */
function uniformOpen(rng: Rng): number {
  for (;;) {
    const u = rng.next();
    if (u > 0) return u;
  }
}

/** A point on the simplex, uniformly: Dirichlet with every concentration 1. */
export function dirichletUniform(rng: Rng, n: number): number[] {
  const e: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = -log(1 - rng.next());
    e.push(v);
    sum += v;
  }
  if (!(sum > 0)) return e.map(() => 1 / n);
  return e.map((v) => v / sum);
}

/** Linear interpolation of `values` over ascending `anchors`, constant outside them. */
export function interpolate(x: number, anchors: ArrayLike<number>, values: ArrayLike<number>): number {
  const n = anchors.length;
  if (x <= anchors[0]!) return values[0]!;
  if (x >= anchors[n - 1]!) return values[n - 1]!;
  let i = 1;
  while (i < n - 1 && anchors[i]! < x) i++;
  const t = (x - anchors[i - 1]!) / (anchors[i]! - anchors[i - 1]!);
  return values[i - 1]! + (values[i]! - values[i - 1]!) * t;
}
