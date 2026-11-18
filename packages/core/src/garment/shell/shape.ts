/**
 * Shaping a shell (PRD Part 3, F28 steps 3 and 4): ease along the body
 * normal, diffused across body-part borders; offsets limited where other
 * skin is close (armpits, the crotch, between fingers); Taubin smoothing that
 * removes muscle, navel and nipples; a blend of each horizontal slice towards
 * its convex hull so cloth bridges concavities; and the skin clearance pass.
 * Everything runs a fixed number of iterations in a fixed order.
 */
import { closestPointOnTriangle, TriangleBVH } from '../../mesh/bvh';
import { atan2, cos, sin, TAU } from '../../math/dmath';
import type { ShellBody } from './body';
import { FIXED, type WorkMesh } from './mesh';
import { add, dot, normalize, scale, sub, type Vec3 } from './vec';

/** Cloth never comes closer to the skin than this (the M4 collision clearance). */
export const SKIN_CLEARANCE = 0.0015;
/** Jacobi iterations that diffuse ease across body-part borders. */
export const EASE_DIFFUSION = 30;
/** Share of the gap to other skin along the normal an offset may use. */
const GAP_SHARE = 0.45;

/**
 * Diffuse per-vertex ease: `fixed` vertices keep theirs (bands); the others
 * take the mean of themselves and their neighbours, 30 times.
 */
export function diffuseEase(m: WorkMesh, nb: number[][], fixed: Uint8Array, iterations = EASE_DIFFUSION): void {
  let cur = Float64Array.from(m.ease);
  let next = new Float64Array(cur.length);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < cur.length; v++) {
      if (fixed[v]) {
        next[v] = cur[v]!;
        continue;
      }
      let s = cur[v]!;
      for (const u of nb[v]!) s += cur[u]!;
      next[v] = s / (1 + nb[v]!.length);
    }
    const swap = cur;
    cur = next;
    next = swap;
  }
  m.ease = Array.from(cur);
}

/** Move each body vertex out along its normal by ease + half the thickness, limited by nearby skin. */
export function offsetFromBody(m: WorkMesh, body: ShellBody, thickness: number): void {
  for (let v = 0; v < m.vertexCount; v++) {
    if (m.flags[v]! & FIXED) continue;
    const p = m.p(v);
    const n = m.n(v);
    let d = m.ease[v]! + thickness / 2;
    // Other skin along the normal (the inner arm faces the torso, thighs face each other).
    const hit = body.bvh.raycast(add(p, scale(n, 0.002)), n, 0, d / GAP_SHARE + 0.01);
    if (hit) {
      const gap = hit.t + 0.002;
      d = Math.min(d, GAP_SHARE * gap);
    }
    m.setP(v, add(p, scale(n, d)));
  }
}

/**
 * Taubin lambda|mu smoothing, `iterations` pairs. Boundary vertices are
 * smoothed along their loop only, so hems stay clean curves; FIXED vertices
 * do not move; `keepY` vertices keep their height (level hems).
 */
export function taubin(m: WorkMesh, nb: number[][], iterations: number, keepY?: Uint8Array, only?: Uint8Array): void {
  if (iterations <= 0) return;
  const loops = m.boundaryLoops();
  const onLoop = new Map<number, [number, number]>();
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) onLoop.set(loop[i]!, [loop[(i + loop.length - 1) % loop.length]!, loop[(i + 1) % loop.length]!]);
  }
  const n = m.vertexCount;
  const step = (factor: number) => {
    const out = m.pos.slice();
    for (let v = 0; v < n; v++) {
      if (m.flags[v]! & FIXED) continue;
      if (only && !only[v]) continue;
      const ring = onLoop.get(v) ?? nb[v]!;
      if (ring.length === 0) continue;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const u of ring) {
        cx += m.pos[u * 3]!;
        cy += m.pos[u * 3 + 1]!;
        cz += m.pos[u * 3 + 2]!;
      }
      const k = 1 / ring.length;
      out[v * 3] = m.pos[v * 3]! + factor * (cx * k - m.pos[v * 3]!);
      if (!keepY?.[v]) out[v * 3 + 1] = m.pos[v * 3 + 1]! + factor * (cy * k - m.pos[v * 3 + 1]!);
      out[v * 3 + 2] = m.pos[v * 3 + 2]! + factor * (cz * k - m.pos[v * 3 + 2]!);
    }
    m.pos = out;
  };
  for (let i = 0; i < iterations; i++) {
    step(0.5);
    step(-0.53);
  }
}

