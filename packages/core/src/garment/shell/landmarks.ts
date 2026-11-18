/**
 * The body measures shell templates are written against, read once from the
 * reference body: heights of the waist, hips, crotch, knees and ankles, the
 * neck ring, limb axes, and the torso's front/back centre by height.
 */
import { atan2, cos, PI, sin } from '../../math/dmath';
import { alongBone, boneOf, pairOf, pointOf, ringOf, SEG, type Bone, type ShellBody } from './body';
import { add, cross, lerp, normalize, reject, scale, sub, type Vec3 } from './vec';

export type Side = 'l' | 'r';
export const SIDES: Side[] = ['l', 'r'];

export interface ArmChain {
  upper: Bone;
  lower: Bone;
  hand: Bone;
  /** Lengths of the upper arm and forearm (metres). */
  lu: number;
  ll: number;
  /** Distance along the arm from the shoulder joint (metres), by body part. */
  s(p: Vec3, seg: number): number;
  /** Point on the arm's axis at distance s. */
  at(s: number): Vec3;
  /** Unit direction of the arm at distance s. */
  dir(s: number): Vec3;
}

export interface Landmarks {
  body: ShellBody;
  ground: number;
  crotchY: number;
  waistY: number;
  hipsY: number;
  bustY: number;
  neck: { centre: Vec3; yAt(angle: number): number; base(angle: number): number };
  arm: Record<Side, ArmChain>;
  thigh: Record<Side, Bone>;
  calf: Record<Side, Bone>;
  foot: Record<Side, Bone>;
  knee: Record<Side, { centre: Vec3; y: number }>;
  ankle: Record<Side, { centre: Vec3; y: number }>;
  shoulderTip: Record<Side, Vec3>;
  armpit: Record<Side, Vec3>;
  bustPoint: Record<Side, Vec3>;
  /** Front/back centre (z) of the torso at a height. */
  zc(y: number): number;
  /** Leg axis (x, z) at a height (between hip joint, knee and ankle). */
  legAxis(side: Side, y: number): Vec3;
  head: { brow: Vec3; occiput: Vec3; crown: Vec3; nose: Vec3; nape: Vec3 };
}

const cache = new WeakMap<ShellBody, Landmarks>();

/** Horizontal angle of a direction around the vertical axis: 0 = front (+Z), positive towards +X. */
export function angleOf(dx: number, dz: number): number {
  return atan2(dx, dz);
}

export function landmarks(body: ShellBody): Landmarks {
  let l = cache.get(body);
  if (!l) {
    l = build(body);
    cache.set(body, l);
  }
  return l;
}

function armChain(body: ShellBody, side: Side): ArmChain {
  const upper = boneOf(body, `upperarm_${side}`);
  const lower = boneOf(body, `lowerarm_${side}`);
  const hand = boneOf(body, `hand_${side}`);
  const len = (b: Bone) => Math.sqrt((b.tail[0] - b.head[0]) * (b.tail[0] - b.head[0]) + (b.tail[1] - b.head[1]) * (b.tail[1] - b.head[1]) + (b.tail[2] - b.head[2]) * (b.tail[2] - b.head[2]));
  const lu = len(upper);
  const ll = len(lower);
  const handDir = normalize(sub(hand.tail, hand.head));
  const segU = SEG[`upperarm_${side}`];
  const segL = SEG[`lowerarm_${side}`];
  return {
    upper,
    lower,
    hand,
    lu,
    ll,
    s(p, seg) {
      if (seg === segU) return lu * alongBone(upper, p);
      if (seg === segL) return lu + ll * alongBone(lower, p);
      // Hands: along the hand's own direction from the wrist.
      return lu + ll + Math.max(0, (p[0] - hand.head[0]) * handDir[0] + (p[1] - hand.head[1]) * handDir[1] + (p[2] - hand.head[2]) * handDir[2]);
    },
    at(s) {
      if (s <= lu) return lerp(upper.head, upper.tail, s / lu);
      return lerp(lower.head, lower.tail, Math.min(1.2, (s - lu) / ll));
    },
    dir(s) {
      return s <= lu ? normalize(sub(upper.tail, upper.head)) : normalize(sub(lower.tail, lower.head));
    },
  };
}

