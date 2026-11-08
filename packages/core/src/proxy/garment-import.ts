/**
 * Custom garments (PRD F4 "custom", M10). The user models a garment around the
 * exported base body; importing it binds every vertex to the nearest body
 * triangle, MakeClothes-style:
 *
 *   position = w1*r1 + w2*r2 + w3*r3 + S * offset
 *
 * The weights are the barycentric coordinates of the closest point and the
 * offset is what is left (the garment's gap along the surface normal). The
 * result is an ordinary proxy asset, so fitting, weight transfer, collision,
 * hidden faces, expressions and export treat it like a CC0 garment.
 *
 * Every garment is bound to one fixed reference body, the default character.
 * The base body OBJ is always that body, whatever is on screen, so a garment
 * modelled once imports the same from any character.
 */
import type { CoreAssets } from '../assets';
import { defaultCharacter, newId } from '../character/doc';
import { CharacterEngine } from '../character/engine';
import { Container, type ContainerMeta } from '../io/container';
import { ContainerBuilder } from '../io/pack';
import type { BaseMesh } from '../mesh/basemesh';
import { TriangleBVH } from '../mesh/bvh';
import { computeQuadNormals } from '../mesh/normals';
import { buildRenderTopology, gather3 } from '../scene/render-mesh';
import type { SparseWeights } from '../skeleton/weights';
import { computeCoveredVertices } from './coverage';
import { decimateProxy } from './decimate';
import { ProxyAsset, type ProxyMeta } from './proxy';

/** A garment mesh as read from a file (see app/backend/garments). */
export interface RawGarmentMesh {
  positions: Float32Array;
  uvs: Float32Array;
  /** Four per face; a triangle repeats its last vertex. */
  faceVerts: Uint32Array;
  faceUvs: Uint32Array;
  hasUvs: boolean;
}

export type ImportSlot = 'top' | 'bottom' | 'full' | 'outer' | 'shoes' | 'hat' | 'gloves' | 'accessory';

/** A problem with the user's file, worded for the user. */
export class GarmentImportError extends Error {}

export interface ReferenceBody {
  positions: Float32Array;
  normals: Float32Array;
  /** Quads of the visible body (no helper geometry). */
  quads: Uint32Array;
  triangles: Uint32Array;
  bvh: TriangleBVH;
  /** GameEngine skin weights of the base mesh. */
  weights: SparseWeights;
}

export interface GarmentImportReport {
  originalTriangles: number;
  triangles: number;
  vertices: number;
  /** Base-mesh vertices hidden under the garment. */
  coveredBodyVertices: number;
  /** Median distance from the garment to the body, in metres. */
  medianGap: number;
  /** What was done to the file's scale or axes ('' when nothing). */
  correction: string;
  warnings: string[];
}

export interface ImportedGarment {
  /** The proxy document, ready to be written as `<file>.json`. */
  meta: ProxyMeta;
  /** The binary file named by `meta.binary`. */
  bin: Uint8Array<ArrayBuffer>;
  proxy: ProxyAsset;
  report: GarmentImportReport;
}

/** Above this median distance from the body, a mesh was not modelled around it. */
const MAX_MEDIAN_GAP = 0.12;
const WELD_TOLERANCE = 1e-5;
/** A scale reference pair must span at least this much to be a stable measure. */
const MIN_SCALE_SPAN = 0.05;
const GAP_SAMPLES = 800;

/** Draw order per slot: outer layers last. MakeHuman's own garments are mostly 50. */
const SLOT_Z_DEPTH: Record<ImportSlot, number> = { bottom: 45, top: 50, full: 50, shoes: 50, gloves: 50, hat: 50, accessory: 55, outer: 60 };

type Vec3 = [number, number, number];

/** A garment bigger than this in any direction cannot be in metres. */
const MAX_GARMENT_SIZE = 2.5;
const MIN_GARMENT_SIZE = 0.02;
const Z_UP_MARGIN = 0.7;
/** Distance from the skin, in metres, over which cloth goes from tight (exact weights) to loose (smoothed). */
const LOOSE_FROM = 0.015;
const LOOSE_FULLY = 0.05;
const SMOOTH_PASSES = 16;
const MIN_WEIGHT = 1e-4;
const UNITS: { scale: number; label: string }[] = [
  { scale: 0.1, label: 'decimetres' },
  { scale: 0.01, label: 'centimetres' },
  { scale: 0.001, label: 'millimetres' },
];

