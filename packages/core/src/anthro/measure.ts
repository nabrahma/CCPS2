/**
 * Anthropometry (PRD Part 3, F24): every measurement of a body shape, taken
 * from the hm08 skin surface in its rest pose. See `definitions.ts` for what
 * each measurement is. Deterministic: float64, fixed work, `dmath` only.
 */
import type { BaseMesh } from '../mesh/basemesh';
import { atan2, degrees } from '../math/dmath';
import { BODY_DENSITY, MEASURE_IDS, type MeasureId, type Measurements } from './definitions';
import { convexHull, cutLoop, enclosedVolume, fitPlane, GeodesicPath, hullBackSpan, hullPerimeter, type CutPlane, type Positions } from './geometry';
import type { LandmarkFile, PairName, RingName } from './landmarks';
import { BodyTopology } from './topology';

/** How far from a ring's own vertices (in graph steps) the cut may run. */
const TORSO_HOPS = 10;
const LIMB_HOPS = 5;
const HORIZONTAL: ReadonlySet<RingName> = new Set(['bust', 'underbust', 'hips']);
const TORSO: ReadonlySet<RingName> = new Set(['neck', 'bust', 'underbust', 'waist', 'hips', 'head']);

interface Ring {
  name: RingName;
  vertices: Uint32Array;
  /** Triangles the cut may pass through, and the vertices they use. */
  triangles: Uint32Array;
  reach: Uint32Array;
}

export interface RingCut {
  plane: CutPlane;
  /** The cut as a closed polyline (xyz triples), or null if the plane does not cut a closed loop there. */
  loop: Float64Array | null;
  /** Indices into `loop` of its convex hull. */
  hull: number[];
  /** Hull perimeter in metres (NaN without a loop). */
  perimeter: number;
  /** True when the local cut failed and the whole body had to be cut. */
  fallback: boolean;
}

const cache = new WeakMap<BaseMesh, Anthropometer>();

/** Which measurements need which rings, points and paths (for the solver's "vertices of interest"). */
const NEEDS_VOLUME: ReadonlySet<MeasureId> = new Set(['mass', 'bmi', 'volume']);

export class Anthropometer {
  readonly topology: BodyTopology;
  private readonly rings = new Map<string, Ring>();
  private readonly top: Uint32Array;
  private readonly bottom: Uint32Array;
  private readonly allTriangles: Uint32Array;
  private readonly paths = new Map<string, GeodesicPath>();
  private readonly rest: Float32Array;
  /** Rings that needed the whole-body cut in the last `measure` call (0 on any plausible body). */
  lastFallbacks = 0;

  static of(base: BaseMesh, landmarks: LandmarkFile): Anthropometer {
    let a = cache.get(base);
    if (!a) {
      a = new Anthropometer(base, landmarks);
      cache.set(base, a);
    }
    return a;
  }