/** Andrew's monotone chain: convex hull of 2D points, counter-clockwise, as indices. */
export function hull2d(xs: ArrayLike<number>, ys: ArrayLike<number>): number[] {
  const idx = Array.from({ length: xs.length }, (_, i) => i).sort((a, b) => xs[a]! - xs[b]! || ys[a]! - ys[b]! || a - b);
  if (idx.length < 3) return idx;
  const crossO = (o: number, a: number, b: number) => (xs[a]! - xs[o]!) * (ys[b]! - ys[o]!) - (ys[a]! - ys[o]!) * (xs[b]! - xs[o]!);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k]!;
    while (upper.length >= 2 && crossO(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Distance from (cx, cy) along unit direction (dx, dy) to the boundary of a convex polygon. */
function rayToHull(hx: number[], hy: number[], cx: number, cy: number, dx: number, dy: number): number {
  let best = Infinity;
  const k = hx.length;
  for (let i = 0; i < k; i++) {
    const ax = hx[i]!;
    const ay = hy[i]!;
    const bx = hx[(i + 1) % k]!;
    const by = hy[(i + 1) % k]!;
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-15) continue;
    const t = ((ax - cx) * ey - (ay - cy) * ex) / den;
    const s = ((ax - cx) * dy - (ay - cy) * dx) / den;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

export interface HullGroup {
  /** Body parts whose vertices form the slices. */
  segments: readonly number[];
  /** 0 = keep the shape, 1 = the convex hull. */
  drape: number;
  /** Heights the blend applies between (metres, reference body). */
  yMin: number;
  yMax: number;
  /** Neighbouring slices (each side) that share a slice's outline (default 1): more gives rounder shapes (hats over ears). */
  band?: number;
}

/**
 * Blend each horizontal slice of a group towards its 2D convex hull, so cloth
 * bridges concavities (between the chest and under the arms, the small of the
 * back) the way real fabric does. Slices are 1 cm thick; the blend fades out
 * over 2 cm at the group's top and bottom.
 */
export function hullBlend(m: WorkMesh, g: HullGroup): void {
  if (g.drape <= 0) return;
  const SLICE = 0.01;
  const members: number[] = [];
  for (let v = 0; v < m.vertexCount; v++) {
    if (m.flags[v]! & FIXED) continue;
    const y = m.pos[v * 3 + 1]!;
    if (g.segments.includes(m.seg[v]!) && y >= g.yMin && y <= g.yMax) members.push(v);
  }
  const bins = new Map<number, number[]>();
  for (const v of members) {
    const b = Math.floor(m.pos[v * 3 + 1]! / SLICE);
    const list = bins.get(b);
    if (list) list.push(v);
    else bins.set(b, [v]);
  }
  // The group's triangles (at least one corner in the group's parts).
  const tris: number[] = [];
  for (let t = 0; t < m.triangleCount; t++) {
    const a = m.tris[t * 3]!;
    const b = m.tris[t * 3 + 1]!;
    const c = m.tris[t * 3 + 2]!;
    if (g.segments.includes(m.seg[a]!) || g.segments.includes(m.seg[b]!) || g.segments.includes(m.seg[c]!)) tris.push(a, b, c);
  }
  /** The cloth's outline at a height: where its triangles cross it. */
  const outline = (y: number, xs: number[], zs: number[]) => {
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k]!;
        const b = tris[t + ((k + 1) % 3)]!;
        const ya = m.pos[a * 3 + 1]! - y;
        const yb = m.pos[b * 3 + 1]! - y;
        if ((ya < 0) === (yb < 0)) continue;
        const f = ya / (ya - yb);
        xs.push(m.pos[a * 3]! + (m.pos[b * 3]! - m.pos[a * 3]!) * f);
        zs.push(m.pos[a * 3 + 2]! + (m.pos[b * 3 + 2]! - m.pos[a * 3 + 2]!) * f);
      }
    }
  };
  const band = g.band ?? 1;
  const target = new Map<number, [number, number]>();
  for (const [b, own] of [...bins.entries()].sort((x, y) => x[0] - y[0])) {
    // The outline of this slice and its neighbours (more of them: rounder shapes).
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = -band; k <= band; k++) outline((b + k + 0.5) * SLICE, xs, zs);
    for (const v of own) {
      xs.push(m.pos[v * 3]!);
      zs.push(m.pos[v * 3 + 2]!);
    }
    if (xs.length < 6) continue;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < xs.length; i++) {
      cx += xs[i]!;
      cz += zs[i]!;
    }
    cx /= xs.length;
    cz /= xs.length;
    const h = hull2d(xs, zs);
    const hx = h.map((i) => xs[i]!);
    const hz = h.map((i) => zs[i]!);
    for (const v of own) {
      const dx = m.pos[v * 3]! - cx;
      const dz = m.pos[v * 3 + 2]! - cz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r < 1e-6) continue;
      const rh = rayToHull(hx, hz, cx, cz, dx / r, dz / r);
      if (!Number.isFinite(rh) || rh <= r) continue;
      const y = m.pos[v * 3 + 1]!;
      const fade = Math.min(1, (y - g.yMin) / 0.02, (g.yMax - y) / 0.02);
      const k = g.drape * Math.max(0, fade);
      const nr = r + (rh - r) * k;
      target.set(v, [cx + (dx / r) * nr, cz + (dz / r) * nr]);
    }
  }
  for (const [v, [x, z]] of target) {
    m.pos[v * 3] = x;
    m.pos[v * 3 + 2] = z;
  }
}

