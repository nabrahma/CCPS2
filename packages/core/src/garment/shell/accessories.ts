/**
 * Accessories as sweeps (PRD Part 3, F28): a flat profile swept along a path
 * on the body. Paths are sections of the body by a plane (a belt around the
 * waist, a band around the wrist or thigh, a strap diagonally around the
 * torso from a shoulder to the opposite hip, as a strap lies), made convex so
 * they bridge hollows, offset to sit over the clothes and evenly resampled.
 * Boxes (buckle, holster, satchel) sit on the paths.
 */
import { hypot } from '../../math/dmath';
import { SEG, type ShellBody } from './body';
import { landmarks, type Side } from './landmarks';
import { FIXED, PART, WorkMesh } from './mesh';
import { bodyDistance, hull2d } from './shape';

/** Accessories keep this far from the skin. */
const CLEAR = 0.003;
import { add, cross, dot, lerp, normalize, scale, sub, type Vec3 } from './vec';

/** Body sections by a plane through `point` with normal `normal`, limited to some body parts: the outline, convex, as a closed loop. */
export function sectionLoop(
  body: ShellBody,
  point: Vec3,
  normal: Vec3,
  segments: readonly number[],
  count: number,
  keep?: (p: Vec3, seg: number) => boolean,
): { points: Vec3[]; centre: Vec3; u: Vec3; v: Vec3 } | null {
  const n = normalize(normal);
  // Plane basis: u, v in the plane.
  const u = normalize(Math.abs(n[1]) < 0.9 ? cross([0, 1, 0], n) : cross([1, 0, 0], n));
  const v = cross(n, u);
  const P = body.positions;
  const T = body.tris;
  const d = new Float64Array(P.length / 3);
  for (let i = 0; i < d.length; i++) d[i] = (P[i * 3]! - point[0]) * n[0] + (P[i * 3 + 1]! - point[1]) * n[1] + (P[i * 3 + 2]! - point[2]) * n[2];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let t = 0; t < T.length; t += 3) {
    const tri = [T[t]!, T[t + 1]!, T[t + 2]!];
    if (!tri.every((x) => segments.includes(body.segment[x]!))) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!;
      const b = tri[(k + 1) % 3]!;
      if ((d[a]! < 0) === (d[b]! < 0)) continue;
      const f = d[a]! / (d[a]! - d[b]!);
      const q: Vec3 = [P[a * 3]! + (P[b * 3]! - P[a * 3]!) * f, P[a * 3 + 1]! + (P[b * 3 + 1]! - P[a * 3 + 1]!) * f, P[a * 3 + 2]! + (P[b * 3 + 2]! - P[a * 3 + 2]!) * f];
      if (keep && !keep(q, body.segment[a]!)) continue;
      const r = sub(q, point);
      xs.push(dot(r, u));
      ys.push(dot(r, v));
    }
  }
  if (xs.length < 3) return null;
  const h = hull2d(xs, ys);
  const hx = h.map((i) => xs[i]!);
  const hy = h.map((i) => ys[i]!);
  // Resample the hull evenly.
  const K = hx.length;
  const seg = hx.map((_, i) => hypot(hx[(i + 1) % K]! - hx[i]!, hy[(i + 1) % K]! - hy[i]!));
  const total = seg.reduce((x, y) => x + y, 0);
  const pts: Vec3[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (i < K - 1 && acc + seg[i]! < target) {
      acc += seg[i]!;
      i++;
    }
    const f = seg[i]! > 0 ? (target - acc) / seg[i]! : 0;
    const x = hx[i]! + (hx[(i + 1) % K]! - hx[i]!) * f;
    const y = hy[i]! + (hy[(i + 1) % K]! - hy[i]!) * f;
    pts.push(add(point, add(scale(u, x), scale(v, y))));
  }
  let c: Vec3 = [0, 0, 0];
  for (const p of pts) c = add(c, p);
  c = scale(c, 1 / pts.length);
  return { points: pts, centre: c, u, v };
}

/**
 * Sweep a flat band (width along the plane normal, thickness outwards) along a
 * closed loop lying in a plane. `offset` lifts it off the body (over clothes).
 */
