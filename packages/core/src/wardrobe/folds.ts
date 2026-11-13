/**
 * Fold stamps (Part 2 F18): the creases a garment gets where the body bends
 * (elbows, armpits, waist, crotch, knees), painted into the diffuse as light
 * on the ridges and occlusion in the valleys, the way era textures had them.
 *
 * Folds are placed from the reference body's joints and the garment's
 * looseness there (its distance from the skin): tight cloth folds little,
 * loose cloth folds a lot. Each site is a band of rings round the limb's
 * axis, slanted and broken up so they read as cloth, strongest on the side
 * the joint bends towards (the inside of the elbow, the back of the knee).
 */
import { smoothstep, valueNoise } from '../skin/noise';
import type { FoldSettings, FoldSite } from './look';

type Vec3 = [number, number, number];

export interface FoldFrame {
  site: FoldSite;
  /** Where the band is centred. */
  centre: Vec3;
  /** Unit axis of the limb (rings go round it). */
  axis: Vec3;
  /** Unit direction the joint bends towards (folds gather on that side). */
  bend: Vec3;
  /** Half-width of the band along the axis, metres. */
  band: number;
  /** Beyond this distance from the axis the site does nothing (another limb, the torso). */
  reach: number;
  /** Distance between folds, metres. */
  spacing: number;
  /** How much folds gather on the bend side (0 = all round). */
  sided: number;
}

export interface FoldJoints {
  /** Joint heads of the game-engine rig on the reference body. */
  joint: (name: string) => Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The fold sites of a body, from its joints (engine space: +y up, +z front). */
export function foldFrames(j: FoldJoints): FoldFrame[] {
  const out: FoldFrame[] = [];
  for (const s of ['l', 'r'] as const) {
    const shoulder = j.joint(`upperarm_${s}`);
    const elbow = j.joint(`lowerarm_${s}`);
    const wrist = j.joint(`hand_${s}`);
    const hip = j.joint(`thigh_${s}`);
    const knee = j.joint(`calf_${s}`);
    const ankle = j.joint(`foot_${s}`);
    const fore = norm(sub(wrist, elbow));
    const upper = norm(sub(elbow, shoulder));
    out.push({ site: 'elbows', centre: elbow, axis: fore, bend: [0, 0, 1], band: 0.075, reach: 0.11, spacing: 0.024, sided: 0.7 });
    // Under the arm: rings round the upper arm, near the shoulder, gathered underneath.
    out.push({ site: 'armpits', centre: lerp3(shoulder, elbow, 0.22), axis: upper, bend: [0, -1, 0], band: 0.06, reach: 0.12, spacing: 0.026, sided: 0.85 });
    const thigh = norm(sub(knee, hip));
    const shin = norm(sub(ankle, knee));
    out.push({ site: 'knees', centre: knee, axis: shin, bend: [0, 0, -1], band: 0.08, reach: 0.13, spacing: 0.03, sided: 0.55 });
    const inward = norm([-hip[0], 0, 0.35]);
    out.push({ site: 'crotch', centre: lerp3(hip, knee, 0.18), axis: thigh, bend: inward, band: 0.07, reach: 0.15, spacing: 0.028, sided: 0.8 });
  }
  const pelvis = j.joint('pelvis');
  const spine = j.joint('spine_01');
  out.push({ site: 'waist', centre: lerp3(pelvis, spine, 0.75), axis: [0, 1, 0], bend: [0, 0, 1], band: 0.06, reach: 0.3, spacing: 0.032, sided: 0.4 });
  return out;
}

/**
 * Shading multiplier of the folds at a point of the garment (on the reference
 * body), given how far the cloth stands off the skin there (`gap`, metres).
 * 1 = no change.
 */
export function foldShade(p: ArrayLike<number>, gap: number, frames: readonly FoldFrame[], settings: FoldSettings): number {
  if (settings.strength <= 0) return 1;
  const bunch = 0.35 + 0.65 * smoothstep(0.002, 0.03, gap);
  let shade = 1;
  for (const f of frames) {
    const w = settings.sites[f.site] ?? 0;
    if (w <= 0) continue;
    const d: Vec3 = [p[0]! - f.centre[0], p[1]! - f.centre[1], p[2]! - f.centre[2]];
    const t = d[0] * f.axis[0] + d[1] * f.axis[1] + d[2] * f.axis[2];
    if (Math.abs(t) > f.band * 2.2) continue;
    const r: Vec3 = [d[0] - f.axis[0] * t, d[1] - f.axis[1] * t, d[2] - f.axis[2] * t];
    const rl = Math.hypot(r[0], r[1], r[2]);
    if (rl > f.reach) continue;
    const gate = 1 - smoothstep(f.reach * 0.75, f.reach, rl);
    const fall = Math.exp(-((t / f.band) ** 2));
    // Side: towards the bend direction.
    const side = rl > 1e-6 ? (r[0] * f.bend[0] + r[1] * f.bend[1] + r[2] * f.bend[2]) / rl : 0;
    const sideW = 1 - f.sided + f.sided * smoothstep(-0.4, 0.8, side);
    // Angle round the axis, for slant and break-up.
    const ref = Math.abs(f.axis[1]) > 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
    const u = norm([f.axis[1] * ref[2] - f.axis[2] * ref[1], f.axis[2] * ref[0] - f.axis[0] * ref[2], f.axis[0] * ref[1] - f.axis[1] * ref[0]]);
    const v: Vec3 = [f.axis[1] * u[2] - f.axis[2] * u[1], f.axis[2] * u[0] - f.axis[0] * u[2], f.axis[0] * u[1] - f.axis[1] * u[0]];
    const ang = Math.atan2(r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[0] * u[0] + r[1] * u[1] + r[2] * u[2]);
    const seed = settings.seed * 7.31;
    const warp = 1.6 * Math.sin(ang * 2 + seed) + 2.2 * (valueNoise(p[0]! * 18, p[1]! * 18, p[2]! * 18, settings.seed) - 0.5);
    const phase = (2 * Math.PI * t) / f.spacing + warp + ang * 0.9;
    const wave = Math.sin(phase);
    // Folds come and go round the limb.
    const breakup = smoothstep(0.25, 0.7, valueNoise(ang * 1.7 + 11, t * 25, seed, settings.seed + 3));
    const k = settings.strength * w * fall * gate * sideW * bunch * (0.45 + 0.55 * breakup);
    const valley = smoothstep(0.15, 1, -wave);
    const ridge = smoothstep(0.55, 1, wave);
    shade *= 1 - 0.36 * k * valley + 0.14 * k * ridge;
  }
  return Math.max(0.35, Math.min(1.4, shade));
}