/**
 * Signed distance of a point to the body and the body's normal there
 * (positive outside): to the full body and to each rendered tier, whichever
 * the point is deepest in or closest to. With `need`, a point clear of the
 * full body by more than `need` and the tiers' slack skips the tiers.
 */
export function bodyDistance(body: ShellBody, p: Vec3, maxDistance = 0.1, need = Infinity): { d: number; q: Vec3; n: Vec3 } | null {
  let best = surfaceDistance(body.bvh, body.bvhTris, body.bvhNormals, p, maxDistance);
  // Clear of the full body by more than the tiers stand off it there: clear of them too (`need`: the distance a check asks for).
  if (best && best.d > need + slackAt(body, best.triangle)) return best;
  for (const t of body.tiers) {
    const r = surfaceDistance(t.bvh, t.tris, t.normals, p, maxDistance);
    if (r && (!best || r.d < best.d)) best = r;
  }
  return best;
}

function slackAt(body: ShellBody, triangle: number): number {
  const T = body.bvhTris;
  const S = body.tierSlack;
  return Math.max(S[T[triangle * 3]!]!, S[T[triangle * 3 + 1]!]!, S[T[triangle * 3 + 2]!]!);
}

function surfaceDistance(bvh: TriangleBVH, T: ArrayLike<number>, N: ArrayLike<number>, p: Vec3, maxDistance: number): { d: number; q: Vec3; n: Vec3; triangle: number } | null {
  const hit = bvh.closestPoint(p, maxDistance);
  if (!hit) return null;
  const a = T[hit.triangle * 3]!;
  const b = T[hit.triangle * 3 + 1]!;
  const c = T[hit.triangle * 3 + 2]!;
  const [wa, wb, wc] = hit.bary;
  const n = normalize([
    N[a * 3]! * wa + N[b * 3]! * wb + N[c * 3]! * wc,
    N[a * 3 + 1]! * wa + N[b * 3 + 1]! * wb + N[c * 3 + 1]! * wc,
    N[a * 3 + 2]! * wa + N[b * 3 + 2]! * wb + N[c * 3 + 2]! * wc,
  ]);
  const q: Vec3 = [hit.point[0], hit.point[1], hit.point[2]];
  const off = sub(p, q);
  const dist = Math.sqrt(dot(off, off));
  // Inside when the offset points against the normal.
  return { d: dot(off, n) < 0 ? -dist : dist, q, n, triangle: hit.triangle };
}

/** Push vertices closer than `min` to the skin (or inside it) out along the body normal. Returns how many moved. */
export function keepClear(m: WorkMesh, body: ShellBody, min = SKIN_CLEARANCE, skipFixed = true, skipFlags = 0, onlyFlags = 0, dirty: Uint8Array | null = null): number {
  let moved = 0;
  // Up to four passes: out of one surface can be into another (under the chin: out of the neck, into the jaw).
  // After the first, only the vertices that moved (the others were clear and stayed where they were).
  // `dirty`: only these vertices can have changed since the cloth was last made clear.
  let check: Uint8Array | null = dirty;
  for (let pass = 0; pass < 4; pass++) {
    let now = 0;
    const movedNow = new Uint8Array(m.vertexCount);
    for (let v = 0; v < m.vertexCount; v++) {
      if (check && !check[v]) continue;
      if (skipFixed && m.flags[v]! & FIXED) continue;
      if (m.flags[v]! & skipFlags) continue;
      if (onlyFlags && !(m.flags[v]! & onlyFlags)) continue;
      const r = bodyDistance(body, m.p(v), 0.1, min);
      if (!r || r.d >= min) continue;
      m.setP(v, add(r.q, scale(r.n, min * (1 + pass))));
      movedNow[v] = 1;
      now++;
    }
    moved += now;
    if (!now) break;
    check = movedNow;
  }
  return moved;
}

