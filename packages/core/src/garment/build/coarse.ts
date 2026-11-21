/**
 * Pattern to PS2 garment mesh (PRD Part 3, F31), on the body the pattern was draped on:
 *
 * 1. coarse remesh of every panel in 2D at the profile's edge length (Classic 4 cm, Enhanced 3 cm, Hero
 *    2 cm), longer if the garment would not fit its slot's budget; stitched edges get the same samples on
 *    both sides;
 * 2. lift: each coarse vertex goes where the same pattern point went in the fine drape (barycentric lookup);
 * 3. weld the seams (only hems and openings stay open), orient the triangles outwards, push vertices nearer
 *    the skin than the garment class's minimum ease out along the body's normal, relax with 5 smoothing
 *    passes; attachments (pockets, flaps, yokes) are laid on their host, 4 mm proud;
 * 4. rims (section 5.0) on every hem and opening;
 * 5. UVs: the pattern itself in real centimetres, every panel an island, packed at one density (the rims
 *    take the pattern's hem allowance).
 */
import type { ImportSlot, RawGarmentMesh } from '../../proxy/garment-import';
import { SLOT_BUDGET } from '../../proxy/decimate';
import { Rotation } from '../pattern/num/rotation';
import type { AttachmentSpec, BuiltPattern } from '../pattern/build';
import type { PanelSpec, PatternSpec } from '../pattern/spec';
import type { ShellBody } from '../shell/body';
import { CLASS_MIN_EASE, type GarmentClass } from '../shell/build';
import { addRims } from '../shell/features';
import { WorkMesh } from '../shell/mesh';
import { bodyDistance, SKIN_CLEARANCE } from '../shell/shape';
import type { Vec3 } from '../shell/vec';
import { discretise, type Discretised, type PanelMesh } from '../drape/discretise';
import type { DrapeResult } from '../drape/drape';
import { TriangleLocator } from '../drape/locate';
import { packRects } from './pack';

export type DetailProfile = 'classic' | 'enhanced' | 'hero';
/** Coarse edge length per profile (cm). */
export const PROFILE_EDGE: Record<DetailProfile, number> = { classic: 4, enhanced: 3, hero: 2 };
/** Rim depth on hems and openings (m). */
export const PATTERN_RIM = 0.006;
/** How far attachments stand off their host (m). */
export const ATTACH_OFFSET = 0.004;
/** UV gutter between islands (cm of cloth). */
const GUTTER = 2;
const SMOOTH_PASSES = 5;

export interface CoarseOptions {
  slot: ImportSlot;
  garmentClass: GarmentClass;
  profile: DetailProfile;
  rim?: number;
}

/** Where an island sits in the atlas: pattern (cm) to UV. */
export interface IslandPlacement {
  panel: string;
  attachment: boolean;
  /** UV of a pattern point: (x - minX) * scale + u0, (y - minY) * scale + v0. */
  minX: number;
  minY: number;
  u0: number;
  v0: number;
  /** UV units per centimetre (the same for every island). */
  scale: number;
}

export interface CoarseReport {
  edgeCm: number;
  vertices: number;
  triangles: number;
  budget: number;
  /** Open edges of the welded cloth before rims that are not on a hem or opening of the pattern. */
  openSeamEdges: number;
  /** Edges with more than two triangles. */
  nonManifoldEdges: number;
  boundaryLoops: number;
  /** Texel density per island relative to the mean: the largest deviation (0.05 = 5%). */
  texelSpread: number;
  /** Per island: its texel density relative to the mean. */
  islandDensity: Record<string, number>;
  pushedOut: number;
}

export interface CoarseGarment {
  mesh: WorkMesh;
  raw: RawGarmentMesh;
  islands: IslandPlacement[];
  /** UV units per metre of cloth. */
  density: number;
  report: CoarseReport;
}

type V2 = [number, number];

/** A pattern holding only some panels (attachments meshed on their own). */
function subSpec(spec: PatternSpec, names: readonly string[]): PatternSpec {
  const panels: PatternSpec['panels'] = {};
  for (const n of names) panels[n] = spec.panels[n]!;
  return { panels, stitches: [] };
}

