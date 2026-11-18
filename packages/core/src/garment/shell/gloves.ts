/**
 * Gloves (PRD Part 3, F28) built as rings, the way boots are: the clean mitt
 * of era character art. The mitt is swept across the forearm and then the
 * hand, each ring the convex outline of the body's cross-section there (the
 * fingers as one block) grown by the ease; the thumb is its own closed tube
 * swept along the thumb, overlapping the mitt as separate pieces did on
 * period models. Fingerless gloves stop open at the knuckles. Ring points
 * lie along one set of directions per sweep (no twist between rings) and
 * their chords hold each outline (`ringRadius`), so nothing pokes between
 * them; the sweep holds every vertex between two rings in both rings'
 * outlines, so nothing pokes between rings either.
 */
import { cos, sin, TAU } from '../../math/dmath';
import { boneOf, SEG, type ShellBody } from './body';
import { ringRadii } from './boots';
import { SIDES, type Side } from './landmarks';
import { FIXED, WorkMesh } from './mesh';
import { hull2d } from './shape';
import { add, cross, dot, len, normalize, scale, sub, type Vec3 } from './vec';

export interface GloveOptions {
  /** How far the cuff reaches up the forearm from the wrist (metres). */
  cuff: number;
  ease: number;
  /** Extra ease over the cuff. */
  cuffEase: number;
  fingerless: boolean;
  /** Points around each mitt ring (the thumb's tube has half as many, at least 6). */
  around: number;
  /** Hem indices: the cuff's, and (fingerless) the knuckles' opening. */
  hem: Record<Side, { cuff: number; fingers: number }>;
}

/** A slice: a point on the sweep's axis, its normal, the part its ring belongs to, and its ease. */
interface Plane {
  at: Vec3;
  d: Vec3;
  seg: number;
  ease: number;
}

/**
 * Rings for a sweep through `planes` (normals parallel or turning gently):
 * each the outline of the member vertices (`member`) in its slab, out to half
 * again the neighbouring slices (everything past the last), and of the
 * members' triangle crossings, centres smoothed along the sweep. Returns the
 * rings' vertices and the points they were laid around.
 */
function sweep(m: WorkMesh, body: ShellBody, planes: Plane[], member: (v: number) => boolean, hint: Vec3, around: number, axis: Vec3, origin: Vec3): { rings: number[][]; centres: Vec3[] } {
  const P = body.positions;
  const T = body.tris;
  const offset = (k: number) => dot(sub(planes[k]!.at, origin), axis);
  const outlines: { u: Vec3; w: Vec3; hx: number[]; hy: number[]; cx: number; cy: number; ex: number; ey: number }[] = [];
  let last: { hx: number[]; hy: number[] } | null = null;
  for (let k = 0; k < planes.length; k++) {
    const pl = planes[k]!;
    const here = offset(k);
    const before = k > 0 ? 1.5 * Math.abs(here - offset(k - 1)) : 0;
    const after = k + 1 < planes.length ? 1.5 * Math.abs(offset(k + 1) - here) : Infinity;
    const u = normalize(sub(hint, scale(pl.d, dot(hint, pl.d))));
    const w = cross(pl.d, u);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t < T.length; t += 3) {
      const tv = [T[t]!, T[t + 1]!, T[t + 2]!];
      if (!tv.every(member)) continue;
      for (let i = 0; i < 3; i++) {
        const a = tv[i]!;
        const b = tv[(i + 1) % 3]!;
        const pa: Vec3 = [P[a * 3]!, P[a * 3 + 1]!, P[a * 3 + 2]!];
        const pb: Vec3 = [P[b * 3]!, P[b * 3 + 1]!, P[b * 3 + 2]!];
        const da = dot(sub(pa, pl.at), pl.d);
        const db = dot(sub(pb, pl.at), pl.d);
        if (da * db >= 0) continue;
        const r = sub(add(pa, scale(sub(pb, pa), da / (da - db))), pl.at);
        // This part only, near the axis (a plane is infinite).
        if (len(r) > 0.14) continue;
        xs.push(dot(r, u));
        ys.push(dot(r, w));
      }
    }
    for (let v = 0; v < P.length / 3; v++) {
      if (!member(v)) continue;
      const r = sub([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!], pl.at);
      const along = dot(r, pl.d);
      if (along < -before || along > after || len(r) > 0.16) continue;
      xs.push(dot(r, u));
      ys.push(dot(r, w));
    }
    let hx: number[];
    let hy: number[];
    if (xs.length >= 3) {
      const h = hull2d(xs, ys);
      hx = h.map((i) => xs[i]!);
      hy = h.map((i) => ys[i]!);
      last = { hx, hy };
    } else if (last) {
      ({ hx, hy } = last);
    } else {
      hx = [0.01, -0.01, 0];
      hy = [0, 0, 0.01];
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < hx.length; i++) {
      cx += hx[i]!;
      cy += hy[i]!;
    }
    cx /= hx.length;
    cy /= hx.length;
    let ex = 1e-3;
    let ey = 1e-3;
    for (let i = 0; i < hx.length; i++) {
      ex = Math.max(ex, Math.abs(hx[i]! - cx));
      ey = Math.max(ey, Math.abs(hy[i]! - cy));
    }
    outlines.push({ u, w, hx, hy, cx, cy, ex, ey });
  }
  // One set of directions (an ellipse of the sweep's mean proportions): a point at another angle on the next ring
  // would twist the band between them across a knuckle.
  let sx = 0;
  let sy = 0;
  for (const x of outlines) {
    sx += x.ex;
    sy += x.ey;
  }
  const dirs: [number, number][] = [];
  for (let j = 0; j < around; j++) {
    const f = (TAU * j) / around;
    const dx = sx * cos(f);
    const dy = sy * sin(f);
    const d = Math.sqrt(dx * dx + dy * dy);
    dirs.push([dx / d, dy / d]);
  }
  const rings: number[][] = [];
  const centres: Vec3[] = [];
  for (let k = 0; k < planes.length; k++) {
    const pl = planes[k]!;
    const o = outlines[k]!;
    // The centre smoothed along the sweep, where it stays inside this ring's outline.
    const a = outlines[Math.max(0, k - 1)]!;
    const b = outlines[Math.min(planes.length - 1, k + 1)]!;
    let cx = (a.cx + 2 * o.cx + b.cx) / 4;
    let cy = (a.cy + 2 * o.cy + b.cy) / 4;
    if (!insideConvex(o.hx, o.hy, cx, cy)) ({ cx, cy } = o);
    const ring: number[] = [];
    centres.push(add(pl.at, add(scale(o.u, cx), scale(o.w, cy))));
    // The chords between ring points hold the outline too (a knuckle between two directions).
    const radii = ringRadii(o.hx, o.hy, cx, cy, dirs, pl.ease);
    for (let j = 0; j < around; j++) {
      const [dx, dy] = dirs[j]!;
      const r = radii[j]!;
      const radial = add(scale(o.u, dx), scale(o.w, dy));
      // Clear as made (each ring holds its slab): pushed one by one, the fingertips' would tangle.
      ring.push(m.addVertex(add(pl.at, add(add(scale(o.u, cx), scale(o.w, cy)), scale(radial, r))), radial, pl.seg, FIXED, -1, pl.ease));
    }
    rings.push(ring);
  }
  return { rings, centres };
}