/** Closest point on triangle (exported for the checks). */
export { closestPointOnTriangle };

/**
 * Clearance between vertices too: decimated triangles span the body's curve,
 * so their middles can dip under the skin even when every corner is clear.
 * Each triangle's corners, centre and edge midpoints are measured; a corner
 * moves out by the largest deficit of the samples it belongs to. Six rounds
 * (a push out of one surface can land in another: under the chin, out of the
 * neck and into the jaw).
 */
export function keepClearSampled(m: WorkMesh, body: ShellBody, min = SKIN_CLEARANCE, rounds = 6, skipFlags = 0, dirty: Uint8Array | null = null): number {
  let worst = 0;
  // After the first round, only triangles with a corner that moved: the others measure as before (clear, or with
  // nothing they could move).
  // `dirty`: only triangles with these vertices can have changed since the cloth was last made clear.
  let moved: Uint8Array | null = dirty;
  for (let round = 0; round < rounds; round++) {
    const push = new Float64Array(m.vertexCount * 3);
    const amount = new Float64Array(m.vertexCount);
    let any = false;
    // Corners and edge midpoints are shared between triangles: each measured once a round.
    const N = m.vertexCount;
    const memo = new Map<number, ReturnType<typeof bodyDistance>>();
    const measure = (key: number, s: Vec3) => {
      if (key >= 0 && memo.has(key)) return memo.get(key)!;
      const r = bodyDistance(body, s, 0.05, min);
      if (key >= 0) memo.set(key, r);
      return r;
    };
    for (let t = 0; t < m.triangleCount; t++) {
      const ids = [m.tris[t * 3]!, m.tris[t * 3 + 1]!, m.tris[t * 3 + 2]!];
      if (ids.every((v) => m.flags[v]! & FIXED)) continue;
      if (moved && !ids.some((v) => moved![v])) continue;
      const P = ids.map((v) => m.p(v));
      const edge = (a: number, b: number) => N + Math.min(ids[a]!, ids[b]!) * N + Math.max(ids[a]!, ids[b]!);
      const samples: [number, Vec3][] = [
        [ids[0]!, P[0]!],
        [ids[1]!, P[1]!],
        [ids[2]!, P[2]!],
        [-1, scale(add(add(P[0]!, P[1]!), P[2]!), 1 / 3)],
        [edge(0, 1), scale(add(P[0]!, P[1]!), 0.5)],
        [edge(1, 2), scale(add(P[1]!, P[2]!), 0.5)],
        [edge(2, 0), scale(add(P[2]!, P[0]!), 0.5)],
      ];
      for (const [key, s] of samples) {
        const r = measure(key, s);
        if (!r || r.d >= min) continue;
        const deficit = min - r.d;
        worst = Math.max(worst, deficit);
        any = true;
        for (const v of ids) {
          // Fixed parts (soles, the boot's rings inside them, level hems) keep their place.
          if (m.flags[v]! & (FIXED | skipFlags)) continue;
          if (deficit > amount[v]!) {
            amount[v] = deficit;
            push[v * 3] = r.n[0];
            push[v * 3 + 1] = r.n[1];
            push[v * 3 + 2] = r.n[2];
          }
        }
      }
    }
    if (!any) break;
    moved = new Uint8Array(m.vertexCount);
    for (let v = 0; v < m.vertexCount; v++) {
      if (amount[v]! <= 0) continue;
      m.setP(v, add(m.p(v), scale([push[v * 3]!, push[v * 3 + 1]!, push[v * 3 + 2]!], amount[v]! * 1.2)));
      moved[v] = 1;
    }
  }
  return worst;
}

/**
 * Small pieces of a panel (classification noise along a side seam) join the
 * neighbouring panel they share most edges with, so every panel is one clean
 * piece of cloth per side and seams run smoothly.
 */
