/**
 * The shell generator (PRD Part 3, F28): a template's spec in, a garment mesh
 * out. Steps, in a fixed order:
 *
 *  1. cut the body to the garment's region; hems are exact boundary loops;
 *  2. panels (pieces of cloth) per triangle, from where it sits on the body;
 *  3. ease per vertex (bands keep theirs), diffused across body-part borders;
 *  4. offset along the body normal, limited where other skin is close;
 *  5. level hems, Taubin smoothing (hides anatomy), convex-hull drape;
 *  6. radial widening (sleeves towards the cuff), skin clearance;
 *  7. decimation to the slot budget, leaving room for:
 *  8. lofted parts (straight trouser legs below the knee, flares) on the
 *     coarse loops, clearance between vertices, soles, rims on every
 *     remaining open loop, brims, pockets;
 * 10. UVs: LSCM per panel piece, packed at one texel density.
 */
import type { ImportSlot, RawGarmentMesh } from '../../proxy/garment-import';
import { simplifierReady } from '../../mesh/simplify';
import { SLOT_BUDGET } from '../../proxy/decimate';
import type { ShellBody } from './body';
import { cutBody, cutField, type Constraint, type CutField } from './cut';
import { addBrim, addPatch, addRims, addSoleSlab, brimArc, loopHem, surfaceOf, type PatchOptions, type RimResult } from './features';
import { decimateWork, replayDecimation, toRawGarment, triCentre, unwrap, type DecimationRecord, type Unwrapped } from './finish';
import { loftTube, loopCentre, scaleRadially, scaleToHold, bodyPointsBetween } from './loft';
import { FIXED, RIM, WorkMesh } from './mesh';
import { SKIN_CLEARANCE, bodyDistance, cleanPanels, cylinderSmooth, diffuseEase, ellipsoidBlend, type CylinderSmooth, hullBlend, keepClear, keepClearSampled, offsetFromBody, skullEllipsoid, taubin, type HullGroup } from './shape';
import { SEG } from './body';
import { landmarks } from './landmarks';
import { add, lerp, type Vec3 } from './vec';

/** Garment classes of section 5.0, with their minimum ease (cloth to skin, metres). */
export type GarmentClass = 'tshirt' | 'shirt' | 'sweater' | 'jacket' | 'coat' | 'trousers' | 'jeans' | 'tight' | 'gloves' | 'boots' | 'socks' | 'hat' | 'accessory';
export const CLASS_MIN_EASE: Record<GarmentClass, number> = {
  tshirt: 0.008,
  shirt: 0.012,
  sweater: 0.015,
  jacket: 0.025,
  coat: 0.035,
  trousers: 0.01,
  jeans: 0.008,
  tight: 0.0015,
  gloves: 0.003,
  boots: 0.006,
  socks: 0.0012,
  hat: 0.004,
  accessory: 0,
};

/** A band along a hem (rib cuffs, waistbands, roll-necks): its own ease and a deeper rim. */
export interface BandSpec {
  hem: string;
  /** How far up from the hem (metres). */
  height: number;
  ease: number;
  rim: number;
}

/** A tube continuing a hem loop down to a level hem (trouser legs below the knee, skirts). */
export interface LoftSpec {
  from: string;
  /** Name of the hem the tube ends in. */
  to: string;
  hemY: number;
  /** Where the hem's centre is (x, z; y is hemY). */
  hemCentre: Vec3;
  /** Ring positions along the tube (0..1, ascending, ending at 1). */
  ts: number[];
  /** Extra radial scale along the tube (1 = straight), after the tube holds the body. */
  radial: (t: number) => number;
  /** Body points the tube must hold inside, with this much ease. */
  hold?: { segments: number[]; y0: number; y1: number; ease: number };
  /** Widen the shell above the loop to meet the tube (no kink at the knee). */
  widen?: { segments: number[]; height: number; axisAt: (y: number) => Vec3 };
  seg: number;
  ease: number;
  panelOf: (c: Vec3) => string;
  /** Vertices around the tube (default 20). */
  around?: number;
}

/** Radial scaling of some vertices about an axis (sleeves widening to the cuff). */
export interface RadialSpec {
  segments: number[];
  axisAt: (p: Vec3) => Vec3;
  axisDir: (p: Vec3) => Vec3;
  factor: (p: Vec3) => number;
}

