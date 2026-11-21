/**
 * Drape a built pattern on a body (PRD Part 3, F30): discretise the panels (1.5 cm, at most 8,000
 * particles), place them around the body, sew and settle them with the XPBD solver, and measure the result
 * (seam gaps, body penetration, stretch of woven cloth).
 *
 * Time: 2.0 s of simulated time, then on to 4.0 s while the fastest particle moves faster than 1 mm/s
 * (checked at frame boundaries). Attachments (pockets, flaps, yokes) are not simulated: they are laid on
 * their host's draped surface afterwards (F31).
 */
import type { BuiltPattern } from '../pattern/build';
import type { ShellBody } from '../shell/body';
import { MeshCollider } from './collide';
import { BodySdf } from './sdf';
import { discretise, type Discretised } from './discretise';
import { CLOTH_PRESETS, type ClothKind } from './materials';
import { placePanels, wrapGroups, type WrapGroup } from './place';
import { Cloth, DEFAULT_SETTINGS, type ClothMaterial, type SolverSettings } from './xpbd';

export interface DrapeOptions {
  /** Target fine edge length (cm). */
  h?: number;
  maxParticles?: number;
  settings?: SolverSettings;
  minTime?: number;
  maxTime?: number;
  /** Stop after minTime once no particle moves faster than this (m/s). */
  restSpeed?: number;
  /** A clock (ms) for the timing in the result; generators do not read one themselves. */
  clock?: () => number;
  /** Called after every frame; return false to cancel. */
  onFrame?: (info: { frame: number; time: number; maxSpeed: number; progress: number }) => boolean | void;
}

export interface DrapeMetrics {
  /** Largest distance between sewn seam samples (m). */
  seamGap: number;
  /** Deepest particle inside the body (m, 0 when none). */
  penetration: number;
  /**
   * Stretch of woven cloth along its threads (the pattern's warp and weft): per triangle the larger of the
   * two, area-weighted over the woven panels: the mean, the 95th percentile and the largest (0.01 = 1%).
   */
  wovenStrainMean: number;
  wovenStrainP95: number;
  wovenStrainMax: number;
  maxSpeed: number;
  /** Largest seam gap when the seams were welded (m). */
  weldGap: number;
  /** The particle (rest point) deepest in the body, -1 for none. */
  penetrationAt: number;
}

/**
 * Stretch of a triangle along the pattern's two axes (warp: the pattern's y, weft: its x), from the
 * deformation gradient between its rest triangle (pattern plane) and its current one; and its rest area.
 */
export function threadStretch(x: Float64Array, rest2d: Float64Array, a: number, b: number, c: number): { weft: number; warp: number; area: number } {
  const u1 = rest2d[b * 2]! - rest2d[a * 2]!;
  const v1 = rest2d[b * 2 + 1]! - rest2d[a * 2 + 1]!;
  const u2 = rest2d[c * 2]! - rest2d[a * 2]!;
  const v2 = rest2d[c * 2 + 1]! - rest2d[a * 2 + 1]!;
  const det = u1 * v2 - u2 * v1;
  if (det === 0) return { weft: 0, warp: 0, area: 0 };
  const e1x = x[b * 3]! - x[a * 3]!;
  const e1y = x[b * 3 + 1]! - x[a * 3 + 1]!;
  const e1z = x[b * 3 + 2]! - x[a * 3 + 2]!;
  const e2x = x[c * 3]! - x[a * 3]!;
  const e2y = x[c * 3 + 1]! - x[a * 3 + 1]!;
  const e2z = x[c * 3 + 2]! - x[a * 3 + 2]!;
  // F = [e1 e2] [[u1 u2] [v1 v2]]^-1: its columns are the images of the pattern's x and y directions.
  const fux = (e1x * v2 - e2x * v1) / det;
  const fuy = (e1y * v2 - e2y * v1) / det;
  const fuz = (e1z * v2 - e2z * v1) / det;
  const fvx = (e2x * u1 - e1x * u2) / det;
  const fvy = (e2y * u1 - e1y * u2) / det;
  const fvz = (e2z * u1 - e1z * u2) / det;
  return { weft: Math.sqrt(fux * fux + fuy * fuy + fuz * fuz) - 1, warp: Math.sqrt(fvx * fvx + fvy * fvy + fvz * fvz) - 1, area: Math.abs(det) / 2 };
}