function weldMap(d: Discretised): { of: Int32Array; count: number } {
  const parent = Int32Array.from({ length: d.particles }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let s = 0; s < d.seams.length / 2; s++) {
    const a = find(d.seams[s * 2]!);
    const b = find(d.seams[s * 2 + 1]!);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const id = new Int32Array(d.particles).fill(-1);
  const of = new Int32Array(d.particles);
  let count = 0;
  for (let i = 0; i < d.particles; i++) {
    const r = find(i);
    if (id[r] === -1) id[r] = count++;
    of[i] = id[r]!;
  }
  return { of, count };
}

/** Edges of a triangle set keyed by (min, max), with their triangle count. */
function edgeCounts(tris: ArrayLike<number>, n: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let t = 0; t < tris.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k]!;
      const b = tris[t * 3 + ((k + 1) % 3)]!;
      if (a === b) continue;
      const key = Math.min(a, b) * n + Math.max(a, b);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  return m;
}

/**
 * Triangles a coarse discretisation would give, rims included (two-segment rims: 4 per open edge), and
 * whether its welded cloth is manifold (no edge shared by three triangles).
 */
function estimate(d: Discretised, att: Discretised | null): { total: number; manifold: boolean } {
  const { of, count } = weldMap(d);
  const tris: number[] = [];
  for (const p of d.panels) for (let i = 0; i < p.tris.length; i++) tris.push(of[p.offset + p.tris[i]!]!);
  let open = 0;
  let manifold = true;
  for (const c of edgeCounts(tris, count).values()) {
    if (c === 1) open++;
    if (c > 2) manifold = false;
  }
  let total = tris.length / 3 + open * 4;
  if (att) for (const p of att.panels) total += p.tris.length / 3 + p.edgeSamples.reduce((s, e) => s + e.length - 1, 0) * 4;
  return { total, manifold };
}

/** The coarse discretisation: the profile's edge length, longer until the garment fits its slot's budget. */
export function coarseMesh(built: BuiltPattern, profile: DetailProfile, budget: number): { d: Discretised; att: Discretised | null; edge: number } {
  const skip = new Set(built.attachments.map((a) => a.panel));
  const attNames = built.attachments.map((a) => a.panel);
  let edge = PROFILE_EDGE[profile];
  for (let i = 0; i < 40; i++) {
    const d = discretise(built.spec, edge, skip);
    const att = attNames.length ? discretise(subSpec(built.spec, attNames), edge) : null;
    const e = estimate(d, att);
    if ((e.total <= budget && e.manifold) || i === 39) return { d, att, edge };
    // Over budget: longer edges; not manifold (two narrow bands' samples meeting across a seam): a little longer.
    edge *= e.total > budget ? 1.06 : 1.03;
  }
  throw new Error('unreachable');
}

const rot = (p: PanelSpec) => Rotation.fromEuler('XYZ', p.rotation, true);

/**
 * An attachment's pattern point in its host's pattern coordinates (both flat on the host's plane). The
 * placements give the rotation; the attachment's recorded host-local points (taken before GarmentCode's
 * pivot step moved the host) give the offset.
 */
function toHost(att: PanelSpec, host: PanelSpec, rec?: AttachmentSpec): (x: number, y: number) => V2 {
  const base = placedToHost(att, host);
  let dx = 0;
  let dy = 0;
  if (rec && rec.points.length) {
    let n = 0;
    rec.edges.forEach((ei, j) => {
      const e = att.edges[ei];
      if (!e) return;
      for (let k = 0; k < 2; k++) {
        const v = att.vertices[e.endpoints[k]!]!;
        const q = rec.points[j * 2 + k];
        if (!q) continue;
        const h = base(v[0]!, v[1]!);
        dx += q[0]! - h[0];
        dy += q[1]! - h[1];
        n++;
      }
    });
    if (n) {
      dx /= n;
      dy /= n;
    }
  }
  return (x, y) => {
    const h = base(x, y);
    return [h[0] + dx, h[1] + dy];
  };
}