export interface SoleSpec {
  /** Body parts of one foot (the boot's upper over it). */
  segments: number[];
  /** Height of the sole's top above the ground. */
  height: number;
  welt: number;
  seg: number;
}

export interface ShellSpec {
  slot: ImportSlot;
  garmentClass: GarmentClass;
  domain: number[];
  constraints: Constraint[];
  /** Ease of a body vertex (metres), from its part, position and body normal. */
  ease: (seg: number, p: Vec3, n: Vec3) => number;
  bands?: BandSpec[];
  /** Rim depth of hems without a band (metres). */
  rim: number;
  /** Cloth thickness (half of it is added to the ease). */
  thickness: number;
  /** Taubin iterations. */
  smoothing: number;
  hull?: HullGroup[];
  /** Era cloth over the torso or legs: the radius map low-passed (after the hull blend). */
  cylinders?: CylinderSmooth[];
  /** Blend the head towards the skull's ellipsoid grown by the ease (hats, hoods). */
  skull?: { drape: number; grow: number; yMin: number; /** Head vertices above this height size the ellipsoid (default the brow: over the ears, lower). */ extentFrom?: number; /** Cloth outside the ellipsoid comes onto it too. */ both?: boolean };
  /** Hems that sit level (straight hems on a horizontal plane). */
  levelHems?: string[];
  lofts?: LoftSpec[];
  radial?: RadialSpec[];
  soles?: SoleSpec[];
  /** A shape added after the offset (a boot's toe box), from the body point, its normal and part. */
  displace?: (p: Vec3, n: Vec3, seg: number) => Vec3;
  /** Vertices of these parts stay above this height (room for a sole). */
  floor?: { segments: number[]; y: number }[];
  brim?: { hem: string; length: number; droop: number; thickness: number };
  pockets?: PatchOptions[];
  panelOf: (c: Vec3, seg: number) => string;
  /** Hems a generator makes itself (not from constraints or lofts). */
  extraHems?: string[];
  /** Builds the surface directly (boots), in place of steps 1 to 6. Gets the hem index of a name. */
  generate?: (body: ShellBody, hem: (name: string) => number) => WorkMesh;
}

export interface ShellBuild {
  mesh: WorkMesh;
  /** Hem names by hem index (constraints, then lofts). */
  hems: string[];
  rims: RimResult[];
  raw: RawGarmentMesh;
  uv: Unwrapped;
  /** Triangles before decimation. */
  denseTriangles: number;
  /** What fixes the garment's topology, to generate it again on another body. */
  topology: ShellTopology;
}

function clone(m: WorkMesh): WorkMesh {
  const c = new WorkMesh();
  c.pos = m.pos.slice();
  c.nrm = m.nrm.slice();
  c.seg = m.seg.slice();
  c.bodyVert = m.bodyVert.slice();
  c.flags = m.flags.slice();
  c.ease = m.ease.slice();
  c.hem = m.hem.slice();
  c.dist = m.dist.slice();
  c.tris = m.tris.slice();
  c.panel = m.panel.slice();
  c.panels = m.panels.slice();
  return c;
}

function majority(a: number, b: number, c: number): number {
  return a === b || a === c ? a : b === c ? b : a;
}

/**
 * The decisions that fix a garment's topology, made once on the reference
 * body. Replayed on any other body, the garment is generated for that body's
 * own shape with exactly the same vertices, triangles, panels and UVs (PRD
 * Part 3, M21: identical topology for identical parameters on every body).
 */
export interface ShellTopology {
  /** The reference body's cut field (the same edges split at the same fractions). */
  field: CutField | null;
  /** Dense triangles kept after removing fragments. */
  kept: Uint8Array | null;
  /** Panel of each dense triangle, and the panel names. */
  panel: Int32Array;
  panels: string[];
  decimation: DecimationRecord;
  /** A cap's brim: the front arc of its hem. */
  brimArc: Int32Array | null;
  vertices: number;
  triangles: number;
}

export interface ShellRun {
  mesh: WorkMesh;
  hems: string[];
  rims: RimResult[];
  topology: ShellTopology;
  denseTriangles: number;
}