/** The body every garment is bound to and modelled around. */
export function referenceBody(assets: CoreAssets): ReferenceBody {
  const engine = new CharacterEngine(assets, defaultCharacter());
  return surfaceOf(assets.base, engine.positions.slice(), assets.weights.sparse);
}

function surfaceOf(base: BaseMesh, positions: Float32Array, weights: SparseWeights): ReferenceBody {
  const faces = base.facesWhere((g) => g === 'body');
  const quads = new Uint32Array(faces.length * 4);
  const tris: number[] = [];
  faces.forEach((f, i) => {
    const q = base.faceVerts.subarray(f * 4, f * 4 + 4);
    quads.set(q, i * 4);
    tris.push(q[0]!, q[1]!, q[2]!);
    if (q[3] !== q[2]) tris.push(q[0]!, q[2]!, q[3]!);
  });
  const triangles = Uint32Array.from(tris);
  return { positions, normals: computeQuadNormals(positions, base.faceVerts, base.vertexCount), quads, triangles, bvh: new TriangleBVH(positions, triangles), weights };
}

/** The reference body as Wavefront OBJ: metres, Y up, facing +Z (PRD F4: "exports the base body"). */
export function baseBodyObj(assets: CoreAssets): string {
  const body = referenceBody(assets);
  const base = assets.base;
  const faces = base.facesWhere((g) => g === 'body');
  const lines = [
    '# PS2CC base body: model garments around this mesh, then import them in the Wardrobe.',
    '# Metres, Y up, facing +Z. Do not move, scale or rotate it.',
    'o ps2cc_base_body',
  ];
  const vertices = body.quads.reduce((max, v) => Math.max(max, v + 1), 0);
  for (let v = 0; v < vertices; v++) lines.push(`v ${body.positions[v * 3]!.toFixed(6)} ${body.positions[v * 3 + 1]!.toFixed(6)} ${body.positions[v * 3 + 2]!.toFixed(6)}`);
  for (let t = 0; t < base.uvs.length / 2; t++) lines.push(`vt ${base.uvs[t * 2]!.toFixed(6)} ${base.uvs[t * 2 + 1]!.toFixed(6)}`);
  for (const f of faces) {
    const corner = (k: number) => `${base.faceVerts[f * 4 + k]! + 1}/${base.faceUvs[f * 4 + k]! + 1}`;
    lines.push(base.faceVerts[f * 4 + 3] === base.faceVerts[f * 4 + 2] ? `f ${corner(0)} ${corner(1)} ${corner(2)}` : `f ${corner(0)} ${corner(1)} ${corner(2)} ${corner(3)}`);
  }
  return lines.join('\n') + '\n';
}

/** Median distance from a sample of the vertices to the body. */
function medianGap(positions: ArrayLike<number>, body: ReferenceBody): number {
  const n = positions.length / 3;
  const step = Math.max(1, Math.floor(n / GAP_SAMPLES));
  const gaps: number[] = [];
  const p: Vec3 = [0, 0, 0];
  for (let v = 0; v < n; v += step) {
    p[0] = positions[v * 3]!;
    p[1] = positions[v * 3 + 1]!;
    p[2] = positions[v * 3 + 2]!;
    const hit = body.bvh.closestPoint(p);
    if (hit) gaps.push(Math.hypot(p[0] - hit.point[0], p[1] - hit.point[1], p[2] - hit.point[2]));
  }
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] ?? Infinity;
}

/** The largest side of the bounding box. */
function meshSize(positions: ArrayLike<number>): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const k = i % 3;
    lo[k] = Math.min(lo[k]!, positions[i]!);
    hi[k] = Math.max(hi[k]!, positions[i]!);
  }
  return Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

/**
 * Use the file's coordinates if they sit on the body; otherwise find the unit
 * and up axis that do. Other units are considered only when the mesh is too big
 * to be in metres: a shrunk mesh ends up inside the body, close to its surface,
 * so distance alone would accept any wrong scale. The body is centred on the
 * origin, so a loose garment on its side can also look close to it: Z-up wins
 * only when it is clearly closer than Y-up.
 */