  constructor(
    base: BaseMesh,
    readonly landmarks: LandmarkFile,
  ) {
    const topo = BodyTopology.of(base);
    this.topology = topo;
    this.rest = base.positions;
    for (const [name, def] of Object.entries(landmarks.rings) as [RingName, LandmarkFile['rings'][RingName]][]) {
      const hops = TORSO.has(name) ? TORSO_HOPS : LIMB_HOPS;
      const add = (key: string, verts: number[]) => {
        const reach = topo.verticesNear(verts, hops);
        this.rings.set(key, { name, vertices: Uint32Array.from(verts), triangles: topo.trianglesTouching(reach), reach: topo.verticesNear(verts, hops + 1) });
      };
      add(`${name}:l`, def.vertices);
      if (def.mirror) add(`${name}:r`, def.mirror);
    }
    // Height: the extremes are always on top of the head and under the feet.
    let lo = Infinity;
    let hi = -Infinity;
    const n = topo.vertexCount;
    for (let v = 0; v < n; v++) {
      const y = this.rest[v * 3 + 1]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const top: number[] = [];
    const bottom: number[] = [];
    for (let v = 0; v < n; v++) {
      const y = this.rest[v * 3 + 1]!;
      if (y >= hi - 0.09) top.push(v);
      if (y <= lo + 0.06) bottom.push(v);
    }
    this.top = Uint32Array.from(top);
    this.bottom = Uint32Array.from(bottom);
    const all = new Uint32Array(topo.tris.length / 3);
    for (let i = 0; i < all.length; i++) all[i] = i;
    this.allTriangles = all;
  }

  private path(a: number, b: number): GeodesicPath {
    const key = `${a}:${b}`;
    let p = this.paths.get(key);
    if (!p) {
      p = new GeodesicPath(this.topology, this.rest, a, b);
      this.paths.set(key, p);
    }
    return p;
  }

  private pathsFor(id: MeasureId): GeodesicPath[] {
    const lm = this.landmarks;
    if (id === 'waistLine') return [this.path(lm.points.nape, lm.points.waistBack)];
    if (id === 'neckWidth') return [this.path(lm.pairs.neckSide.l, lm.points.nape), this.path(lm.pairs.neckSide.r, lm.points.nape)];
    if (id === 'bustLine' || id === 'waistOverBust') return [this.path(lm.pairs.neckSide.l, lm.pairs.bustPoint.l), this.path(lm.pairs.neckSide.r, lm.pairs.bustPoint.r)];
    return [];
  }

  /**
   * The body vertices the given measurements read, ascending, or null when
   * they need every vertex (weight and volume do). The solver evaluates only
   * these.
   */
  vertexSet(ids: readonly MeasureId[]): Uint32Array | null {
    if (ids.some((id) => NEEDS_VOLUME.has(id))) return null;
    const seen = new Uint8Array(this.topology.vertexCount);
    const mark = (list: ArrayLike<number>) => {
      for (let i = 0; i < list.length; i++) seen[list[i]!] = 1;
    };
    const ring = (name: RingName) => {
      mark(this.rings.get(`${name}:l`)!.reach);
      const r = this.rings.get(`${name}:r`);
      if (r) mark(r.reach);
    };
    const lm = this.landmarks;
    // Every landmark point is cheap to include.
    mark(Object.values(lm.points));
    for (const p of Object.values(lm.pairs)) mark([p.l, p.r]);
    for (const id of ids) {
      for (const p of this.pathsFor(id)) mark(p.vertices);
      switch (id) {
        case 'height':
        case 'inseam':
        case 'headLength':
          mark(this.top);
          mark(this.bottom);
          break;
        case 'neck':
        case 'bust':
        case 'underbust':
        case 'waist':
        case 'hips':
        case 'thigh':
        case 'knee':
        case 'calf':
        case 'ankle':
        case 'upperArm':
        case 'wrist':
        case 'head':
          ring(id);
          break;
        case 'backWidth':
          ring('bust');
          break;
        case 'waistBackWidth':
          ring('waist');
          break;
        case 'hipBackWidth':
          ring('hips');
          break;
        case 'hipLine':
          ring('waist');
          break;
        case 'hipInclination':
          ring('waist');
          ring('hips');
          break;
        default:
          break;
      }
    }
    const out: number[] = [];
    for (let v = 0; v < seen.length; v++) if (seen[v]) out.push(v);
    return Uint32Array.from(out);
  }

  /** The cut of one ring on a body shape (side 'r' only exists for limb rings). */
  cutRing(pos: Positions, name: RingName, side: 'l' | 'r' = 'l'): RingCut {
    const ring = this.rings.get(`${name}:${side}`);
    if (!ring) throw new Error(`anthro: no ring ${name}:${side}`);
    let plane = fitPlane(pos, ring.vertices);
    if (HORIZONTAL.has(name)) {
      let y = plane.cy;
      if (name === 'bust') y = this.pairMean(pos, 'bustPoint', 1);
      else if (name === 'hips') y = this.pairMean(pos, 'seatPoint', 1);
      plane = { cx: plane.cx, cy: y, cz: plane.cz, nx: 0, ny: 1, nz: 0 };
    }
    let loop = cutLoop(pos, this.topology, ring.triangles, plane, plane.cx, plane.cy, plane.cz);
    let fallback = false;
    if (!loop) {
      fallback = true;
      loop = cutLoop(pos, this.topology, this.allTriangles, plane, plane.cx, plane.cy, plane.cz);
    }
    if (!loop) return { plane, loop: null, hull: [], perimeter: NaN, fallback };
    const hull = convexHull(loop, plane);
    return { plane, loop, hull, perimeter: hullPerimeter(loop, hull), fallback };
  }

  private pairMean(pos: Positions, name: PairName, axis: number): number {
    const p = this.landmarks.pairs[name];
    return (pos[p.l * 3 + axis]! + pos[p.r * 3 + axis]!) / 2;
  }

  /**
   * Measure a body. `pos` holds hm08 positions in metres (at least the body
   * vertices; only `vertexSet(ids)` is read). With `ids`, only those are
   * computed and the rest are NaN.
   */
  measure(pos: Positions, ids: readonly MeasureId[] = MEASURE_IDS): Measurements {
    const want = new Set<MeasureId>(ids);
    const out = {} as Measurements;
    for (const id of MEASURE_IDS) out[id] = NaN;
    const lm = this.landmarks;
    this.lastFallbacks = 0;
    const cuts = new Map<string, RingCut>();
    const cut = (name: RingName, side: 'l' | 'r' = 'l'): RingCut => {
      const key = `${name}:${side}`;
      let c = cuts.get(key);
      if (!c) {
        c = this.cutRing(pos, name, side);
        if (c.fallback) this.lastFallbacks++;
        cuts.set(key, c);
      }
      return c;
    };
    const tape = (name: RingName): number => {
      const l = cut(name).perimeter;
      const r = this.rings.has(`${name}:r`) ? cut(name, 'r').perimeter : l;
      return ((l + r) / 2) * 100;
    };
    const px = (v: number) => pos[v * 3]!;
    const py = (v: number) => pos[v * 3 + 1]!;
    const pz = (v: number) => pos[v * 3 + 2]!;
    const dist = (a: number, b: number) => Math.sqrt((px(a) - px(b)) * (px(a) - px(b)) + (py(a) - py(b)) * (py(a) - py(b)) + (pz(a) - pz(b)) * (pz(a) - pz(b)));
    let topY = NaN;
    let bottomY = NaN;
    const extent = () => {
      if (topY === topY) return;
      topY = -Infinity;
      bottomY = Infinity;
      for (let i = 0; i < this.top.length; i++) topY = Math.max(topY, py(this.top[i]!));
      for (let i = 0; i < this.bottom.length; i++) bottomY = Math.min(bottomY, py(this.bottom[i]!));
    };
    const heightM = () => {
      extent();
      return topY - bottomY;
    };
    const bustLevel = () => this.pairMean(pos, 'bustPoint', 1);
    const hipLevel = () => this.pairMean(pos, 'seatPoint', 1);
    const waistLevel = () => cut('waist').plane.cy;
    const backSpan = (name: RingName) => {
      const c = cut(name);
      return c.loop ? hullBackSpan(c.loop, c.hull) : { back: NaN, halfWidth: NaN };
    };
    const sides = (fn: (side: 'l' | 'r') => number) => (fn('l') + fn('r')) / 2;
    const bustGeo = (side: 'l' | 'r') => this.path(lm.pairs.neckSide[side], lm.pairs.bustPoint[side]).length(pos);

    for (const id of want) {
      switch (id) {
        case 'height':
          out.height = heightM() * 100;
          break;
        case 'volume':
        case 'mass':
        case 'bmi': {
          const volume = enclosedVolume(pos, this.topology);
          const mass = volume * BODY_DENSITY;
          out.volume = volume * 1000;
          out.mass = mass;
          out.bmi = mass / (heightM() * heightM());
          break;
        }
        case 'neck':
        case 'bust':
        case 'underbust':
        case 'waist':
        case 'hips':
        case 'thigh':
        case 'knee':
        case 'calf':
        case 'ankle':
        case 'upperArm':
        case 'wrist':
        case 'head':
          out[id] = tape(id);
          break;
        case 'armLength':
          out.armLength = sides((s) => dist(lm.pairs.shoulderTip[s], lm.pairs.elbow[s]) + dist(lm.pairs.elbow[s], lm.pairs.wrist[s])) * 100;
          break;
        case 'inseam':
          extent();
          out.inseam = (py(lm.points.crotch) - bottomY) * 100;
          break;
        case 'waistLine':
          out.waistLine = this.path(lm.points.nape, lm.points.waistBack).length(pos) * 100;
          break;
        case 'bustLine':
          out.bustLine = sides(bustGeo) * 100;
          break;
        case 'waistOverBust':
          out.waistOverBust = sides((s) => bustGeo(s) + dist(lm.pairs.bustPoint[s], lm.pairs.waistFrontUnderBust[s])) * 100;
          break;
        case 'vertBustLine':
          out.vertBustLine = (py(lm.points.nape) - bustLevel()) * 100;
          break;
        case 'hipLine':
          out.hipLine = (waistLevel() - hipLevel()) * 100;
          break;
        case 'crotchHipDiff':
          out.crotchHipDiff = (hipLevel() - py(lm.points.crotch)) * 100;
          break;
        case 'armscyeDepth':
          out.armscyeDepth = sides((s) => py(lm.pairs.shoulderTip[s]) - py(lm.pairs.armpit[s])) * 100;
          break;
        case 'headLength':
          extent();
          out.headLength = (topY - py(lm.points.nape)) * 100;
          break;
        case 'shoulderWidth':
          out.shoulderWidth = dist(lm.pairs.shoulderTip.l, lm.pairs.shoulderTip.r) * 100;
          break;
        case 'backWidth':
          out.backWidth = backSpan('bust').back * 100;
          break;
        case 'waistBackWidth':
          out.waistBackWidth = backSpan('waist').back * 100;
          break;
        case 'hipBackWidth':
          out.hipBackWidth = backSpan('hips').back * 100;
          break;
        case 'neckWidth':
          out.neckWidth = (this.path(lm.pairs.neckSide.l, lm.points.nape).length(pos) + this.path(lm.pairs.neckSide.r, lm.points.nape).length(pos)) * 100;
          break;
        case 'bustPoints':
          out.bustPoints = dist(lm.pairs.bustPoint.l, lm.pairs.bustPoint.r) * 100;
          break;
        case 'seatPoints':
          out.seatPoints = dist(lm.pairs.seatPoint.l, lm.pairs.seatPoint.r) * 100;
          break;
        case 'shoulderInclination':
          out.shoulderInclination = sides((s) => degrees(atan2(py(lm.pairs.neckSide[s]) - py(lm.pairs.shoulderTip[s]), Math.abs(px(lm.pairs.shoulderTip[s]) - px(lm.pairs.neckSide[s])))));
          break;
        case 'hipInclination':
          out.hipInclination = degrees(atan2(backSpan('hips').halfWidth - backSpan('waist').halfWidth, waistLevel() - hipLevel()));
          break;
        case 'armPoseAngle':
          out.armPoseAngle = sides((s) => degrees(atan2(py(lm.pairs.shoulderTip[s]) - py(lm.pairs.elbow[s]), Math.abs(px(lm.pairs.elbow[s]) - px(lm.pairs.shoulderTip[s])))));
          break;
      }
    }
    return out;
  }
}
