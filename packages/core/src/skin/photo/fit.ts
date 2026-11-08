/**
 * Optional "Fit face shape to photo" (PRD F7 step 6): a small optimiser moves
 * the face sliders so the head's landmarks line up with the photo's.
 *
 * It is a damped Gauss-Newton (Levenberg-Marquardt) fit in the front view.
 * Before each comparison the head is aligned to the photo by the best scale,
 * rotation and shift, so only the face's proportions are fitted, not the
 * framing of the picture. A weak pull towards the starting values keeps
 * sliders the photo says little about from drifting.
 */
import type { CoreAssets } from '../../assets';
import type { MacroValues } from '../../morph/macros';
import { Morpher } from '../../morph/morpher';
import { landmarkPoint, LANDMARK_COUNT, type LandmarkTable } from './project';

/** Sliders that change the proportions a front photo can actually show. */
export const FACE_FIT_SLIDERS: readonly string[] = [
  'head/head-scale-horiz-decr|incr',
  'head/head-scale-vert-decr|incr',
  'head/head-square',
  'forehead/forehead-scale-vert-decr|incr',
  'eyebrows/eyebrows-trans-down|up',
  'eyes/l-eye-trans-in|out',
  'eyes/l-eye-trans-down|up',
  'eyes/l-eye-scale-decr|incr',
  'nose/nose-scale-horiz-decr|incr',
  'nose/nose-scale-vert-decr|incr',
  'nose/nose-trans-down|up',
  'mouth/mouth-scale-horiz-decr|incr',
  'chin/chin-width-decr|incr',
  'chin/chin-height-decr|incr',
  'cheek/l-cheek-volume-decr|incr',
];

export interface FaceFitInput {
  assets: CoreAssets;
  macros: Readonly<MacroValues>;
  modifiers: Readonly<Record<string, number>>;
  table: LandmarkTable;
  /** MediaPipe landmarks: x, y (0..1 of the photo), z. */
  landmarks: ArrayLike<number>;
  width: number;
  height: number;
  iterations?: number;
}

export interface FaceFitResult {
  /** New value per fitted slider, including mirrored right-side sliders. */
  modifiers: Record<string, number>;
  /** RMS landmark error as a fraction of the face's size in the photo. */
  errorBefore: number;
  errorAfter: number;
  iterations: number;
}

/**
 * MediaPipe's face-oval landmarks. They follow the silhouette, which moves
 * with the head's turn and the lens as well as its shape, so the fit trusts
 * them less than the eyes, nose and mouth.
 */
const FACE_OVAL = new Set([10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]);
const OVAL_WEIGHT = 0.3;

/** One unit of regularisation: moving a slider by 1 costs as much as this RMS error, squared. */
const PULL = 0.01;