function alignToBody(input: Float32Array, body: ReferenceBody): { positions: Float32Array; gap: number; correction: string } {
  const size = meshSize(input);
  const units = size > MAX_GARMENT_SIZE ? UNITS.filter((u) => size * u.scale <= MAX_GARMENT_SIZE && size * u.scale >= MIN_GARMENT_SIZE) : [{ scale: 1, label: '' }];
  for (const { scale, label } of units) {
    let best: { positions: Float32Array; gap: number; correction: string } | null = null;
    for (const zUp of [false, true]) {
      const out = new Float32Array(input.length);
      for (let i = 0; i < input.length; i += 3) {
        out[i] = input[i]! * scale;
        out[i + 1] = (zUp ? input[i + 2]! : input[i + 1]!) * scale;
        out[i + 2] = (zUp ? -input[i + 1]! : input[i + 2]!) * scale;
      }
      const g = medianGap(out, body);
      if (g > MAX_MEDIAN_GAP || (best && g >= best.gap * Z_UP_MARGIN)) continue;
      best = { positions: out, gap: g, correction: [label && `${label} converted to metres`, zUp && 'Z-up converted to Y-up'].filter(Boolean).join(', ') };
    }
    if (best) return best;
  }
  const gap = medianGap(input, body);
  throw new GarmentImportError(
    `This mesh does not sit on the PS2CC base body (typically ${Math.round(gap * 100)} cm away). Model it around the exported base body, without moving or scaling that body.`,
  );
}