export function sweepBand(m: WorkMesh, loop: Vec3[], centre: Vec3, axis: Vec3, width: number, thickness: number, offset: number, panel: string, seg = -1, body?: ShellBody): number[] {
  // Each side of the band, in two halves along the loop, is its own piece of cloth (a disc for the UVs).
  const sides = ['out', 'bottom', 'in', 'top'];
  const pids = [0, 1].map((h) => sides.map((s) => m.panelId(`${panel}_${s}${h}`)));
  const K = loop.length;
  const a = normalize(axis);
  const ring: number[][] = [];
  for (let k = 0; k < K; k++) {
    const p = loop[k]!;
    const out = normalize(sub(sub(p, centre), scale(a, dot(sub(p, centre), a))));
    const base = add(p, scale(out, offset));
    const top = scale(a, width / 2);
    let corners: Vec3[] = [add(add(base, top), scale(out, thickness)), add(sub(base, top), scale(out, thickness)), sub(base, top), add(base, top)];
    if (body) {
      // Where the body bulges out of the band's plane (a hip under a strap), lift the whole cross-section clear.
      let worst = 0;
      let dir: Vec3 = out;
      for (const q of corners) {
        const r = bodyDistance(body, q, 0.1);
        if (r && CLEAR - r.d > worst) {
          worst = CLEAR - r.d;
          dir = r.n;
        }
      }
      if (worst > 0) corners = corners.map((q) => add(q, scale(dir, worst)));
    }
    const nrm: Vec3[] = [out, out, scale(out, -1), scale(out, -1)];
    ring.push(corners.map((q, i) => m.addVertex(q, nrm[i]!, seg, PART | FIXED)));
  }
  // Which way the loop runs around the axis decides the winding.
  const turn = dot(cross(sub(loop[1]!, loop[0]!), sub(loop[0]!, centre)), a);
  for (let k = 0; k < K; k++) {
    const A = ring[k]!;
    const B = ring[(k + 1) % K]!;
    const half = k < K / 2 ? 0 : 1;
    for (let s = 0; s < 4; s++) {
      const s2 = (s + 1) % 4;
      const pid = pids[half]![s]!;
      if (turn > 0) {
        m.addTri(A[s]!, B[s]!, B[s2]!, pid);
        m.addTri(A[s]!, B[s2]!, A[s2]!, pid);
      } else {
        m.addTri(A[s]!, A[s2]!, B[s2]!, pid);
        m.addTri(A[s]!, B[s2]!, B[s]!, pid);
      }
    }
  }
  return ring.map((r) => r[0]!);
}

/** A box (outward-facing quads as triangles) with centre, axes and half sizes. */
export function addBox(m: WorkMesh, c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, hx: number, hy: number, hz: number, panel: string): void {
  const X = scale(normalize(ax), hx);
  const Y = scale(normalize(ay), hy);
  const Z = scale(normalize(az), hz);
  const corner = (i: number, j: number, k: number) => add(add(add(c, scale(X, i)), scale(Y, j)), scale(Z, k));
  // Eight shared corners (a closed box), each face its own piece for the UVs.
  const ids = new Map<string, number>();
  const at = (q: Vec3): number => {
    const key = q.map((x) => x.toFixed(7)).join(',');
    let i = ids.get(key);
    if (i === undefined) {
      i = m.addVertex(q, normalize(sub(q, c)), -1, PART | FIXED);
      ids.set(key, i);
    }
    return i;
  };
  let face = 0;
  const faces: [Vec3, Vec3, Vec3, Vec3, Vec3][] = [
    [corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1), normalize(X)],
    [corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1), corner(-1, -1, -1), scale(normalize(X), -1)],
    [corner(-1, 1, -1), corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), normalize(Y)],
    [corner(-1, -1, 1), corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), scale(normalize(Y), -1)],
    [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1), normalize(Z)],
    [corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), scale(normalize(Z), -1)],
  ];
  for (const [a, b, cc, d, n] of faces) {
    const pid = m.panelId(`${panel}_${face++}`);
    const q = [a, b, cc, d].map(at);
    // Wind so the face points along its normal.
    const f = cross(sub(b, a), sub(cc, a));
    if (dot(f, n) >= 0) {
      m.addTri(q[0]!, q[1]!, q[2]!, pid);
      m.addTri(q[0]!, q[2]!, q[3]!, pid);
    } else {
      m.addTri(q[0]!, q[2]!, q[1]!, pid);
      m.addTri(q[0]!, q[3]!, q[2]!, pid);
    }
  }
}

export interface BeltOptions {
  /** Height above the hips ring (metres). */
  height: number;
  width: number;
  thickness: number;
  /** Over the clothes below it. */
  offset: number;
  buckle: boolean;
}

export function buildBelt(body: ShellBody, o: BeltOptions): WorkMesh {
  const L = landmarks(body);
  const m = new WorkMesh();
  const y = L.hipsY + o.height;
  const centre: Vec3 = [0, y, L.zc(y)];
  const sec = sectionLoop(body, centre, [0, 1, 0], [SEG.torso, SEG.pelvis], 36);
  if (!sec) return m;
  sweepBand(m, sec.points, sec.centre, [0, 1, 0], o.width, o.thickness, o.offset, 'belt', -1, body);
  if (o.buckle) {
    // The front-most point of the belt.
    let best = sec.points[0]!;
    for (const p of sec.points) if (p[2] > best[2]) best = p;
    const c = add(best, [0, 0, o.offset + o.thickness + 0.004]);
    addBox(m, c, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.028, o.width / 2 + 0.006, 0.004, 'buckle');
  }
  return m;
}