function build(body: ShellBody): Landmarks {
  const P = body.positions;
  const n = P.length / 3;
  // Torso centre z by 1 cm bins: the middle of the front and back, from where the
  // torso's triangles cross each bin's middle (the tier has few vertices per centimetre).
  const BIN = 0.01;
  const lo = new Map<number, number>();
  const hi = new Map<number, number>();
  const torsoSegs = new Set([SEG.torso, SEG.pelvis, SEG.neck]);
  const T = body.tris;
  let yLo = Infinity;
  let yHi = -Infinity;
  for (let v = 0; v < n; v++) {
    if (!torsoSegs.has(body.segment[v]!)) continue;
    yLo = Math.min(yLo, P[v * 3 + 1]!);
    yHi = Math.max(yHi, P[v * 3 + 1]!);
  }
  for (let b = Math.floor(yLo / BIN); b <= Math.floor(yHi / BIN); b++) {
    const y = (b + 0.5) * BIN;
    for (let t = 0; t < T.length; t += 3) {
      const tri = [T[t]!, T[t + 1]!, T[t + 2]!];
      if (!tri.every((x) => torsoSegs.has(body.segment[x]!))) continue;
      for (let k = 0; k < 3; k++) {
        const a = tri[k]!;
        const c = tri[(k + 1) % 3]!;
        const ya = P[a * 3 + 1]! - y;
        const yc = P[c * 3 + 1]! - y;
        if ((ya < 0) === (yc < 0)) continue;
        const z = P[a * 3 + 2]! + (P[c * 3 + 2]! - P[a * 3 + 2]!) * (ya / (ya - yc));
        lo.set(b, Math.min(lo.get(b) ?? Infinity, z));
        hi.set(b, Math.max(hi.get(b) ?? -Infinity, z));
      }
    }
  }
  const bins = [...lo.keys()].sort((a, b) => a - b);
  const zc = (y: number): number => {
    const b = Math.floor(y / BIN);
    let best = bins[0]!;
    for (const c of bins) if (Math.abs(c - b) < Math.abs(best - b)) best = c;
    return (lo.get(best)! + hi.get(best)!) / 2;
  };
  const neckRing = ringOf(body, 'neck');
  const ang = neckRing.points.map((p) => ({ a: angleOf(p[0] - neckRing.centre[0], p[2] - neckRing.centre[2]), y: p[1] })).sort((a, b) => a.a - b.a);
  const neckY = (a: number): number => {
    // Piecewise linear around the circle.
    const k = ang.length;
    for (let i = 0; i < k; i++) {
      const p = ang[i]!;
      const q = ang[(i + 1) % k]!;
      const qa = i + 1 < k ? q.a : q.a + 2 * PI;
      let x = a;
      if (i + 1 >= k && x < p.a) x += 2 * PI;
      if (x >= p.a && x <= qa) return p.y + ((q.y - p.y) * (x - p.a)) / Math.max(1e-9, qa - p.a);
    }
    // Before the first point: between the last and the first.
    const p = ang[k - 1]!;
    const q = ang[0]!;
    const x = a + 2 * PI;
    return p.y + ((q.y - p.y) * (x - p.a)) / Math.max(1e-9, q.a + 2 * PI - p.a);
  };
  const side = <T>(f: (s: Side) => T): Record<Side, T> => ({ l: f('l'), r: f('r') });
  const thigh = side((s) => boneOf(body, `thigh_${s}`));
  const calf = side((s) => boneOf(body, `calf_${s}`));
  const foot = side((s) => boneOf(body, `foot_${s}`));
  const knee = side((s) => ringOf(body, 'knee', s));
  const ankle = side((s) => ringOf(body, 'ankle', s));
  const legAxis = (s: Side, y: number): Vec3 => {
    const hip = thigh[s].head;
    const k = knee[s].centre;
    const a = ankle[s].centre;
    if (y >= k[1]) return lerp(k, hip, Math.min(1, (y - k[1]) / Math.max(1e-6, hip[1] - k[1])));
    return lerp(a, k, Math.max(-0.5, (y - a[1]) / Math.max(1e-6, k[1] - a[1])));
  };
  return {
    body,
    ground: body.ground,
    crotchY: pointOf(body, 'crotch')[1],
    waistY: ringOf(body, 'waist').y,
    hipsY: ringOf(body, 'hips').y,
    bustY: ringOf(body, 'bust').y,
    neck: {
      centre: neckRing.centre,
      yAt: neckY,
      // The neck base: the nape at the back, the side neck points, and in front the
      // notch above the breastbone (the neck ring's front, 2.5 cm lower).
      base: (a: number) => {
        const front = neckY(0) - 0.03;
        const back = pointOf(body, 'nape')[1];
        // At the sides the neck meets the shoulders higher than at the front or the back.
        const side = Math.max(front, back) + 0.012;
        const c = cos(a);
        const s2 = 1 - c * c;
        return c >= 0 ? front * c * c + side * s2 : back * c * c + side * s2;
      },
    },
    arm: side((s) => armChain(body, s)),
    thigh,
    calf,
    foot,
    knee: side((s) => ({ centre: knee[s].centre, y: knee[s].y })),
    ankle: side((s) => ({ centre: ankle[s].centre, y: ankle[s].y })),
    shoulderTip: side((s) => pairOf(body, 'shoulderTip', s)),
    armpit: side((s) => pairOf(body, 'armpit', s)),
    bustPoint: side((s) => pairOf(body, 'bustPoint', s)),
    zc,
    legAxis,
    head: { brow: pointOf(body, 'brow'), occiput: pointOf(body, 'occiput'), crown: pointOf(body, 'crown'), nose: pointOf(body, 'noseTip'), nape: pointOf(body, 'nape') },
  };
}

/** A unit vector perpendicular to `d`, as close to `hint` as possible. */
export function perpendicular(d: Vec3, hint: Vec3): Vec3 {
  const r = reject(hint, normalize(d));
  const l = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
  if (l > 1e-9) return scale(r, 1 / l);
  return normalize(cross(d, [1, 0, 0]));
}

/** cos and sin through dmath (generators may not use Math's). */
export const dcos = cos;
export const dsin = sin;
export { add };