export interface DrapeResult {
  fine: Discretised;
  /** Pattern coordinates (m) per particle. */
  rest2d: Float64Array;
  /** All triangles (global particle indices), outward wound. */
  tris: Uint32Array;
  /** Panel of each triangle (index into fine.panels). */
  triPanel: Uint16Array;
  placed: Float64Array;
  /** Final positions per rest point (welded points share their particle's position). */
  positions: Float64Array;
  /** Rest point -> particle after welding. */
  merge: Int32Array;
  particles: number;
  groups: WrapGroup['id'][];
  cloth: ClothKind[];
  frames: number;
  simTime: number;
  ms: number;
  cancelled: boolean;
  metrics: DrapeMetrics;
}

export const DRAPE_H = 1.5;
export const MAX_PARTICLES = 8000;

/** The visible full body as triangles (exact closest points: the penetration check). */
export function bodyCollider(body: ShellBody): MeshCollider {
  return new MeshCollider(body.bvhPositions, body.bvhTris, body.bvhNormals, body.bvh);
}

const sdfCache = new WeakMap<ShellBody, BodySdf>();

/** The drape's collider: the body's signed distance field (built once per body). */
export function bodySdf(body: ShellBody): BodySdf {
  let s = sdfCache.get(body);
  if (!s) {
    s = new BodySdf(body.bvhPositions, body.bvhTris, body.bvhNormals, body.bvh);
    sdfCache.set(body, s);
  }
  return s;
}

/** The fine edge length for a pattern: 1.5 cm, longer if the particles would exceed the cap. */
export function fineEdge(built: BuiltPattern, skip: ReadonlySet<string>, h = DRAPE_H, maxParticles = MAX_PARTICLES): Discretised {
  let d = discretise(built.spec, h, skip);
  for (let i = 0; i < 12 && d.particles > maxParticles; i++) {
    h *= Math.sqrt(d.particles / maxParticles) * 1.02;
    d = discretise(built.spec, h, skip);
  }
  return d;
}

/** Progress of a drape in steps (`drapeSteps`). */
export interface DrapeProgress {
  frame: number;
  time: number;
  /** 0..1 */
  progress: number;
}