export interface BandOptions {
  sides: Side[];
  /** Along the limb (0 = upper joint, 1 = lower joint). */
  at: number;
  width: number;
  thickness: number;
  offset: number;
  holster?: boolean;
}

/** Bands around a limb: wrists (limb 'arm') or thighs ('thigh'). */
export function buildLimbBands(body: ShellBody, limb: 'arm' | 'thigh', o: BandOptions): WorkMesh {
  const L = landmarks(body);
  const m = new WorkMesh();
  for (const s of o.sides) {
    const bone = limb === 'arm' ? L.arm[s].lower : L.thigh[s];
    const axis = normalize(sub(bone.tail, bone.head));
    const c = lerp(bone.head, bone.tail, o.at);
    const segs = limb === 'arm' ? [SEG[`lowerarm_${s}`], SEG[`hand_${s}`]] : [SEG[`thigh_${s}`]];
    const sec = sectionLoop(body, c, axis, segs, 24);
    if (!sec) continue;
    sweepBand(m, sec.points, sec.centre, axis, o.width, o.thickness, o.offset, `band_${s}`, -1, body);
    if (o.holster && limb === 'thigh') {
      const sideDir: Vec3 = normalize([s === 'l' ? 1 : -1, 0, 0]);
      let best = sec.points[0]!;
      for (const p of sec.points) if (dot(sub(p, sec.centre), sideDir) > dot(sub(best, sec.centre), sideDir)) best = p;
      const hc = add(add(best, scale(sideDir, o.offset + o.thickness + 0.017)), [0, -0.045, 0.01]);
      addBox(m, hc, sideDir, [0, 1, 0], cross(sideDir, [0, 1, 0]), 0.016, 0.085, 0.04, `holster_${s}`);
    }
  }
  return m;
}

export interface StrapOptions {
  /** Shoulder the strap goes over. */
  shoulder: Side;
  width: number;
  thickness: number;
  offset: number;
  /** A satchel at the opposite hip. */
  bag?: { width: number; height: number; depth: number };
}

/**
 * A strap diagonally around the torso: the section of the torso by the plane
 * through the shoulder top, the opposite hip and the torso's centre (where a
 * strap settles), made convex and lifted over the clothes.
 */
export function buildStrap(body: ShellBody, o: StrapOptions): WorkMesh {
  const L = landmarks(body);
  const m = new WorkMesh();
  const s = o.shoulder;
  const other: Side = s === 'l' ? 'r' : 'l';
  const shoulder = lerp(L.shoulderTip[s], [0, L.neck.base(Math.PI / 2), L.neck.centre[2]], 0.45);
  const hipY = (L.hipsY + L.waistY) / 2;
  const hip: Vec3 = [L.thigh[other].head[0] * 1.4, hipY, L.zc(hipY)];
  // The plane holding the shoulder and the hip, through the torso's middle (normal across the strap).
  const along = normalize(sub(shoulder, hip));
  const normal = normalize(cross(along, [0, 0, 1]));
  // The shoulder's deltoid is part of the upper arm: the strap goes over it, so it counts above the armpit.
  const arm = SEG[`upperarm_${s}`];
  const armpitY = L.armpit[s][1];
  const sec = sectionLoop(body, lerp(shoulder, hip, 0.5), normal, [SEG.torso, SEG.pelvis, SEG.neck, arm], 40, (q, seg) => seg !== arm || q[1] > armpitY);
  if (!sec) return m;
  sweepBand(m, sec.points, sec.centre, normal, o.width, o.thickness, o.offset, 'strap', -1, body);
  if (o.bag) {
    const sideDir: Vec3 = [other === 'l' ? 1 : -1, 0, 0];
    let best = sec.points[0]!;
    for (const p of sec.points) if (dot(p, sideDir) - p[1] * 0.2 > dot(best, sideDir) - best[1] * 0.2) best = p;
    const c = add(add(best, scale(sideDir, o.offset + o.bag.depth / 2 + 0.006)), [0, -o.bag.height / 2 + 0.02, 0.02]);
    addBox(m, c, sideDir, [0, 1, 0], [0, 0, 1], o.bag.depth / 2, o.bag.height / 2, o.bag.width / 2, 'bag');
  }
  return m;
}