function hemNames(spec: ShellSpec): string[] {
  const hems = spec.constraints.map((c) => c.id);
  (spec.lofts ?? []).forEach((l) => hems.push(l.to));
  hems.push(...(spec.extraHems ?? []));
  return hems;
}

/**
 * Steps 1 to 6: the dense garment surface. With `topo` (from the reference
 * body), the cut, the fragments and the panels are the recorded ones.
 */

export function shellSurface(body: ShellBody, spec: ShellSpec, topo?: ShellTopology): { mesh: WorkMesh; hems: string[]; field: CutField | null; kept: Uint8Array | null } {
  const hems = hemNames(spec);
  const hemIndex = (name: string) => hems.indexOf(name);
  if (spec.generate) {
    const mesh = spec.generate(body, hemIndex);
    if (topo) {
      mesh.panels = topo.panels.slice();
      for (let t = 0; t < mesh.triangleCount; t++) mesh.panel[t] = topo.panel[t]!;
    }
    return { mesh, hems, field: null, kept: null };
  }
  const field = topo?.field ?? cutField(body, spec.domain, spec.constraints);
  const m = cutBody(body, spec.domain, spec.constraints, field);
  let kept: Uint8Array;
  if (topo?.kept) {
    kept = topo.kept;
  } else {
    // Fragments: components under 5% of the largest one's area.
    const { of, count } = m.components();
    const area = new Float64Array(count);
    for (let t = 0; t < m.triangleCount; t++) area[of[t]!] = area[of[t]!]! + m.triangleArea(t);
    let max = 0;
    for (const x of area) max = Math.max(max, x);
    kept = new Uint8Array(m.triangleCount);
    for (let t = 0; t < m.triangleCount; t++) kept[t] = area[of[t]!]! >= 0.05 * max ? 1 : 0;
  }
  m.filter((t) => kept[t] === 1);

  // 2. Panels, from the triangle's place on the (reference) body.
  if (topo) {
    m.panels = topo.panels.slice();
    for (let t = 0; t < m.triangleCount; t++) m.panel[t] = topo.panel[t]!;
  } else {
    m.panels = [];
    for (let t = 0; t < m.triangleCount; t++) {
      const seg = majority(m.seg[m.tris[t * 3]!]!, m.seg[m.tris[t * 3 + 1]!]!, m.seg[m.tris[t * 3 + 2]!]!);
      m.panel[t] = m.panelId(spec.panelOf(triCentre(m, t), seg));
    }
    cleanPanels(m);
  }

  // 3. Ease, bands fixed, diffused.
  const fixed = new Uint8Array(m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) m.ease[v] = spec.ease(m.seg[v]!, m.p(v), m.n(v));
  for (const b of spec.bands ?? []) {
    const h = hemIndex(b.hem);
    for (let v = 0; v < m.vertexCount; v++) {
      if (m.hem[v] === h && m.dist[v]! <= b.height) {
        m.ease[v] = b.ease;
        fixed[v] = 1;
      }
    }
  }
  const nb = m.neighbours();
  diffuseEase(m, nb, fixed);

  // 4. Offset.
  const sideOf = Float64Array.from({ length: m.vertexCount }, (_, v) => m.pos[v * 3]!);
  offsetFromBody(m, body, spec.thickness);
  keepSide(m, sideOf);
  if (spec.displace) {
    for (let v = 0; v < m.vertexCount; v++) m.setP(v, add(m.p(v), spec.displace(m.p(v), m.n(v), m.seg[v]!)));
  }

  // 5. Level hems, smoothing, drape.
  const keepY = new Uint8Array(m.vertexCount);
  const level = new Set((spec.levelHems ?? []).map(hemIndex));
  // Only the vertices a level hem cut: an open front joins hem, front edges and neckline into one loop.
  for (const loop of m.boundaryLoops()) {
    for (const h of level) {
      const own = loop.filter((v) => m.hem[v] === h);
      if (own.length < 3) continue;
      let y = 0;
      for (const v of own) y += m.pos[v * 3 + 1]!;
      y /= own.length;
      for (const v of own) {
        m.pos[v * 3 + 1] = y;
        keepY[v] = 1;
      }
    }
  }
  taubin(m, nb, spec.smoothing, keepY);
  for (const g of spec.hull ?? []) hullBlend(m, g);
  for (const c of spec.cylinders ?? []) cylinderSmooth(m, body, c);
  if (spec.skull) ellipsoidBlend(m, [SEG.head], skullEllipsoid(body, SEG.head, landmarks(body).head.brow[1], spec.skull.extentFrom), spec.skull.grow, spec.skull.drape, spec.skull.yMin, spec.skull.both);
  if ((spec.hull ?? []).length || spec.skull || (spec.cylinders ?? []).length) taubin(m, nb, (spec.cylinders ?? []).length ? 8 : 3, keepY);
  for (const r of spec.radial ?? []) {
    for (let v = 0; v < m.vertexCount; v++) {
      if (!r.segments.includes(m.seg[v]!)) continue;
      scaleRadially(m, [v], r.axisAt, r.factor, r.axisDir(m.p(v)));
    }
  }

  // 6. Clearance, then floors: the flattened underside of a boot sits on its sole, inside it.
  keepSide(m, sideOf);
  keepClear(m, body);
  for (const f of spec.floor ?? []) {
    for (let v = 0; v < m.vertexCount; v++) {
      if (f.segments.includes(m.seg[v]!) && m.pos[v * 3 + 1]! <= f.y) {
        m.pos[v * 3 + 1] = f.y;
        m.flags[v] = m.flags[v]! | FIXED;
      }
    }
  }
  return { mesh: m, hems, field: topo ? null : field, kept: topo ? null : kept };
}