export function cleanPanels(m: WorkMesh, minShare = 0.1, minTris = 40): void {
  const T = m.triangleCount;
  const N = m.vertexCount;
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const a = m.tris[t * 3 + k]!;
      const b = m.tris[t * 3 + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * N + Math.max(a, b);
      const list = edgeTris.get(key);
      if (list) list.push(t);
      else edgeTris.set(key, [t]);
    }
  }
  const adj: number[][] = Array.from({ length: T }, () => []);
  for (const list of edgeTris.values()) {
    if (list.length !== 2) continue;
    adj[list[0]!]!.push(list[1]!);
    adj[list[1]!]!.push(list[0]!);
  }
  for (let pass = 0; pass < 3; pass++) {
    const comp = new Int32Array(T).fill(-1);
    const comps: number[][] = [];
    for (let t = 0; t < T; t++) {
      if (comp[t]! >= 0) continue;
      const id = comps.length;
      const list = [t];
      comp[t] = id;
      for (let i = 0; i < list.length; i++) {
        for (const u of adj[list[i]!]!) {
          if (comp[u]! < 0 && m.panel[u] === m.panel[t]) {
            comp[u] = id;
            list.push(u);
          }
        }
      }
      comps.push(list);
    }
    const panelTotal = new Map<number, number>();
    const panelLargest = new Map<number, number>();
    comps.forEach((c, i) => {
      const p = m.panel[c[0]!]!;
      panelTotal.set(p, (panelTotal.get(p) ?? 0) + c.length);
      const best = panelLargest.get(p);
      if (best === undefined || c.length > comps[best]!.length) panelLargest.set(p, i);
    });
    let changed = false;
    comps.forEach((c, i) => {
      const p = m.panel[c[0]!]!;
      if (panelLargest.get(p) === i) return;
      if (c.length >= Math.max(minTris, minShare * panelTotal.get(p)!)) return;
      const votes = new Map<number, number>();
      for (const t of c) for (const u of adj[t]!) if (m.panel[u] !== p) votes.set(m.panel[u]!, (votes.get(m.panel[u]!) ?? 0) + 1);
      let best = -1;
      let bestN = 0;
      for (const [q, n] of [...votes.entries()].sort((x, y) => x[0] - y[0])) {
        if (n > bestN) {
          best = q;
          bestN = n;
        }
      }
      if (best < 0) return;
      for (const t of c) m.panel[t] = best;
      changed = true;
    });
    if (!changed) break;
  }
}

export interface Ellipsoid {
  centre: Vec3;
  radii: Vec3;
}

/**
 * The skull as an ellipsoid, from the head's vertices above the brows: hats
 * and hoods take its shape, so ears and the bumps of the skull never show.
 */
export function skullEllipsoid(body: ShellBody, segment: number, browY: number, extentFrom = browY): Ellipsoid {
  const P = body.positions;
  let maxX = 0;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < P.length / 3; v++) {
    if (body.segment[v] !== segment || P[v * 3 + 1]! < extentFrom) continue;
    maxX = Math.max(maxX, Math.abs(P[v * 3]!));
    maxY = Math.max(maxY, P[v * 3 + 1]!);
    minZ = Math.min(minZ, P[v * 3 + 2]!);
    maxZ = Math.max(maxZ, P[v * 3 + 2]!);
  }
  const cy = browY - 0.02;
  return { centre: [0, cy, (minZ + maxZ) / 2], radii: [maxX, maxY - cy, (maxZ - minZ) / 2] };
}

/**
 * Move vertices of a part (above `yMin`) towards an ellipsoid grown by `grow`
 * (the ease), along the direction from its centre. The blend fades in over
 * 3 cm above `yMin`, so the part below (a hood's neck) joins smoothly.
 * Outwards only, unless `both`.
 */