export function fitFaceToPhoto(input: FaceFitInput): FaceFitResult {
  const { assets, table, landmarks, width, height } = input;
  const sliders = FACE_FIT_SLIDERS.map((id) => assets.sliders.byId.get(id)).filter((s) => s !== undefined);
  if (sliders.length === 0) throw new Error('no face sliders to fit');

  // Landmarks present on both sides. y is flipped so both frames have the same handedness.
  const used: number[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) if (i * 3 + 1 < landmarks.length && landmarkPoint(table, i, assets.base.positions)) used.push(i);
  if (used.length < 3) throw new Error('the photo has no usable landmarks');
  const weights = used.map((i) => (FACE_OVAL.has(i) ? OVAL_WEIGHT : 1));
  const target = new Float64Array(used.length * 2);
  used.forEach((i, k) => {
    target[k * 2] = landmarks[i * 3]! * width;
    target[k * 2 + 1] = (1 - landmarks[i * 3 + 1]!) * height;
  });
  const faceSize = spread(target);
  if (!(faceSize > 0)) throw new Error('the photo landmarks are degenerate');

  const start = sliders.map((s) => input.modifiers[s.id] ?? assets.modifiers.get(s.id).defaultValue);
  // Never pull a slider back into the safe range: only keep the fit from leaving it.
  const lo = sliders.map((s, i) => Math.min(s.safeMin, start[i]!));
  const hi = sliders.map((s, i) => Math.max(s.safeMax, start[i]!));

  const morpher = new Morpher(assets.base, assets.targets);
  const withValues = (x: readonly number[]): Record<string, number> => {
    const out: Record<string, number> = {};
    sliders.forEach((s, i) => {
      out[s.id] = x[i]!;
      const mirror = assets.modifiers.get(s.id).symmetricOpposite;
      if (mirror && assets.modifiers.byName.has(mirror)) out[mirror] = x[i]!;
    });
    return out;
  };
  const residual = (x: readonly number[]): Float64Array => {
    morpher.setWeights(assets.modifiers.computeWeights(input.macros as MacroValues, { ...input.modifiers, ...withValues(x) }));
    const p = new Float64Array(used.length * 2);
    used.forEach((i, k) => {
      const v = landmarkPoint(table, i, morpher.positions)!;
      p[k * 2] = v[0];
      p[k * 2 + 1] = v[1];
    });
    return alignedResidual(p, target, faceSize);
  };
  // Fit on weighted residuals; report the plain error, which is what a person would measure.
  const weigh = (e: Float64Array) => e.map((v, j) => v * weights[j >> 1]!);
  const cost = (r: Float64Array, x: readonly number[]) => {
    const w = weigh(r);
    let c = dot(w, w) / used.length;
    for (let i = 0; i < x.length; i++) c += PULL * PULL * (x[i]! - start[i]!) ** 2;
    return c;
  };

  let x = [...start];
  let r = residual(x);
  const errorBefore = Math.sqrt(dot(r, r) / used.length);
  let best = cost(r, x);
  let lambda = 1e-3;
  let iterations = 0;
  const n = x.length;
  for (; iterations < (input.iterations ?? 10); iterations++) {
    const J: Float64Array[] = [];
    for (let k = 0; k < n; k++) {
      // Step towards the inside of the range so the probe stays legal.
      const h = x[k]! + 0.05 <= hi[k]! ? 0.05 : -0.05;
      const probe = [...x];
      probe[k]! += h;
      const rp = residual(probe);
      J.push(weigh(rp.map((v, j) => (v - r[j]!) / h)));
    }
    const A = J.map((a) => J.map((b) => dot(a, b) / used.length));
    const wr = weigh(r);
    const g = J.map((a, k) => dot(a, wr) / used.length + PULL * PULL * (x[k]! - start[k]!));
    let improved = false;
    for (let attempt = 0; attempt < 6 && !improved; attempt++) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + PULL * PULL + 1e-9 : v)));
      const delta = solve(M, g.map((v) => -v));
      const next = x.map((v, i) => Math.min(hi[i]!, Math.max(lo[i]!, v + delta[i]!)));
      const rn = residual(next);
      const c = cost(rn, next);
      if (c < best) {
        const gain = (best - c) / best;
        x = next;
        r = rn;
        best = c;
        lambda = Math.max(lambda * 0.5, 1e-6);
        improved = true;
        if (gain < 1e-4) return finish();
      } else {
        lambda *= 4;
      }
    }
    if (!improved) break;
  }
  return finish();

  function finish(): FaceFitResult {
    return { modifiers: withValues(x), errorBefore, errorAfter: Math.sqrt(dot(r, r) / used.length), iterations };
  }
}

/** Root-mean-square distance of the points from their centroid. */
function spread(p: Float64Array): number {
  const n = p.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += p[i * 2]!;
    cy += p[i * 2 + 1]!;
  }
  cx /= n;
  cy /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (p[i * 2]! - cx) ** 2 + (p[i * 2 + 1]! - cy) ** 2;
  return Math.sqrt(s / n);
}

/** Residual (aligned p minus q) / size, after the best similarity transform of p onto q (Umeyama). */
export function alignedResidual(p: Float64Array, q: Float64Array, size: number): Float64Array {
  const n = p.length / 2;
  let [pcx, pcy, qcx, qcy] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    pcx += p[i * 2]!;
    pcy += p[i * 2 + 1]!;
    qcx += q[i * 2]!;
    qcy += q[i * 2 + 1]!;
  }
  pcx /= n;
  pcy /= n;
  qcx /= n;
  qcy /= n;
  let [a, b, norm] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const px = p[i * 2]! - pcx;
    const py = p[i * 2 + 1]! - pcy;
    const qx = q[i * 2]! - qcx;
    const qy = q[i * 2 + 1]! - qcy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    norm += px * px + py * py;
  }
  const c = norm > 0 ? a / norm : 1; // scale * cos
  const s = norm > 0 ? b / norm : 0; // scale * sin
  const out = new Float64Array(p.length);
  for (let i = 0; i < n; i++) {
    const px = p[i * 2]! - pcx;
    const py = p[i * 2 + 1]! - pcy;
    out[i * 2] = (c * px - s * py + qcx - q[i * 2]!) / size;
    out[i * 2 + 1] = (s * px + c * py + qcy - q[i * 2 + 1]!) / size;
  }
  return out;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Solve a small dense system by Gaussian elimination with partial pivoting. */
function solve(M: number[][], b: number[]): number[] {
  const n = b.length;
  const A = M.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const pivot = A[c]![c]!;
    if (Math.abs(pivot) < 1e-14) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / pivot;
      for (let k = c; k <= n; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let c = n - 1; c >= 0; c--) {
    let s = A[c]![n]!;
    for (let k = c + 1; k < n; k++) s -= A[c]![k]! * x[k]!;
    x[c] = Math.abs(A[c]![c]!) < 1e-14 ? 0 : s / A[c]![c]!;
  }
  return x;
}