/**
 * Cloth stays on its own side of the body's middle (x = 0), no nearer to it
 * than half its body point is: between the legs, the offsets of the two inner
 * thighs would otherwise cross at the crotch. `side` is each vertex's x on
 * the body.
 */
function keepSide(m: WorkMesh, side: Float64Array): void {
  for (let v = 0; v < m.vertexCount; v++) {
    const xb = side[v]!;
    if (Math.abs(xb) < 0.002 || m.flags[v]! & FIXED) continue;
    const sgn = xb > 0 ? 1 : -1;
    const x = m.pos[v * 3]!;
    if (sgn * x < 0.5 * Math.abs(xb)) m.pos[v * 3] = sgn * 0.5 * Math.abs(xb);
  }
}

/**
 * Lofted tubes continue their loops on the decimated surface (a tube has as
 * many vertices around as its `around`, joined to the coarse loop).
 */
function addLofts(m: WorkMesh, body: ShellBody, spec: ShellSpec, hems: string[]): void {
  const hemIndex = (name: string) => hems.indexOf(name);
  for (const l of spec.lofts ?? []) {
    const from = hemIndex(l.from);
    const loop = m.boundaryLoops().find((lp) => loopHem(m, lp) === from);
    if (!loop) continue;
    const c0 = loopCentre(m, loop);
    for (const v of loop) m.pos[v * 3 + 1] = c0[1];
    const hemC: Vec3 = [l.hemCentre[0], l.hemY, l.hemCentre[2]];
    const axisAt = (y: number): Vec3 => lerp(c0, hemC, (c0[1] - y) / Math.max(1e-6, c0[1] - l.hemY));
    let tube = 1;
    if (l.hold) {
      const pts = bodyPointsBetween(body, l.hold.segments, l.hold.y0, l.hold.y1);
      tube = scaleToHold(m, loop, c0, pts, l.hold.ease, axisAt);
    }
    if (l.widen && tube > 1) {
      const w = l.widen;
      const verts: number[] = [];
      for (let v = 0; v < m.vertexCount; v++) {
        const y = m.pos[v * 3 + 1]!;
        if (w.segments.includes(m.seg[v]!) && y >= c0[1] - 1e-6 && y <= c0[1] + w.height) verts.push(v);
      }
      const t = tube;
      scaleRadially(
        m,
        verts,
        (p) => w.axisAt(p[1]),
        (p) => 1 + (t - 1) * (1 - Math.min(1, Math.max(0, (p[1] - c0[1]) / w.height))),
      );
      tube = 1;
    }
    const scaleT = tube;
    const first = m.vertexCount;
    loftTube(m, loop, {
      hemCentre: hemC,
      ts: l.ts,
      radial: (t) => scaleT * l.radial(t),
      panelOf: (c) => m.panelId(l.panelOf(c)),
      seg: l.seg,
      ease: l.ease,
      hem: hemIndex(l.to),
      around: l.around ?? 20,
    });
    // The tube's last few centimetres (the hem is level, and fixed) bend out over the foot where it rises into
    // them (a high instep), as a trouser hem breaks over a shoe.
    for (let v = first; v < m.vertexCount; v++) {
      const y = m.pos[v * 3 + 1]!;
      if (y > l.hemY + 0.04) continue;
      for (let it = 0; it < 6; it++) {
        const r = bodyDistance(body, m.p(v), 0.05, SKIN_CLEARANCE + 0.002);
        if (!r || r.d >= SKIN_CLEARANCE + 0.002) break;
        const dx = m.pos[v * 3]! - hemC[0];
        const dz = m.pos[v * 3 + 2]! - hemC[2];
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const push = SKIN_CLEARANCE + 0.003 - r.d;
        m.pos[v * 3] = m.pos[v * 3]! + (dx / len) * push;
        m.pos[v * 3 + 2] = m.pos[v * 3 + 2]! + (dz / len) * push;
      }
    }
  }
}