export function ellipsoidBlend(m: WorkMesh, segments: readonly number[], e: Ellipsoid, grow: number, drape: number, yMin: number, both = false): void {
  const [rx, ry, rz] = [e.radii[0] + grow, e.radii[1] + grow, e.radii[2] + grow];
  const onto = (p: Vec3): { q: number; target: Vec3 } => {
    const d = sub(p, e.centre);
    const q = Math.sqrt((d[0] / rx) * (d[0] / rx) + (d[1] / ry) * (d[1] / ry) + (d[2] / rz) * (d[2] / rz));
    return { q, target: q < 1e-9 ? p : add(e.centre, scale(d, 1 / q)) };
  };
  const part = (v: number) => (m.flags[v]! & FIXED) === 0 && segments.includes(m.seg[v]!) && m.pos[v * 3 + 1]! >= yMin;
  // A hood's head goes onto the ellipsoid all over: from where on the head a smoothed copy of the cloth is (the ear
  // and its canal, projected as they are, fold onto one patch of the ellipsoid; smoothed, they are a gentle bump).
  // An open edge (the face opening, through the front of the ear) smooths along itself.
  const nb = m.neighbours().map((x) => [...x]);
  for (const loop of m.boundaryLoops()) loop.forEach((v, i) => (nb[v] = [loop[(i + loop.length - 1) % loop.length]!, loop[(i + 1) % loop.length]!]));
  let from = Float64Array.from(m.pos);
  if (both) {
    for (let it = 0; it < 40; it++) {
      const next = Float64Array.from(from);
      for (let v = 0; v < m.vertexCount; v++) {
        if (!part(v) || !nb[v]!.length) continue;
        for (let k = 0; k < 3; k++) {
          let c = 0;
          for (const u of nb[v]!) c += from[u * 3 + k]!;
          next[v * 3 + k] = 0.5 * from[v * 3 + k]! + (0.5 * c) / nb[v]!.length;
        }
      }
      from = next;
    }
  }
  const on = new Uint8Array(m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) {
    if (!part(v)) continue;
    const p = m.p(v);
    const { q, target } = onto([from[v * 3]!, from[v * 3 + 1]!, from[v * 3 + 2]!]);
    if (q < 1e-9) continue;
    // Outwards only: cloth bridges over hollows and bumps, it never cuts into the face or the ears.
    if (!both && onto(p).q >= 1) continue;
    const k = drape * Math.min(1, (p[1] - yMin) / 0.03);
    m.setP(v, add(p, scale(sub(both ? target : onto(p).target, p), k)));
    on[v] = k >= 1 ? 1 : 2;
  }
  if (!both) return;
  // Then relaxed over the surface (each vertex to its neighbours' middle, back onto the ellipsoid), so it lies
  // evenly; in the band where the blend fades in, plain smoothing. In place, in vertex order (converges in fewer
  // rounds than all at once, the same on every run).
  for (let it = 0; it < 60; it++) {
    for (let v = 0; v < m.vertexCount; v++) {
      if (!on[v] || !nb[v]!.length) continue;
      let c: Vec3 = [0, 0, 0];
      for (const u of nb[v]!) c = add(c, m.p(u));
      c = scale(c, 1 / nb[v]!.length);
      m.setP(v, on[v] === 1 ? onto(c).target : add(scale(m.p(v), 0.5), scale(c, 0.5)));
    }
  }
}

export interface CylinderSmooth {
  segments: readonly number[];
  yMin: number;
  yMax: number;
  /** The axis (x, z) at a height. */
  axisAt: (y: number) => [number, number];
  /** 0 keeps the cloth's shape, 1 takes the smoothed map. */
  strength: number;
  /** The cloth never comes closer to the skin than this (metres). */
  floor: number;
  /** Blur half-widths (cells): around (of 48) and up (1 cm rows). */
  around?: number;
  up?: number;
  /**
   * Cloth hangs: going down, its radius shrinks by at most this much per
   * metre of height (under a bust, a belly, a seat it falls instead of
   * following the body back in). Omitted: it follows the smoothed map.
   */
  hang?: number;
  /**
   * Rounds of the envelope over the floor (blur, then hold over the floor):
   * the cloth rounds over protrusions with a wide cap. Default none.
   */
  envelope?: number;
  /**
   * Rounds of rounding: the cloth's map spread around and held over the
   * floor, so the cross-section fills out towards round (a loose top stands
   * off a flat back and the sides' relief). Default none.
   */
  round?: number;
  /** The envelope fades in over this much height above `yMin` (a seat over the crotch, where the cloth below still follows the body). */
  envelopeFade?: number;
  debug?: (maps: { R: Float64Array; F: Float64Array; S: Float64Array; A: number; rows: number }) => void;
}

/**
 * Era cloth over a torso or a leg: the cloth's radius from the part's axis,
 * on a 48 x 1 cm grid (rays against the cloth itself), is low-passed at the
 * scale anatomy shows at (about 5 cm), floored at the skin plus `floor`, and
 * the vertices move to it by `strength`. Pecs, shoulder blades and the sides'
 * muscle vanish under the cloth; it never cuts in. Fades out over 2 cm at the
 * range's ends.
 */