function placedToHost(att: PanelSpec, host: PanelSpec): (x: number, y: number) => V2 {
  const ra = rot(att);
  const rh = rot(host);
  return (x, y) => {
    const p = ra.apply([x, y, 0]);
    const w: [number, number, number] = [p[0] + att.translation[0]! - host.translation[0]!, p[1] + att.translation[1]! - host.translation[1]!, p[2] + att.translation[2]! - host.translation[2]!];
    // Inverse rotation: the transpose.
    const m = rh.matrix();
    return [m[0]![0]! * w[0] + m[1]![0]! * w[1] + m[2]![0]! * w[2], m[0]![1]! * w[0] + m[1]![1]! * w[1] + m[2]![1]! * w[2]];
  };
}

function faceNormal(P: ArrayLike<number>, a: number, b: number, c: number): Vec3 {
  const ux = P[b * 3]! - P[a * 3]!;
  const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
  const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
  const vx = P[c * 3]! - P[a * 3]!;
  const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
  const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Orient every connected piece consistently (across shared edges), then outwards: a piece whose
 * area-weighted normals point into the body more than out is flipped.
 */
function orientOutward(m: WorkMesh, body: ShellBody): void {
  const n = m.vertexCount;
  const T = m.triangleCount;
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++) {
      const a = m.tris[t * 3 + k]!;
      const b = m.tris[t * 3 + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * n + Math.max(a, b);
      let l = edgeTris.get(key);
      if (!l) edgeTris.set(key, (l = []));
      l.push(t);
    }
  const has = (t: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (m.tris[t * 3 + k] === a && m.tris[t * 3 + ((k + 1) % 3)] === b) return true;
    return false;
  };
  const flip = (t: number) => {
    const b = m.tris[t * 3 + 1]!;
    m.tris[t * 3 + 1] = m.tris[t * 3 + 2]!;
    m.tris[t * 3 + 2] = b;
  };
  const comp = new Int32Array(T).fill(-1);
  let pieces = 0;
  for (let seed = 0; seed < T; seed++) {
    if (comp[seed] !== -1) continue;
    const queue = [seed];
    comp[seed] = pieces;
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi]!;
      for (let k = 0; k < 3; k++) {
        const a = m.tris[t * 3 + k]!;
        const b = m.tris[t * 3 + ((k + 1) % 3)]!;
        const l = edgeTris.get(Math.min(a, b) * n + Math.max(a, b))!;
        if (l.length !== 2) continue;
        const u = l[0] === t ? l[1]! : l[0]!;
        if (comp[u] !== -1) continue;
        // t runs a -> b; a consistent neighbour runs b -> a.
        if (has(u, a, b)) flip(u);
        comp[u] = pieces;
        queue.push(u);
      }
    }
    pieces++;
  }
  const score = new Float64Array(pieces);
  for (let t = 0; t < T; t++) {
    const a = m.tris[t * 3]!;
    const b = m.tris[t * 3 + 1]!;
    const c = m.tris[t * 3 + 2]!;
    const nf = faceNormal(m.pos, a, b, c);
    const g: Vec3 = [(m.pos[a * 3]! + m.pos[b * 3]! + m.pos[c * 3]!) / 3, (m.pos[a * 3 + 1]! + m.pos[b * 3 + 1]! + m.pos[c * 3 + 1]!) / 3, (m.pos[a * 3 + 2]! + m.pos[b * 3 + 2]! + m.pos[c * 3 + 2]!) / 3];
    const r = bodyDistance(body, g, 0.3);
    if (!r) continue;
    score[comp[t]!] = score[comp[t]!]! + nf[0] * r.n[0] + nf[1] * r.n[1] + nf[2] * r.n[2];
  }
  for (let t = 0; t < T; t++) if (score[comp[t]!]! < 0) flip(t);
}

/** Taubin smoothing (lambda then mu), boundary vertices along their boundary only. */
function smooth(m: WorkMesh, passes: number, open: Set<number>, boundaryNb: Map<number, number[]>): void {
  const nb = m.neighbours();
  const step = (f: number) => {
    const P = Float64Array.from(m.pos);
    for (let v = 0; v < m.vertexCount; v++) {
      const list = open.has(v) ? (boundaryNb.get(v) ?? []) : nb[v]!;
      if (!list.length) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const u of list) {
        x += P[u * 3]!;
        y += P[u * 3 + 1]!;
        z += P[u * 3 + 2]!;
      }
      const k = 1 / list.length;
      m.pos[v * 3] = P[v * 3]! + f * (x * k - P[v * 3]!);
      m.pos[v * 3 + 1] = P[v * 3 + 1]! + f * (y * k - P[v * 3 + 1]!);
      m.pos[v * 3 + 2] = P[v * 3 + 2]! + f * (z * k - P[v * 3 + 2]!);
    }
  };
  for (let i = 0; i < passes; i++) {
    step(0.5);
    step(-0.53);
  }
}