/** Merge coincident vertices (GLB splits them at seams) and drop faces that collapse. */
function weld(raw: RawGarmentMesh, positions: Float32Array): { positions: Float32Array; faceVerts: Uint32Array; faceUvs: Uint32Array } {
  const ids = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const out: number[] = [];
  const q = 1 / WELD_TOLERANCE;
  for (let v = 0; v < remap.length; v++) {
    const key = `${Math.round(positions[v * 3]! * q)},${Math.round(positions[v * 3 + 1]! * q)},${Math.round(positions[v * 3 + 2]! * q)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = out.length / 3;
      ids.set(key, id);
      out.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
    }
    remap[v] = id;
  }
  const faceVerts: number[] = [];
  const faceUvs: number[] = [];
  for (let f = 0; f < raw.faceVerts.length; f += 4) {
    const verts: number[] = [];
    const uvs: number[] = [];
    for (let k = 0; k < 4; k++) {
      const v = remap[raw.faceVerts[f + k]!]!;
      if (verts.includes(v)) continue;
      verts.push(v);
      uvs.push(raw.faceUvs[f + k]!);
    }
    if (verts.length < 3) continue;
    faceVerts.push(verts[0]!, verts[1]!, verts[2]!, verts[3] ?? verts[2]!);
    faceUvs.push(uvs[0]!, uvs[1]!, uvs[2]!, uvs[3] ?? uvs[2]!);
  }
  return { positions: Float32Array.from(out), faceVerts: Uint32Array.from(faceVerts), faceUvs: Uint32Array.from(faceUvs) };
}

/** An in-memory proxy with no binding yet, so a garment can go through the regular decimator. */
function unboundProxy(id: string, positions: Float32Array, uvs: Float32Array, faceVerts: Uint32Array, faceUvs: Uint32Array): ProxyAsset {
  const b = new ContainerBuilder();
  const n = positions.length / 3;
  b.add('restPositions', positions, 'f32');
  b.add('uvs', uvs, 'f32');
  b.add('faceVerts', faceVerts, 'u32');
  b.add('faceUvs', faceUvs, 'u32');
  b.add('refVerts', new Uint32Array(n * 3), 'u32');
  b.add('refWeights', new Float32Array(n * 3), 'f32');
  b.add('refOffsets', new Float32Array(n * 3), 'f32');
  const { bin, table } = b.finish('unbound.bin');
  const meta = { ...table, format: 'ps2cc.proxy/1', id, category: 'clothes', name: id, uuid: id, tags: [], zDepth: 50, vertexCount: n, faceCount: faceVerts.length / 4, scale: null, material: null } as ProxyMeta;
  return new ProxyAsset(new Container<ProxyMeta>(meta, bin.buffer));
}

interface Binding {
  refVerts: Uint32Array;
  refWeights: Float32Array;
  refOffsets: Float32Array;
}

/** Bind points to their closest body triangles. Exact on the reference body. */
function bindToBody(points: Float32Array, body: ReferenceBody): Binding {
  const n = points.length / 3;
  const refVerts = new Uint32Array(n * 3);
  const refWeights = new Float32Array(n * 3);
  const refOffsets = new Float32Array(n * 3);
  const P = body.positions;
  const I = body.triangles;
  const p: Vec3 = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    p[0] = points[v * 3]!;
    p[1] = points[v * 3 + 1]!;
    p[2] = points[v * 3 + 2]!;
    const hit = body.bvh.closestPoint(p);
    if (!hit) throw new Error('garment binding: empty body surface');
    const a = I[hit.triangle * 3]!;
    const b = I[hit.triangle * 3 + 1]!;
    const c = I[hit.triangle * 3 + 2]!;
    refVerts.set([a, b, c], v * 3);
    refWeights.set(hit.bary, v * 3);
    // From the stored (32-bit) weights, so that fitting the reference body gives the point back.
    const [wa, wb, wc] = [refWeights[v * 3]!, refWeights[v * 3 + 1]!, refWeights[v * 3 + 2]!];
    for (let k = 0; k < 3; k++) refOffsets[v * 3 + k] = p[k]! - (wa * P[a * 3 + k]! + wb * P[b * 3 + k]! + wc * P[c * 3 + k]!);
  }
  return { refVerts, refWeights, refOffsets };
}

/**
 * MHCLO x/y/z scale references: per axis, the two bound body vertices furthest
 * apart, so offsets grow with the part of the body the garment covers. The
 * denominators make the scale exactly 1 on the reference body. A garment on a
 * tiny area (a badge) would measure noise, so there the whole body is the measure.
 */
function scaleReferences(refVerts: Uint32Array, body: ReferenceBody): [number, number, number][] {
  const extremes = (verts: Iterable<number>, axis: number): [number, number] => {
    let lo = -1;
    let hi = -1;
    for (const v of verts) {
      if (lo < 0 || body.positions[v * 3 + axis]! < body.positions[lo * 3 + axis]!) lo = v;
      if (hi < 0 || body.positions[v * 3 + axis]! > body.positions[hi * 3 + axis]!) hi = v;
    }
    return [lo, hi];
  };
  const span = ([lo, hi]: [number, number], axis: number) => Math.abs(body.positions[lo * 3 + axis]! - body.positions[hi * 3 + axis]!);
  const bound = new Set(refVerts);
  return [0, 1, 2].map((axis) => {
    let pair = extremes(bound, axis);
    if (span(pair, axis) < MIN_SCALE_SPAN) pair = extremes(new Set(body.quads), axis);
    return [pair[0], pair[1], span(pair, axis)] as [number, number, number];
  });
}

/**
 * Skin weights: the body's, through the binding (PRD: "transfer weights").
 * Cloth that hangs away from the body (a skirt between the legs) would snap
 * from one leg's weights to the other's and tear when the legs part, so weights
 * are smoothed over the garment's own surface there. Cloth within LOOSE_FROM of
 * the skin keeps the exact transferred weights and anchors the smoothing.
 */
function skinWeights(binding: Binding, triangles: ArrayLike<number>, body: ReferenceBody): SparseWeights {
  const n = binding.refVerts.length / 3;
  const neighbours = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      neighbours[triangles[t + k]!]!.add(triangles[t + ((k + 1) % 3)]!);
      neighbours[triangles[t + k]!]!.add(triangles[t + ((k + 2) % 3)]!);
    }
  }
  let current: Map<number, number>[] = [];
  const looseness = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const w = new Map<number, number>();
    for (let k = 0; k < 3; k++) {
      for (const [bone, x] of body.weights[binding.refVerts[v * 3 + k]!] ?? []) w.set(bone, (w.get(bone) ?? 0) + binding.refWeights[v * 3 + k]! * x);
    }
    current.push(w);
    const gap = Math.hypot(binding.refOffsets[v * 3]!, binding.refOffsets[v * 3 + 1]!, binding.refOffsets[v * 3 + 2]!);
    looseness[v] = Math.min(1, Math.max(0, (gap - LOOSE_FROM) / (LOOSE_FULLY - LOOSE_FROM)));
  }
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    current = current.map((own, v) => {
      const a = looseness[v]!;
      const around = neighbours[v]!;
      if (a === 0 || around.size === 0) return own;
      const mixed = new Map<number, number>();
      for (const [bone, x] of own) mixed.set(bone, (1 - a) * x);
      for (const u of around) for (const [bone, x] of current[u]!) mixed.set(bone, (mixed.get(bone) ?? 0) + (a * x) / around.size);
      return mixed;
    });
  }
  return current.map((w) => {
    const kept = [...w.entries()].filter(([, x]) => x > MIN_WEIGHT).sort((a, b) => a[0] - b[0]);
    const total = kept.reduce((s, [, x]) => s + x, 0);
    return kept.map(([bone, x]) => [bone, x / total] as [number, number]);
  });
}

function fileStem(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'garment';
}

/**
 * Turn a mesh read from a file into a garment asset: check it sits on the body,
 * weld, decimate to the slot's budget, bind, and compute the hidden body faces.
 */
export async function importGarment(raw: RawGarmentMesh, options: { name: string; slot: ImportSlot; body: ReferenceBody }): Promise<ImportedGarment> {
  const { name, slot, body } = options;
  if (raw.faceVerts.length === 0 || raw.positions.length === 0) throw new GarmentImportError('This file has no mesh faces.');
  const aligned = alignToBody(raw.positions, body);
  const welded = weld(raw, aligned.positions);
  if (welded.faceVerts.length === 0) throw new GarmentImportError('Every face of this mesh is degenerate.');

  const stem = `${fileStem(name)}_${newId().slice(0, 8)}`;
  const id = `user:garment/${stem}`;
  const d = await decimateProxy(unboundProxy(id, welded.positions, raw.uvs, welded.faceVerts, welded.faceUvs), slot);
  const binding = bindToBody(d.restPositions, body);

  const topo = buildRenderTopology(Uint32Array.from(d.faceVerts), Uint32Array.from(d.faceUvs), Float32Array.from(d.uvs));
  const covered = computeCoveredVertices({
    bodyPositions: body.positions,
    bodyNormals: body.normals,
    bodyQuads: body.quads,
    garmentPositions: gather3(d.restPositions, topo.sourceVertex, new Float32Array(topo.sourceVertex.length * 3)),
    garmentIndices: topo.indices,
    garmentUvs: topo.uvs,
  });

  const b = new ContainerBuilder();
  b.add('restPositions', d.restPositions, 'f32');
  b.add('uvs', d.uvs, 'f32');
  b.add('faceVerts', d.faceVerts, 'u32');
  b.add('faceUvs', d.faceUvs, 'u32');
  b.add('refVerts', binding.refVerts, 'u32');
  b.add('refWeights', binding.refWeights, 'f32');
  b.add('refOffsets', binding.refOffsets, 'f32');
  if (covered.length) b.add('coveredVerts', covered, 'u32');
  const skin = skinWeights(binding, topo.sourceIndices, body);
  b.add('skinOffsets', skin.reduce<number[]>((o, w) => (o.push(o[o.length - 1]! + w.length), o), [0]), 'u32');
  b.add('skinBones', skin.flatMap((w) => w.map(([bone]) => bone)), 'u16');
  b.add('skinValues', skin.flatMap((w) => w.map(([, x]) => x)), 'f32');
  const { bin, table } = b.finish(`${stem}.bin`);
  const meta: ProxyMeta = {
    ...(table as ContainerMeta),
    format: 'ps2cc.proxy/1',
    id,
    category: 'clothes',
    name,
    uuid: newId(),
    tags: ['user'],
    zDepth: SLOT_Z_DEPTH[slot],
    vertexCount: d.kept.length,
    faceCount: d.triangles,
    scale: scaleReferences(binding.refVerts, body),
    material: null,
    slot,
    decimatedFrom: welded.positions.length / 3,
    hiddenFaces: covered.length ? 'computed' : 'none',
    originalTriangles: d.originalTriangles,
  };
  const warnings: string[] = [];
  if (!raw.hasUvs) warnings.push('The mesh has no UVs, so textures will not map onto it. Unwrap it and import it again.');
  if (d.flipped > 0) warnings.push(`${d.flipped} triangles flipped during decimation.`);
  return {
    meta,
    bin,
    proxy: new ProxyAsset(new Container<ProxyMeta>(meta, bin.buffer)),
    report: {
      originalTriangles: d.originalTriangles,
      triangles: d.triangles,
      vertices: d.kept.length,
      coveredBodyVertices: covered.length,
      medianGap: aligned.gap,
      correction: aligned.correction,
      warnings,
    },
  };
}