export function cylinderSmooth(m: WorkMesh, body: ShellBody, o: CylinderSmooth): void {
  if (o.strength <= 0) return;
  const A = 48;
  const rows = Math.max(3, Math.round((o.yMax - o.yMin) / 0.01));
  const dy = (o.yMax - o.yMin) / rows;
  const cloth = new TriangleBVH(Float64Array.from(m.pos), Uint32Array.from(m.tris));
  const dirs: [number, number][] = [];
  for (let i = 0; i < A; i++) dirs.push([sin((TAU * i) / A), cos((TAU * i) / A)]);
  const R = new Float64Array(A * rows).fill(NaN);
  const F = new Float64Array(A * rows).fill(NaN);
  for (let j = 0; j < rows; j++) {
    const y = o.yMin + (j + 0.5) * dy;
    const [cx, cz] = o.axisAt(y);
    for (let i = 0; i < A; i++) {
      const d = [dirs[i]![0], 0, dirs[i]![1]];
      const hc = cloth.raycast([cx, y, cz], d, 0, 0.7);
      const hb = body.bvh.raycast([cx, y, cz], d, 0, 0.6);
      if (hc) R[j * A + i] = hc.t;
      if (hb) F[j * A + i] = hb.t + o.floor;
    }
  }
  // Fill gaps from neighbours, then blur (separable box, twice: close to a Gaussian).
  const fill = (M: Float64Array) => {
    for (let pass = 0; pass < 8; pass++) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < A; i++) {
        if (Number.isFinite(M[j * A + i]!)) continue;
        let s = 0;
        let k = 0;
        for (const [jj, ii] of [[j - 1, i], [j + 1, i], [j, i - 1], [j, i + 1]] as const) {
          if (jj < 0 || jj >= rows) continue;
          const v = M[jj * A + ((ii + A) % A)]!;
          if (Number.isFinite(v)) {
            s += v;
            k++;
          }
        }
        if (k) M[j * A + i] = s / k;
      }
    }
  };
  fill(R);
  fill(F);
  const wa = o.around ?? 6;
  const wu = o.up ?? 10;
  let S = Float64Array.from(R);
  for (let pass = 0; pass < 2; pass++) S = boxBlur(S, A, rows, wa, wu);
  if (o.hang !== undefined) {
    // From the top of the range down (rows run upwards).
    for (let i = 0; i < A; i++) {
      for (let j = rows - 2; j >= 0; j--) {
        const above = S[(j + 1) * A + i]!;
        if (Number.isFinite(above)) S[j * A + i] = Math.max(S[j * A + i]!, above - o.hang * dy);
      }
    }
  }
  // The cloth over what the floor holds it out from (a bust, a belly, a seat): where the floor is over the smoothed
  // cloth, by how much (the deficit), spread out a few times and held at least as large as it was, then added to
  // the smoothed cloth: the cloth rounds over a protrusion with a wide cap instead of taking its shape. (The
  // deficit, not the radius, is spread: spreading radii around a torso would make it round.)
  const k = 0.008;
  const softMax = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k)) : Number.isFinite(a) ? a : b);
  const deficit = S.map((x, c) => (Number.isFinite(x) && Number.isFinite(F[c]!) ? Math.max(0, F[c]! - x) : 0));
  let G = Float64Array.from(deficit);
  for (let it = 0; it < (o.envelope ?? 0); it++) G = boxBlur(G, A, rows, wa, wu).map((x, c) => Math.max(x, deficit[c]!));
  let E: Float64Array = S.map((x, c) => softMax(x + G[c]!, F[c]!));
  if (o.round) {
    // A plain maximum while iterating (the soft one adds up to k/2 each time it is applied), the soft one last.
    const hardMax = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : Number.isFinite(a) ? a : b);
    for (let it = 0; it < o.round; it++) E = boxBlur(E, A, rows, wa, wu).map((x, c) => hardMax(x, F[c]!));
    E = E.map((x, c) => softMax(x, F[c]!));
  }
  if (o.envelopeFade) {
    for (let j = 0; j < rows; j++) {
      const t = Math.min(1, ((j + 0.5) * dy) / o.envelopeFade);
      const w = t * t * (3 - 2 * t);
      for (let i = 0; i < A; i++) {
        const c = j * A + i;
        if (Number.isFinite(E[c]!)) E[c] = w * E[c]! + (1 - w) * softMax(S[c]!, F[c]!);
      }
    }
  }
  if (o.debug) o.debug({ R, F, S: E, A, rows });
  // Bilinear lookup of the target radius.
  const sample = (M: Float64Array, a: number, y: number): number => {
    const fj = Math.min(rows - 1.0001, Math.max(0, (y - o.yMin) / dy - 0.5));
    const j0 = Math.floor(fj);
    const tj = fj - j0;
    const fi = ((a / TAU) * A + A) % A;
    const i0 = Math.floor(fi);
    const ti = fi - i0;
    const at = (j: number, i: number) => M[Math.min(rows - 1, j) * A + (i % A)]!;
    return (1 - tj) * ((1 - ti) * at(j0, i0) + ti * at(j0, i0 + 1)) + tj * ((1 - ti) * at(j0 + 1, i0) + ti * at(j0 + 1, i0 + 1));
  };
  for (let v = 0; v < m.vertexCount; v++) {
    if (m.flags[v]! & FIXED || !o.segments.includes(m.seg[v]!)) continue;
    const y = m.pos[v * 3 + 1]!;
    if (y < o.yMin || y > o.yMax) continue;
    const [cx, cz] = o.axisAt(y);
    const dx = m.pos[v * 3]! - cx;
    const dz = m.pos[v * 3 + 2]! - cz;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r < 1e-6) continue;
    const a = atan2(dx, dz);
    const target = sample(E, a, y);
    if (!Number.isFinite(target)) continue;
    const fade = Math.min(1, (y - o.yMin) / 0.02, (o.yMax - y) / 0.02);
    const nr = r + (target - r) * o.strength * Math.max(0, fade);
    m.pos[v * 3] = cx + (dx / r) * nr;
    m.pos[v * 3 + 2] = cz + (dz / r) * nr;
  }
  if (!o.envelope || o.strength < 1) return;
  // Cloth from a deep, narrow hollow (between the buttocks) lands on one line of the bridge over it: relaxed over
  // the target surface (each vertex to its neighbours' middle, back onto the surface), it spreads out again.
  // In place, in vertex order; away from the range's ends and hems.
  const nb = m.neighbours();
  const loops = new Uint8Array(m.vertexCount);
  for (const loop of m.boundaryLoops()) for (const v of loop) loops[v] = 1;
  const inside = (v: number) => {
    if (loops[v] || m.flags[v]! & FIXED || !o.segments.includes(m.seg[v]!)) return false;
    const y = m.pos[v * 3 + 1]!;
    return y > o.yMin + 0.02 && y < o.yMax - 0.02;
  };
  const members: number[] = [];
  for (let v = 0; v < m.vertexCount; v++) if (inside(v)) members.push(v);
  for (let it = 0; it < 15; it++) {
    for (const v of members) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const u of nb[v]!) {
        x += m.pos[u * 3]!;
        y += m.pos[u * 3 + 1]!;
        z += m.pos[u * 3 + 2]!;
      }
      const k = nb[v]!.length;
      if (!k) continue;
      x /= k;
      y /= k;
      z /= k;
      if (y < o.yMin + 0.02 || y > o.yMax - 0.02) continue;
      const [cx, cz] = o.axisAt(y);
      const dx = x - cx;
      const dz = z - cz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r < 1e-6) continue;
      const target = sample(E, atan2(dx, dz), y);
      if (!Number.isFinite(target)) continue;
      m.pos[v * 3] = cx + (dx / r) * target;
      m.pos[v * 3 + 1] = y;
      m.pos[v * 3 + 2] = cz + (dz / r) * target;
    }
  }
}

/** Separable box blur of an `A` x `rows` map (wrapping around, clamped up and down), skipping missing cells. */
function boxBlur(M: ArrayLike<number>, A: number, rows: number, wa: number, wu: number): Float64Array<ArrayBuffer> {
  const T1 = new Float64Array(M.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < A; i++) {
      let s = 0;
      let k = 0;
      for (let di = -wa; di <= wa; di++) {
        const v = M[j * A + ((i + di + A) % A)]!;
        if (Number.isFinite(v)) {
          s += v;
          k++;
        }
      }
      T1[j * A + i] = k ? s / k : NaN;
    }
  }
  const T2 = new Float64Array(M.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < A; i++) {
      let s = 0;
      let k = 0;
      for (let dj = -wu; dj <= wu; dj++) {
        const v = T1[Math.min(rows - 1, Math.max(0, j + dj)) * A + i]!;
        if (Number.isFinite(v)) {
          s += v;
          k++;
        }
      }
      T2[j * A + i] = k ? s / k : NaN;
    }
  }
  return T2;
}