/** Outward unit normal (pattern plane) of the boundary ring at a boundary sample of a panel. */
function ringNormal(pm: PanelMesh, local: number): V2 {
  const nb = pm.edgeSamples.reduce((s, e) => s + e.length - 1, 0);
  if (local >= nb) return [0, 0];
  const P = pm.points;
  const prev = (local + nb - 1) % nb;
  const next = (local + 1) % nb;
  const tx = P[next * 2]! - P[prev * 2]!;
  const ty = P[next * 2 + 1]! - P[prev * 2 + 1]!;
  const l = Math.sqrt(tx * tx + ty * ty) || 1;
  // Right of the direction of travel for a counter-clockwise ring is outside.
  const sgn = pm.clockwise ? -1 : 1;
  return [(sgn * ty) / l, (-sgn * tx) / l];
}

export function buildCoarse(built: BuiltPattern, drape: DrapeResult, body: ShellBody, opts: CoarseOptions): CoarseGarment {
  const budget = SLOT_BUDGET[opts.slot] ?? SLOT_BUDGET.accessory!;
  const rim = opts.rim ?? PATTERN_RIM;
  const { d, att, edge } = coarseMesh(built, opts.profile, budget);
  const { of, count } = weldMap(d);

  // 2. Lift: average of the welded points' drape positions.
  const pos = new Float64Array(count * 3);
  const hits = new Float64Array(count);
  const w = new Float64Array(3);
  const fineByName = new Map(drape.fine.panels.map((p) => [p.name, p]));
  const locators = new Map<string, TriangleLocator>();
  const locator = (name: string) => {
    let l = locators.get(name);
    if (!l) {
      const fp = fineByName.get(name)!;
      locators.set(name, (l = new TriangleLocator(fp.points, fp.tris)));
    }
    return l;
  };
  const lift = (name: string, x: number, y: number, out: Vec3): void => {
    const fp = fineByName.get(name)!;
    const t = locator(name).locate(x, y, w);
    out[0] = out[1] = out[2] = 0;
    for (let k = 0; k < 3; k++) {
      const v = fp.offset + fp.tris[t * 3 + k]!;
      for (let c = 0; c < 3; c++) out[c] = out[c]! + w[k]! * drape.positions[v * 3 + c]!;
    }
  };
  const q: Vec3 = [0, 0, 0];
  for (const p of d.panels) {
    for (let i = 0; i < p.count; i++) {
      lift(p.name, p.points[i * 2]!, p.points[i * 2 + 1]!, q);
      const v = of[p.offset + i]!;
      for (let c = 0; c < 3; c++) pos[v * 3 + c] = pos[v * 3 + c]! + q[c]!;
      hits[v] = hits[v]! + 1;
    }
  }
  const m = new WorkMesh();
  for (let v = 0; v < count; v++) m.addVertex([pos[v * 3]! / hits[v]!, pos[v * 3 + 1]! / hits[v]!, pos[v * 3 + 2]! / hits[v]!], [0, 0, 0], -1, 0, -1, CLASS_MIN_EASE[opts.garmentClass]);
  // Pattern coordinates of each (vertex, panel) for the UVs.
  const pat = new Map<string, V2>();
  const patNormal = new Map<string, V2>();
  const key = (v: number, panel: number) => `${v}|${panel}`;
  for (const p of d.panels) {
    const pid = m.panelId(p.name);
    for (let i = 0; i < p.count; i++) {
      const v = of[p.offset + i]!;
      pat.set(key(v, pid), [p.points[i * 2]!, p.points[i * 2 + 1]!]);
      patNormal.set(key(v, pid), ringNormal(p, i));
    }
    for (let t = 0; t < p.tris.length / 3; t++) m.addTri(of[p.offset + p.tris[t * 3]!]!, of[p.offset + p.tris[t * 3 + 1]!]!, of[p.offset + p.tris[t * 3 + 2]!]!, pid);
  }

  // Watertight: every open edge of the welded cloth lies on a free (unstitched) pattern edge.
  const stitched = new Set<string>();
  for (const st of built.spec.stitches) for (const s of [st[0], st[1]]) stitched.add(`${s.panel}#${s.edge}`);
  const freeEdge = new Set<number>();
  for (const p of d.panels) {
    p.edgeSamples.forEach((samples, ei) => {
      if (stitched.has(`${p.name}#${ei}`)) return;
      for (let k = 0; k + 1 < samples.length; k++) {
        const a = of[p.offset + samples[k]!]!;
        const b = of[p.offset + samples[k + 1]!]!;
        freeEdge.add(Math.min(a, b) * count + Math.max(a, b));
      }
    });
  }
  let openSeamEdges = 0;
  let nonManifoldEdges = 0;
  for (const [k, c] of edgeCounts(m.tris, count)) {
    if (c === 1 && !freeEdge.has(k)) openSeamEdges++;
    if (c > 2) nonManifoldEdges++;
  }

  // 3. Outwards, then the class's minimum ease and relaxation.
  orientOutward(m, body);
  const minEase = CLASS_MIN_EASE[opts.garmentClass];
  let pushedOut = 0;
  for (let v = 0; v < m.vertexCount; v++) {
    const r = bodyDistance(body, m.p(v), Math.max(0.1, minEase * 2));
    if (!r) continue;
    m.nrm[v * 3] = r.n[0];
    m.nrm[v * 3 + 1] = r.n[1];
    m.nrm[v * 3 + 2] = r.n[2];
    if (r.d >= minEase) continue;
    const k = minEase - r.d;
    m.setP(v, [m.pos[v * 3]! + r.n[0] * k, m.pos[v * 3 + 1]! + r.n[1] * k, m.pos[v * 3 + 2]! + r.n[2] * k]);
    pushedOut++;
  }
  const loops0 = m.boundaryLoops();
  const open = new Set<number>();
  const boundaryNb = new Map<number, number[]>();
  for (const loop of loops0) {
    for (let i = 0; i < loop.length; i++) {
      open.add(loop[i]!);
      boundaryNb.set(loop[i]!, [loop[(i + loop.length - 1) % loop.length]!, loop[(i + 1) % loop.length]!]);
    }
  }
  smooth(m, SMOOTH_PASSES, open, boundaryNb);
  // Nothing within the skin clearance after relaxing.
  for (let v = 0; v < m.vertexCount; v++) {
    const r = bodyDistance(body, m.p(v), 0.05, SKIN_CLEARANCE);
    if (!r || r.d >= SKIN_CLEARANCE) continue;
    const k = SKIN_CLEARANCE - r.d;
    m.setP(v, [m.pos[v * 3]! + r.n[0] * k, m.pos[v * 3 + 1]! + r.n[1] * k, m.pos[v * 3 + 2]! + r.n[2] * k]);
  }

  // 4. Rims: every open loop (the pattern's hems and openings).
  for (let v = 0; v < m.vertexCount; v++) {
    m.hem[v] = 0;
    m.dist[v] = open.has(v) ? 0 : 1;
  }
  const loops = m.boundaryLoops();
  const rimFirst = m.vertexCount;
  addRims(m, body, () => rim);
  // Rim vertices come in (lip, inner edge) pairs per loop vertex, loop by loop.
  const rimOf = new Map<number, [number, number]>();
  let r = rimFirst;
  for (const loop of loops)
    for (const v of loop) {
      rimOf.set(r, [v, 0.5]);
      rimOf.set(r + 1, [v, 1]);
      r += 2;
    }

  // Attachments on their host's final surface, ATTACH_OFFSET out along the host's face normal.
  if (att) {
    const hostLoc = new Map<string, { loc: TriangleLocator; pm: PanelMesh }>();
    for (const a of built.attachments) {
      const ap = att.panels.find((p) => p.name === a.panel);
      const hp = d.panels.find((p) => p.name === a.host);
      if (!ap || !hp) continue;
      let hl = hostLoc.get(a.host);
      if (!hl) hostLoc.set(a.host, (hl = { loc: new TriangleLocator(hp.points, hp.tris), pm: hp }));
      const map = toHost(built.spec.panels[a.panel]!, built.spec.panels[a.host]!, a);
      const pid = m.panelId(a.panel);
      const first = m.vertexCount;
      for (let i = 0; i < ap.count; i++) {
        const [hx, hy] = map(ap.points[i * 2]!, ap.points[i * 2 + 1]!);
        const t = hl.loc.locate(hx, hy, w);
        const vs = [0, 1, 2].map((k) => of[hp.offset + hp.tris[t * 3 + k]!]!);
        const p: Vec3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) p[c] = p[c]! + w[k]! * m.pos[vs[k]! * 3 + c]!;
        // The host triangle's normal as wound now (outwards).
        const hostTri = findTri(m, vs[0]!, vs[1]!, vs[2]!);
        const nf: Vec3 = hostTri >= 0 ? faceNormal(m.pos, m.tris[hostTri * 3]!, m.tris[hostTri * 3 + 1]!, m.tris[hostTri * 3 + 2]!) : faceNormal(m.pos, vs[0]!, vs[1]!, vs[2]!);
        const l = Math.sqrt(nf[0] * nf[0] + nf[1] * nf[1] + nf[2] * nf[2]) || 1;
        const v = m.addVertex([p[0] + (nf[0] / l) * ATTACH_OFFSET, p[1] + (nf[1] / l) * ATTACH_OFFSET, p[2] + (nf[2] / l) * ATTACH_OFFSET], [nf[0] / l, nf[1] / l, nf[2] / l], -1, 0, -1, minEase + ATTACH_OFFSET);
        pat.set(key(v, pid), [ap.points[i * 2]!, ap.points[i * 2 + 1]!]);
        patNormal.set(key(v, pid), ringNormal(ap, i));
      }
      const t0 = m.triangleCount;
      for (let t = 0; t < ap.tris.length / 3; t++) m.addTri(first + ap.tris[t * 3]!, first + ap.tris[t * 3 + 1]!, first + ap.tris[t * 3 + 2]!, pid);
      // Facing the same way as the host under it.
      let s = 0;
      for (let t = t0; t < m.triangleCount; t++) {
        const nf = faceNormal(m.pos, m.tris[t * 3]!, m.tris[t * 3 + 1]!, m.tris[t * 3 + 2]!);
        const a0 = m.tris[t * 3]!;
        s += nf[0] * m.nrm[a0 * 3]! + nf[1] * m.nrm[a0 * 3 + 1]! + nf[2] * m.nrm[a0 * 3 + 2]!;
      }
      if (s < 0)
        for (let t = t0; t < m.triangleCount; t++) {
          const b = m.tris[t * 3 + 1]!;
          m.tris[t * 3 + 1] = m.tris[t * 3 + 2]!;
          m.tris[t * 3 + 2] = b;
        }
      // A side wall down towards the host (the patch's thickness), facing out from the patch.
      const nb = ap.edgeSamples.reduce((acc, e) => acc + e.length - 1, 0);
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < ap.count; i++) {
        cx += m.pos[(first + i) * 3]! / ap.count;
        cy += m.pos[(first + i) * 3 + 1]! / ap.count;
        cz += m.pos[(first + i) * 3 + 2]! / ap.count;
      }
      const wall: number[] = [];
      for (let i = 0; i < nb; i++) {
        const v = first + i;
        const dn = ATTACH_OFFSET - 0.0005;
        const wv = m.addVertex([m.pos[v * 3]! - m.nrm[v * 3]! * dn, m.pos[v * 3 + 1]! - m.nrm[v * 3 + 1]! * dn, m.pos[v * 3 + 2]! - m.nrm[v * 3 + 2]! * dn], [m.nrm[v * 3]!, m.nrm[v * 3 + 1]!, m.nrm[v * 3 + 2]!], -1, 0, -1, minEase);
        rimOf.set(wv, [v, 0.7]);
        wall.push(wv);
      }
      for (let i = 0; i < nb; i++) {
        const j = (i + 1) % nb;
        const a = first + i;
        const b = first + j;
        const wa = wall[i]!;
        const wb = wall[j]!;
        const nf = faceNormal(m.pos, a, b, wb);
        const mx = (m.pos[a * 3]! + m.pos[b * 3]!) / 2 - cx;
        const my = (m.pos[a * 3 + 1]! + m.pos[b * 3 + 1]!) / 2 - cy;
        const mz = (m.pos[a * 3 + 2]! + m.pos[b * 3 + 2]!) / 2 - cz;
        if (nf[0] * mx + nf[1] * my + nf[2] * mz >= 0) {
          m.addTri(a, b, wb, pid);
          m.addTri(a, wb, wa, pid);
        } else {
          m.addTri(b, a, wa, pid);
          m.addTri(b, wa, wb, pid);
        }
      }
    }
  }


  // 5. UVs: the pattern, each panel an island, rims in the hem allowance.
  const islandsByPanel = m.panels.map((name) => {
    const src = d.panels.find((p) => p.name === name) ?? att?.panels.find((p) => p.name === name);
    return { name, pm: src!, attachment: !d.panels.some((p) => p.name === name) };
  });
  const margin = (rim * 100) + GUTTER / 2;
  // One texel density on the finished garment: each island is scaled by how much its cloth grew from the
  // pattern (the drape's stretch, gathers, the push out to the class's ease), within [0.25, 4].
  const area3 = new Float64Array(m.panels.length);
  const areaP = new Float64Array(m.panels.length);
  for (let t = 0; t < m.triangleCount; t++) {
    const vs = [m.tris[t * 3]!, m.tris[t * 3 + 1]!, m.tris[t * 3 + 2]!];
    if (vs.some((v) => rimOf.has(v))) continue;
    const pp = vs.map((v) => pat.get(key(v, m.panel[t]!)));
    if (pp.some((x) => !x)) continue;
    const [a, b, c] = pp as V2[];
    areaP[m.panel[t]!] = areaP[m.panel[t]!]! + Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1])) / 2;
    const nf = faceNormal(m.pos, vs[0]!, vs[1]!, vs[2]!);
    area3[m.panel[t]!] = area3[m.panel[t]!]! + (Math.sqrt(nf[0] * nf[0] + nf[1] * nf[1] + nf[2] * nf[2]) / 2) * 1e4;
  }
  const grow = islandsByPanel.map((_, i) => (areaP[i]! > 0 && area3[i]! > 0 ? Math.sqrt(area3[i]! / areaP[i]!) : 1));
  let gsum = 0;
  let gw = 0;
  grow.forEach((g, i) => {
    gsum += g * areaP[i]!;
    gw += areaP[i]!;
  });
  const gmean = gw > 0 ? gsum / gw : 1;
  const kIsl = grow.map((g) => Math.min(4, Math.max(0.25, g / gmean)));
  const rects = islandsByPanel.map(({ pm }) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < pm.count; i++) {
      x0 = Math.min(x0, pm.points[i * 2]!);
      x1 = Math.max(x1, pm.points[i * 2]!);
      y0 = Math.min(y0, pm.points[i * 2 + 1]!);
      y1 = Math.max(y1, pm.points[i * 2 + 1]!);
    }
    return { x0: x0 - margin, y0: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
  });
  const packed = packRects(rects.map((r, i) => ({ w: r.w * kIsl[i]!, h: r.h * kIsl[i]! })));
  const scale = 1 / Math.max(packed.width, packed.height);
  const islands: IslandPlacement[] = islandsByPanel.map(({ name, attachment }, i) => ({
    panel: name,
    attachment,
    minX: rects[i]!.x0,
    minY: rects[i]!.y0,
    u0: packed.x[i]! * scale,
    v0: packed.y[i]! * scale,
    scale: scale * kIsl[i]!,
  }));
  const uvIndex = new Map<string, number>();
  const uvs: number[] = [];
  const uvOf = (v: number, panel: number): number => {
    const k = key(v, panel);
    let i = uvIndex.get(k);
    if (i !== undefined) return i;
    let p = pat.get(k);
    if (!p) {
      const rv = rimOf.get(v);
      const base = rv ? pat.get(key(rv[0], panel)) : undefined;
      const nrm = rv ? (patNormal.get(key(rv[0], panel)) ?? [0, 0]) : [0, 0];
      p = base ? [base[0] + nrm[0]! * rv![1] * rim * 100, base[1] + nrm[1]! * rv![1] * rim * 100] : [islands[panel]!.minX, islands[panel]!.minY];
    }
    const isl = islands[panel]!;
    i = uvs.length / 2;
    uvs.push((p[0] - isl.minX) * isl.scale + isl.u0, (p[1] - isl.minY) * isl.scale + isl.v0);
    uvIndex.set(k, i);
    return i;
  };
  const T = m.triangleCount;
  const faceVerts = new Uint32Array(T * 4);
  const faceUvs = new Uint32Array(T * 4);
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      faceVerts[t * 4 + k] = m.tris[t * 3 + k]!;
      faceUvs[t * 4 + k] = uvOf(m.tris[t * 3 + k]!, m.panel[t]!);
    }
    faceVerts[t * 4 + 3] = faceVerts[t * 4 + 2]!;
    faceUvs[t * 4 + 3] = faceUvs[t * 4 + 2]!;
  }
  const raw: RawGarmentMesh = { positions: Float32Array.from(m.pos), uvs: Float32Array.from(uvs), faceVerts, faceUvs, hasUvs: true };

  // Texel density per island (cloth triangles only, rims excluded): sqrt(UV area / surface area).
  const uvA = new Float64Array(m.panels.length);
  const sA = new Float64Array(m.panels.length);
  for (let t = 0; t < T; t++) {
    const vs = [m.tris[t * 3]!, m.tris[t * 3 + 1]!, m.tris[t * 3 + 2]!];
    if (vs.some((v) => rimOf.has(v))) continue;
    const ui = [faceUvs[t * 4]!, faceUvs[t * 4 + 1]!, faceUvs[t * 4 + 2]!];
    const ua = Math.abs((uvs[ui[1]! * 2]! - uvs[ui[0]! * 2]!) * (uvs[ui[2]! * 2 + 1]! - uvs[ui[0]! * 2 + 1]!) - (uvs[ui[2]! * 2]! - uvs[ui[0]! * 2]!) * (uvs[ui[1]! * 2 + 1]! - uvs[ui[0]! * 2 + 1]!)) / 2;
    const nf = faceNormal(m.pos, vs[0]!, vs[1]!, vs[2]!);
    const sa = Math.sqrt(nf[0] * nf[0] + nf[1] * nf[1] + nf[2] * nf[2]) / 2;
    uvA[m.panel[t]!] = uvA[m.panel[t]!]! + ua;
    sA[m.panel[t]!] = sA[m.panel[t]!]! + sa;
  }
  const dens: number[] = [];
  const densOf: number[] = [];
  for (let i = 0; i < m.panels.length; i++) {
    densOf.push(sA[i]! > 1e-6 ? Math.sqrt(uvA[i]! / sA[i]!) : 0);
    if (sA[i]! > 1e-6) dens.push(densOf[i]!);
  }
  const meanD = dens.reduce((s, x) => s + x, 0) / Math.max(1, dens.length);
  let texelSpread = 0;
  for (const x of dens) texelSpread = Math.max(texelSpread, Math.abs(x / meanD - 1));

  return {
    mesh: m,
    raw,
    islands,
    density: scale * gmean * 100,
    report: { edgeCm: edge, vertices: m.vertexCount, triangles: T, budget, openSeamEdges, nonManifoldEdges, boundaryLoops: loops.length, texelSpread, islandDensity: Object.fromEntries(m.panels.map((n, i) => [n, densOf[i]! / meanD])), pushedOut },
  };
}

function findTri(m: WorkMesh, a: number, b: number, c: number): number {
  for (let t = 0; t < m.triangleCount; t++) {
    const x = m.tris[t * 3]!;
    const y = m.tris[t * 3 + 1]!;
    const z = m.tris[t * 3 + 2]!;
    if ((x === a || x === b || x === c) && (y === a || y === b || y === c) && (z === a || z === b || z === c)) return t;
  }
  return -1;
}