/** Drape a pattern (see drapeSteps), all at once. */
export function drapePattern(built: BuiltPattern, body: ShellBody, clothOf: (panel: string) => ClothKind, opts: DrapeOptions = {}): DrapeResult {
  const steps = drapeSteps(built, body, clothOf, opts);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * The drape one frame at a time: yields after every frame (a caller can stop iterating to cancel, or keep
 * an interface live between frames), returns the result.
 */
export function* drapeSteps(built: BuiltPattern, body: ShellBody, clothOf: (panel: string) => ClothKind, opts: DrapeOptions = {}): Generator<DrapeProgress, DrapeResult> {
  const clock = opts.clock ?? (() => 0);
  const t0 = clock();
  const skip = new Set(built.attachments.map((a) => a.panel));
  const fine = fineEdge(built, skip, opts.h ?? DRAPE_H, opts.maxParticles ?? MAX_PARTICLES);
  const N = fine.particles;
  const rest2d = new Float64Array(N * 2);
  const T = fine.panels.reduce((s, p) => s + p.tris.length / 3, 0);
  const tris = new Uint32Array(T * 3);
  const triPanel = new Uint16Array(T);
  const kinds: ClothKind[] = [];
  const materials: ClothMaterial[] = [];
  const triMaterial = new Uint8Array(T);
  let t = 0;
  fine.panels.forEach((p, pi) => {
    for (let i = 0; i < p.count * 2; i++) rest2d[p.offset * 2 + i] = p.points[i]! / 100;
    const kind = clothOf(p.name);
    let mi = kinds.indexOf(kind);
    if (mi < 0) {
      mi = kinds.push(kind) - 1;
      materials.push(CLOTH_PRESETS[kind]);
    }
    for (let k = 0; k < p.tris.length / 3; k++) {
      // Rest triangles must be counter-clockwise in the pattern plane for the solver's areas: the outward
      // winding of a clockwise panel is restored for the output.
      const a = p.offset + p.tris[k * 3]!;
      const b = p.offset + p.tris[k * 3 + 1]!;
      const c = p.offset + p.tris[k * 3 + 2]!;
      tris[t * 3] = a;
      tris[t * 3 + 1] = b;
      tris[t * 3 + 2] = c;
      triPanel[t] = pi;
      triMaterial[t] = mi;
      t++;
    }
  });
  const restTris = Uint32Array.from(tris);
  for (let k = 0; k < T; k++) {
    if (fine.panels[triPanel[k]!]!.clockwise) {
      restTris[k * 3 + 1] = tris[k * 3 + 2]!;
      restTris[k * 3 + 2] = tris[k * 3 + 1]!;
    }
  }
  const groups = wrapGroups(body);
  const placement = placePanels(
    body,
    fine.panels.map((mesh) => ({ spec: built.spec.panels[mesh.name]!, mesh })),
    built.spec.stitches,
    groups,
  );
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  // Trousers and skirts hang from the waist (PRD F30 attachments): the points of the free edges along the
  // garment's top may not drop more than ANCHOR_DROP below where they start.
  const anchorRest = placement.upper ? null : waistAnchors(fine, built, placement.positions);
  const anchorsFor = (M: Int32Array | null, count: number) => {
    if (!anchorRest) return undefined;
    const minY = new Float64Array(count).fill(-Infinity);
    for (const o of anchorRest) {
      const p = M ? M[o]! : o;
      minY[p] = Math.max(minY[p]!, placement.positions[o * 3 + 1]! - ANCHOR_DROP);
    }
    const particles: number[] = [];
    const ys: number[] = [];
    for (let p = 0; p < count; p++) if (minY[p]! > -Infinity) {
      particles.push(p);
      ys.push(minY[p]!);
    }
    return { particles: Uint32Array.from(particles), minY: Float64Array.from(ys) };
  };
  let cloth = new Cloth({ positions: placement.positions, rest2d, tris: restTris, triMaterial, materials, seams: fine.seams, anchors: anchorsFor(null, N) }, settings);
  const collider = bodySdf(body);
  const minTime = opts.minTime ?? 2;
  const maxTime = opts.maxTime ?? 4;
  const rest = opts.restSpeed ?? 0.001;
  let cancelled = false;
  let speed = Infinity;
  const totalFrames = Math.round(maxTime / settings.dt);
  // Phase 1 sews (seam constraints ramping up); once the seams have closed, sewn points are welded into one
  // particle each and the garment settles as one sheet (phase 2).
  let merge: Int32Array | null = null;
  let weldGap = 0;
  const rebuilt = (c: Cloth, w: ReturnType<typeof weld>, m: Int32Array): Cloth => {
    const next = new Cloth({ positions: w.positions, velocities: w.velocities, rest2d, tris: restTris, triMaterial, materials, seams: w.seams, merge: m, anchors: anchorsFor(m, w.positions.length / 3) }, settings);
    next.frames = c.frames;
    next.time = c.time;
    return next;
  };
  const weldBy = settings.seamRamp + WELD_WAIT_MAX;
  while (cloth.frames < totalFrames) {
    cloth.frame(collider);
    speed = cloth.frameSpeed();
    const time = cloth.frames * settings.dt;
    if (!merge && time >= settings.seamRamp - 1e-9) {
      const gap = maxSeamGap(cloth.x, fine.seams);
      if (gap <= WELD_TOL || time >= weldBy - 1e-9) {
        weldGap = gap;
        const w = weld(cloth, fine.seams, SEW_TOL);
        merge = w.merge;
        cloth = rebuilt(cloth, w, merge);
      }
    } else if (merge && cloth.seams.length && cloth.frames % REWELD_FRAMES === 0) {
      // Seams still open when the rest were welded: welded as they close.
      const w = weld(cloth, cloth.seams, SEW_TOL);
      if (w.seams.length < cloth.seams.length) {
        const m2 = w.merge;
        merge = Int32Array.from(merge, (p: number) => m2[p]!);
        cloth = rebuilt(cloth, w, merge);
      }
    }
    const progress = time < minTime ? (time / minTime) * 0.9 : 0.9 + (0.1 * (time - minTime)) / (maxTime - minTime);
    if (opts.onFrame?.({ frame: cloth.frames, time, maxSpeed: speed, progress }) === false) {
      cancelled = true;
      break;
    }
    yield { frame: cloth.frames, time, progress };
    if (merge && time >= minTime - 1e-9 && speed <= rest) break;
  }
  // The last passes against the body's exact triangles (the distance field rounds off creases a little).
  // Seams still open are sewn shut once within SEW_TOL: before the passes, and again after them (the passes
  // pull the last ones together).
  const sewRest = () => {
    if (cancelled || !merge || !cloth.seams.length) return false;
    const w = weld(cloth, cloth.seams, SEW_TOL);
    if (w.seams.length === cloth.seams.length) return false;
    const m2 = w.merge;
    merge = Int32Array.from(merge, (p: number) => m2[p]!);
    cloth = rebuilt(cloth, w, merge);
    return true;
  };
  if (!cancelled) {
    const exact = bodyCollider(body);
    sewRest();
    cloth.polish(exact, settings.polishPasses);
    if (sewRest()) cloth.polish(exact, settings.polishPasses);
    cloth.clear(exact);
  }
  const M = merge ?? Int32Array.from({ length: N }, (_, i) => i);
  const positions = new Float64Array(N * 3);
  for (let o = 0; o < N; o++) for (let k = 0; k < 3; k++) positions[o * 3 + k] = cloth.x[M[o]! * 3 + k]!;
  const metrics = measureDrape(positions, fine, rest2d, restTris, triMaterial, kinds, bodyCollider(body), speed);
  metrics.weldGap = weldGap;
  return {
    fine,
    rest2d,
    tris,
    triPanel,
    placed: placement.positions,
    positions,
    merge: M,
    particles: cloth.n,
    groups: placement.groups,
    cloth: fine.panels.map((p) => clothOf(p.name)),
    frames: cloth.frames,
    simTime: cloth.frames * settings.dt,
    ms: clock() - t0,
    cancelled,
    metrics,
  };
}

/** How far a waist attachment's points may drop below where they start (m). */
export const ANCHOR_DROP = 0.05;

/** Rest points on free (unstitched) edges within 3 cm of the garment's top: its waist opening. */
export function waistAnchors(fine: Discretised, built: BuiltPattern, positions: Float64Array): number[] {
  const stitched = new Set<string>();
  for (const st of built.spec.stitches) for (const s of [st[0], st[1]]) stitched.add(`${s.panel}#${s.edge}`);
  let top = -Infinity;
  for (let i = 0; i < fine.particles; i++) top = Math.max(top, positions[i * 3 + 1]!);
  const out = new Set<number>();
  for (const p of fine.panels) {
    p.edgeSamples.forEach((samples, ei) => {
      if (stitched.has(`${p.name}#${ei}`)) return;
      for (const l of samples) {
        const g = p.offset + l;
        if (positions[g * 3 + 1]! >= top - 0.03) out.add(g);
      }
    });
  }
  return [...out].sort((a, b) => a - b);
}

/** Sewn points closer than this are welded (m). */
export const WELD_TOL = 0.001;
/** Once the seams are welded (all within WELD_TOL, or WELD_WAIT_MAX after the ramp), pairs this close are sewn
 *  shut too (m); farther pairs stay seam constraints and are tried again every REWELD_FRAMES. */
export const SEW_TOL = 0.01;
/** Seams still open after welding are tried again every this many frames. */
export const REWELD_FRAMES = 15;
/** Longest wait after the seam ramp for the seams to close (s). */
export const WELD_WAIT_MAX = 0.5;

function maxSeamGap(x: Float64Array, seams: Uint32Array): number {
  let g = 0;
  for (let s = 0; s < seams.length / 2; s++) {
    const a = seams[s * 2]!;
    const b = seams[s * 2 + 1]!;
    const dx = x[a * 3]! - x[b * 3]!;
    const dy = x[a * 3 + 1]! - x[b * 3 + 1]!;
    const dz = x[a * 3 + 2]! - x[b * 3 + 2]!;
    g = Math.max(g, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(g);
}

/**
 * Weld sewn points: pairs closer than `tol` join (transitively) into one particle at their mass-weighted
 * mean, numbered by their lowest point. Pairs still apart stay seam constraints.
 */
export function weld(cloth: Cloth, seams: Uint32Array, tol: number): { merge: Int32Array; positions: Float64Array; velocities: Float64Array; seams: Uint32Array } {
  const N = cloth.n;
  const parent = Int32Array.from({ length: N }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const x = cloth.x;
  const t2 = tol * tol;
  for (let s = 0; s < seams.length / 2; s++) {
    const a = seams[s * 2]!;
    const b = seams[s * 2 + 1]!;
    const dx = x[a * 3]! - x[b * 3]!;
    const dy = x[a * 3 + 1]! - x[b * 3 + 1]!;
    const dz = x[a * 3 + 2]! - x[b * 3 + 2]!;
    if (dx * dx + dy * dy + dz * dz > t2) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const merge = new Int32Array(N);
  const id = new Int32Array(N).fill(-1);
  let count = 0;
  for (let i = 0; i < N; i++) {
    const r = find(i);
    if (id[r] === -1) id[r] = count++;
    merge[i] = id[r]!;
  }
  const positions = new Float64Array(count * 3);
  const velocities = new Float64Array(count * 3);
  const mass = new Float64Array(count);
  for (let i = 0; i < N; i++) {
    const p = merge[i]!;
    const m = cloth.mass[i]!;
    mass[p] = mass[p]! + m;
    for (let k = 0; k < 3; k++) {
      positions[p * 3 + k] = positions[p * 3 + k]! + x[i * 3 + k]! * m;
      velocities[p * 3 + k] = velocities[p * 3 + k]! + cloth.v[i * 3 + k]! * m;
    }
  }
  for (let p = 0; p < count; p++) {
    for (let k = 0; k < 3; k++) {
      positions[p * 3 + k] = positions[p * 3 + k]! / mass[p]!;
      velocities[p * 3 + k] = velocities[p * 3 + k]! / mass[p]!;
    }
  }
  const left: number[] = [];
  const seen = new Set<number>();
  for (let s = 0; s < seams.length / 2; s++) {
    const a = merge[seams[s * 2]!]!;
    const b = merge[seams[s * 2 + 1]!]!;
    if (a === b) continue;
    const key = Math.min(a, b) * count + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    left.push(Math.min(a, b), Math.max(a, b));
  }
  return { merge, positions, velocities, seams: Uint32Array.from(left) };
}

export function measureDrape(x: Float64Array, fine: Discretised, rest2d: Float64Array, tris: Uint32Array, triMaterial: Uint8Array, kinds: ClothKind[], collider: MeshCollider, maxSpeed: number): DrapeMetrics {
  let seamGap = 0;
  for (let s = 0; s < fine.seams.length / 2; s++) {
    const a = fine.seams[s * 2]!;
    const b = fine.seams[s * 2 + 1]!;
    const dx = x[a * 3]! - x[b * 3]!;
    const dy = x[a * 3 + 1]! - x[b * 3 + 1]!;
    const dz = x[a * 3 + 2]! - x[b * 3 + 2]!;
    seamGap = Math.max(seamGap, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  let penetration = 0;
  let penetrationAt = -1;
  const out = new Float64Array(6);
  for (let i = 0; i < fine.particles; i++) {
    if (!collider.closest(x[i * 3]!, x[i * 3 + 1]!, x[i * 3 + 2]!, 0.05, out)) continue;
    const d = (x[i * 3]! - out[0]!) * out[3]! + (x[i * 3 + 1]! - out[1]!) * out[4]! + (x[i * 3 + 2]! - out[2]!) * out[5]!;
    if (-d > penetration) {
      penetration = -d;
      penetrationAt = i;
    }
  }
  // Woven stretch along the threads, area-weighted (shear is not stretch: woven cloth shears on the bias).
  const strains: [number, number][] = [];
  let totalArea = 0;
  let mean = 0;
  for (let t = 0; t < tris.length / 3; t++) {
    if (!CLOTH_PRESETS[kinds[triMaterial[t]!]!].woven) continue;
    const s = threadStretch(x, rest2d, tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!);
    const st = Math.max(0, s.weft, s.warp);
    strains.push([st, s.area]);
    totalArea += s.area;
    mean += st * s.area;
  }
  strains.sort((p, q) => p[0] - q[0]);
  let acc = 0;
  let p95 = 0;
  for (const [st, ar] of strains) {
    acc += ar;
    p95 = st;
    if (acc >= totalArea * 0.95) break;
  }
  return {
    seamGap,
    penetration,
    wovenStrainMean: totalArea > 0 ? mean / totalArea : 0,
    wovenStrainP95: p95,
    wovenStrainMax: strains.length ? strains[strains.length - 1]![0] : 0,
    maxSpeed,
    weldGap: 0,
    penetrationAt,
  };
}

/**
 * The instant "placed panels" preview of the Designer's 3D view (F32): every panel triangulated (coarsely)
 * and placed around the body as the drape starts from, without simulating.
 */
export function placedPanels(built: BuiltPattern, body: ShellBody, h = 3): { positions: Float64Array; tris: Uint32Array; triPanel: Uint16Array; panels: string[] } {
  const skip = new Set(built.attachments.map((a) => a.panel));
  const fine = discretise(built.spec, h, skip);
  const placement = placePanels(
    body,
    fine.panels.map((mesh) => ({ spec: built.spec.panels[mesh.name]!, mesh })),
    built.spec.stitches,
  );
  const T = fine.panels.reduce((s, p) => s + p.tris.length / 3, 0);
  const tris = new Uint32Array(T * 3);
  const triPanel = new Uint16Array(T);
  let t = 0;
  fine.panels.forEach((p, pi) => {
    for (let k = 0; k < p.tris.length / 3; k++) {
      for (let c = 0; c < 3; c++) tris[t * 3 + c] = p.offset + p.tris[k * 3 + c]!;
      triPanel[t++] = pi;
    }
  });
  return { positions: placement.positions, tris, triPanel, panels: fine.panels.map((p) => p.name) };
}