/** Bands between consecutive rings, outward facing (ring points run from u towards w, the sweep along d). */
function bands(m: WorkMesh, rings: number[][], panel: (j: number) => number): void {
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k]!;
    const B = rings[k + 1]!;
    const n = A.length;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      m.addTri(A[j]!, A[j2]!, B[j2]!, panel(j));
      m.addTri(A[j]!, B[j2]!, B[j]!, panel(j));
    }
  }
}

/** A rounded cap over a ring from the point it was laid around, `bulge` along the sweep (negative: the start). */
function cap(m: WorkMesh, ring: number[], centre: Vec3, d: Vec3, bulge: number, seg: number, ease: number, panel: number): void {
  const c = m.addVertex(add(centre, scale(d, bulge)), scale(d, Math.sign(bulge)), seg, FIXED, -1, ease);
  const n = ring.length;
  for (let j = 0; j < n; j++) {
    if (bulge > 0) m.addTri(c, ring[j]!, ring[(j + 1) % n]!, panel);
    else m.addTri(c, ring[(j + 1) % n]!, ring[j]!, panel);
  }
}

/** Rings along the forearm (to the wrist), then along the hand (to the fingertips or the knuckles), and the thumb's. */
const FOREARM_RINGS = 3;
const HAND_RINGS = 4;
const FINGER_RINGS = 4;
const THUMB_RINGS = 4;