/** Steps 7 to 9 on a decimated surface: lofts, clearance, rims, brim, soles, pockets. */
function finishSurface(m: WorkMesh, body: ShellBody, spec: ShellSpec, hems: string[], arc: Int32Array | null, countOnly = false): { rims: RimResult[]; arc: Int32Array | null } {
  const hemIndex = (name: string) => hems.indexOf(name);
  const rimOf = new Map<number, number>();
  for (const b of spec.bands ?? []) rimOf.set(hemIndex(b.hem), b.rim);
  // Even out the decimated facets a little (decimation leaves some corners sharper than the cloth's curve).
  if (!spec.generate) taubin(m, m.neighbours(), 2);
  addLofts(m, body, spec, hems);
  if (!countOnly) keepClearSampled(m, body);
  // What the rims and parts change from here: new vertices, and hem vertices a rim's repair moves.
  const settled = m.vertexCount;
  const before = Float64Array.from(m.pos);
  const rims = addRims(m, body, (h) => rimOf.get(h) ?? spec.rim, countOnly);
  let usedArc: Int32Array | null = null;
  if (spec.brim) {
    const h = hemIndex(spec.brim.hem);
    const r = rims.find((x) => x.hem === h);
    if (r) {
      const a = arc ? Array.from(arc) : brimArc(m, r.loop);
      addBrim(m, r.loop, spec.brim.length, spec.brim.droop, spec.brim.thickness, a);
      usedArc = Int32Array.from(a);
    }
  }
  for (const s of spec.soles ?? []) addSoleSlab(m, s.segments, body.ground + s.height, body.ground, s.welt, s.seg);
  if (spec.pockets?.length) {
    const s = surfaceOf(m);
    for (const p of spec.pockets) addPatch(m, s, p);
  }
  // Last, every free vertex (rims included) clear of the skin: between vertices, then each vertex.
  // Rims were made clear as strips (addRims); moved vertex by vertex they would fold.
  if (countOnly) return { rims, arc: usedArc };
  const dirty = new Uint8Array(m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) {
    dirty[v] = v >= settled || m.pos[v * 3] !== before[v * 3] || m.pos[v * 3 + 1] !== before[v * 3 + 1] || m.pos[v * 3 + 2] !== before[v * 3 + 2] ? 1 : 0;
  }
  keepClearSampled(m, body, SKIN_CLEARANCE, 2, RIM, dirty);
  keepClear(m, body, SKIN_CLEARANCE, true, RIM, 0, dirty);
  // A rim vertex still in the skin (no lean of its profile cleared it: a hood's opening against the chin) comes out on its own.
  const edges = rims.flatMap((r) => r.loop.map((b, i) => [b, r.lips[i]!, m.pos[b * 3]!, m.pos[b * 3 + 1]!, m.pos[b * 3 + 2]!] as const));
  keepClear(m, body, SKIN_CLEARANCE / 2, true, 0, RIM, dirty);
  // The lip goes with its inner edge (the rim keeps its depth).
  for (const [b, a, x, y, z] of edges) {
    const d: Vec3 = [m.pos[b * 3]! - x, m.pos[b * 3 + 1]! - y, m.pos[b * 3 + 2]! - z];
    if ((d[0] || d[1] || d[2]) && !(m.flags[a]! & FIXED)) m.setP(a, add(m.p(a), d));
  }
  return { rims, arc: usedArc };
}

/** Share of the slot's budget a generated (ring) surface may have before it is decimated (the rest: rims). */
export const GENERATED_SHARE = 0.88;

/**
 * The generator, synchronously. Without `topo` it runs on the reference body
 * and records its topology (decimating to the slot budget, which needs the
 * simplifier ready); with `topo` it replays that topology on `body`.
 */
export function runShell(body: ShellBody, spec: ShellSpec, topo?: ShellTopology): ShellRun {
  const surface = shellSurface(body, spec, topo);
  const dense = surface.mesh;
  const hems = surface.hems;
  if (topo) {
    const mesh = replayDecimation(dense, topo.decimation);
    const { rims } = finishSurface(mesh, body, spec, hems, topo.brimArc);
    if (mesh.vertexCount !== topo.vertices || mesh.triangleCount !== topo.triangles) {
      throw new Error(`shell replay: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles; the reference had ${topo.vertices}, ${topo.triangles}`);
    }
    return { mesh, hems, rims, topology: topo, denseTriangles: dense.triangleCount };
  }
  const budget = SLOT_BUDGET[spec.slot] ?? SLOT_BUDGET.accessory!;
  // Room for rims and parts: generated (ring) surfaces are already coarse and need less.
  // The largest decimation target whose finished garment (lofts, rims, parts) fits the budget, found by counting
  // (`finishSurface` without measuring the body), then finished once for real.
  const count = (t: number) => {
    const { mesh } = decimateWork(clone(dense), t);
    const decimated = mesh.triangleCount;
    finishSurface(mesh, body, spec, hems, null, true);
    return { decimated, total: mesh.triangleCount };
  };
  let target = Math.round(budget * (spec.generate ? GENERATED_SHARE : 0.7));
  let c = count(target);
  // Lower until it fits (from what decimation gave: a surface already under the target does not shrink by lowering it).
  let tries = 0;
  let failed = -1;
  while (c.total > budget && target > 100 && tries++ < 8) {
    failed = Math.min(target, c.decimated);
    target = Math.max(100, failed - Math.ceil((c.total - budget) * 1.1));
    c = count(target);
  }
  // Lowered past what was needed: back up between the two (a few halvings).
  if (failed > 0 && c.total <= budget) {
    let lo = target;
    let hi = failed;
    for (let i = 0; i < 4 && hi - lo > 8; i++) {
      const mid = Math.round((lo + hi) / 2);
      if (count(mid).total <= budget) lo = mid;
      else hi = mid;
    }
    target = lo;
  }
  let result: { mesh: WorkMesh; rims: RimResult[]; record: DecimationRecord; arc: Int32Array | null } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { mesh, record } = decimateWork(clone(dense), target);
    const { rims, arc } = finishSurface(mesh, body, spec, hems, null);
    result = { mesh, rims, record, arc };
    // A brim's arc (measured for real) can make it a few triangles more than counted.
    if (mesh.triangleCount <= budget) break;
    target = Math.max(100, target - Math.ceil((mesh.triangleCount - budget) * 1.1));
  }
  const { mesh, rims, record, arc } = result!;
  const topology: ShellTopology = {
    field: surface.field,
    kept: surface.kept,
    panel: Int32Array.from(dense.panel),
    panels: dense.panels.slice(),
    decimation: record,
    brimArc: arc,
    vertices: mesh.vertexCount,
    triangles: mesh.triangleCount,
  };
  return { mesh, hems, rims, topology, denseTriangles: dense.triangleCount };
}

/** The whole generator on the reference body: the garment's mesh with rims, parts and UVs, within its slot's budget. */
export async function buildShell(body: ShellBody, spec: ShellSpec): Promise<ShellBuild> {
  await simplifierReady();
  const run = runShell(body, spec);
  const uv = unwrap(run.mesh);
  return { mesh: run.mesh, hems: run.hems, rims: run.rims, raw: toRawGarment(run.mesh, uv), uv, denseTriangles: run.denseTriangles, topology: run.topology };
}