export function buildGloves(body: ShellBody, o: GloveOptions): WorkMesh {
  const m = new WorkMesh();
  const P = body.positions;
  for (const s of SIDES) {
    const handSeg = SEG[`hand_${s}`];
    const armSeg = SEG[`lowerarm_${s}`];
    const hand = boneOf(body, `hand_${s}`);
    const fore = boneOf(body, `lowerarm_${s}`);
    const wrist = hand.head;
    const armDir = normalize(sub(fore.tail, fore.head));
    const tip = boneOf(body, `middle_03_${s}`).tail;
    const handDir = normalize(sub(tip, wrist));
    const thumbBones = new Set([body.boneNames.indexOf(`thumb_02_${s}`), body.boneNames.indexOf(`thumb_03_${s}`)]);
    const inThumb = (v: number) => body.segment[v] === handSeg && thumbBones.has(body.bone[v]!);
    const inMitt = (v: number) => (body.segment[v] === handSeg || body.segment[v] === armSeg) && !thumbBones.has(body.bone[v]!);
    // How far the hand reaches along its axis (the fingertips, curled or not), and the knuckles.
    let far = len(sub(tip, wrist));
    for (let v = 0; v < P.length / 3; v++) {
      if (body.segment[v] !== handSeg || thumbBones.has(body.bone[v]!)) continue;
      far = Math.max(far, dot(sub([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!], wrist), handDir));
    }
    const knuckle = dot(sub(boneOf(body, `middle_01_${s}`).head, wrist), handDir);
    const end = o.fingerless ? knuckle + 0.008 : far;
    const planes: Plane[] = [];
    for (let k = 0; k < FOREARM_RINGS; k++) {
      const t = o.cuff * (1 - k / FOREARM_RINGS);
      planes.push({ at: sub(wrist, scale(armDir, t)), d: armDir, seg: armSeg, ease: k === 0 ? o.ease + o.cuffEase : o.ease });
    }
    // From the wrist on, across the hand: rings in planes tilted between the two would not hold the hand between them.
    const handEnd = o.fingerless ? end : knuckle;
    for (let k = 0; k <= HAND_RINGS; k++) planes.push({ at: add(wrist, scale(handDir, (handEnd * k) / HAND_RINGS)), d: handDir, seg: handSeg, ease: o.ease });
    if (!o.fingerless) {
      for (let k = 1; k <= FINGER_RINGS; k++) {
        const t = knuckle + ((end - knuckle) * k) / FINGER_RINGS;
        planes.push({ at: add(wrist, scale(handDir, t)), d: handDir, seg: handSeg, ease: o.ease });
      }
    }
    // One frame for every ring (the palm's normal first), so ring points line up.
    const thumbBase = boneOf(body, `thumb_02_${s}`).head;
    const palm = normalize(cross(handDir, sub(thumbBase, wrist)));
    const mitt = sweep(m, body, planes, inMitt, palm, o.around, handDir, wrist);
    const half = (j: number) => m.panelId(`glove_${s}_${j < o.around / 2 ? 'a' : 'b'}`);
    bands(m, mitt.rings, half);
    for (const v of mitt.rings[0]!) {
      m.hem[v] = o.hem[s].cuff;
      m.dist[v] = 0;
    }
    const lastRing = mitt.rings[mitt.rings.length - 1]!;
    if (o.fingerless) {
      for (const v of lastRing) {
        m.hem[v] = o.hem[s].fingers;
        m.dist[v] = 0;
      }
    } else {
      cap(m, lastRing, mitt.centres[mitt.centres.length - 1]!, handDir, 0.008, handSeg, o.ease, half(0));
    }
    // The thumb: a closed tube from inside the mitt to past its tip.
    const t2 = boneOf(body, `thumb_02_${s}`);
    const t3 = boneOf(body, `thumb_03_${s}`);
    const thumbDir = normalize(sub(t3.tail, t2.head));
    let thumbFar = len(sub(t3.tail, t2.head));
    for (let v = 0; v < P.length / 3; v++) if (inThumb(v)) thumbFar = Math.max(thumbFar, dot(sub([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!], t2.head), thumbDir));
    const thumbStart = -0.012;
    const thumbPlanes: Plane[] = [];
    for (let k = 0; k <= THUMB_RINGS; k++) {
      const t = thumbStart + ((thumbFar - thumbStart) * k) / THUMB_RINGS;
      thumbPlanes.push({ at: add(t2.head, scale(thumbDir, t)), d: thumbDir, seg: handSeg, ease: o.ease });
    }
    const thumbAround = Math.max(6, 2 * Math.round(o.around / 4));
    const thumb = sweep(m, body, thumbPlanes, inThumb, palm, thumbAround, thumbDir, t2.head);
    const thumbPanel = m.panelId(`glove_${s}_thumb`);
    bands(m, thumb.rings, () => thumbPanel);
    cap(m, thumb.rings[0]!, thumb.centres[0]!, thumbDir, -0.004, handSeg, o.ease, thumbPanel);
    cap(m, thumb.rings[thumb.rings.length - 1]!, thumb.centres[thumb.centres.length - 1]!, thumbDir, 0.006, handSeg, o.ease, thumbPanel);
  }
  return m;
}

/**
 * `buildGloves` with as many points around as fit the slot's budget with the
 * rims and without decimating; the count depends on the options only.
 */
export function buildGlovesWithin(body: ShellBody, o: GloveOptions, budget: number, decimateAbove: number): WorkMesh {
  const loops = o.fingerless ? 2 : 1;
  let m = buildGloves(body, o);
  for (let around = o.around; around >= 8; around -= 2) {
    m = around === o.around ? m : buildGloves(body, { ...o, around });
    if (m.triangleCount <= decimateAbove && m.triangleCount + 2 * loops * 4 * around <= budget) break;
  }
  return m;
}

/** Whether a point is inside a convex polygon (either winding). */
function insideConvex(hx: readonly number[], hy: readonly number[], x: number, y: number): boolean {
  let sign = 0;
  const k = hx.length;
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    const c = (hx[j]! - hx[i]!) * (y - hy[i]!) - (hy[j]! - hy[i]!) * (x - hx[i]!);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}
