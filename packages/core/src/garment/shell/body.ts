/**
 * The body a shell garment is cut from (PRD Part 3, F28): the 12k PS2 body
 * tier (a closed vertex subset of hm08) on the reference body, with a body
 * part per vertex from the GameEngine skin weights, the fitted skeleton and
 * the anthropometry landmarks. Built once per reference body and cached.
 *
 * Shell garments are generated on this body only and bound to it like an
 * imported garment (M10), so identical parameters give identical topology on
 * every character.
 */
import { hypot } from '../../math/dmath';
import type { CoreAssets } from '../../assets';
import { defaultCharacter } from '../../character/doc';
import { CharacterEngine } from '../../character/engine';
import { TriangleBVH } from '../../mesh/bvh';
import type { FittedSkeleton } from '../../skeleton/rig';
import { hull2d } from './shape';
import { add, cross, dot, len, normalize, scale, sub, type Vec3 } from './vec';

/** Body parts a shell vertex can belong to. Limbs are the character's own left (+X) and right. */
export const SEGMENTS = [
  'head',
  'neck',
  'torso',
  'pelvis',
  'upperarm_l',
  'upperarm_r',
  'lowerarm_l',
  'lowerarm_r',
  'hand_l',
  'hand_r',
  'thigh_l',
  'thigh_r',
  'calf_l',
  'calf_r',
  'foot_l',
  'foot_r',
] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEG: Record<Segment, number> = Object.fromEntries(SEGMENTS.map((s, i) => [s, i])) as Record<Segment, number>;

/** The body tier shells are cut from: dense enough for a smooth silhouette, close to a PS2 budget. */
export const SHELL_SOURCE_TIER = 'ps2_body_12k';
/** Small garments (boots, gloves, hats) cut from a denser tier: the 12k tier is coarse at the feet and hands. */
export type ShellTier = 'ps2_body_12k' | 'ps2_body_full';

function segmentOfBone(name: string): Segment {
  if (name === 'Root' || name === 'pelvis') return 'pelvis';
  if (name.startsWith('spine') || name.startsWith('clavicle')) return 'torso';
  if (name === 'neck_01') return 'neck';
  if (name === 'head') return 'head';
  const side = name.endsWith('_l') ? 'l' : 'r';
  if (name.startsWith('upperarm')) return `upperarm_${side}`;
  if (name.startsWith('lowerarm')) return `lowerarm_${side}`;
  if (name.startsWith('thigh')) return `thigh_${side}`;
  if (name.startsWith('calf')) return `calf_${side}`;
  if (name.startsWith('foot') || name.startsWith('ball')) return `foot_${side}`;
  return `hand_${side}`;
}

export interface Bone {
  head: Vec3;
  tail: Vec3;
}

export interface ShellBody {
  /** Shell vertices (the tier's geometry vertices), metres. */
  positions: Float64Array;
  /** Smooth vertex normals of the tier. */
  normals: Float64Array;
  /** hm08 vertex of each shell vertex. */
  source: Uint32Array;
  /** Shell vertex of an hm08 vertex, or -1 when the tier dropped it. */
  shellOf: Int32Array;
  /** Closed triangle mesh, outward facing. */
  tris: Uint32Array;
  /** Dominant body part per vertex (index into SEGMENTS). */
  segment: Uint8Array;
  /** Dominant bone per vertex (GameEngine rig index). */
  bone: Uint16Array;
  boneNames: string[];
  skeleton: FittedSkeleton;
  /** The visible hm08 body on the reference body, for closest points and rays (all of hm08, finer than the tier). */
  bvh: TriangleBVH;
  bvhPositions: Float32Array;
  bvhTris: Uint32Array;
  bvhNormals: Float32Array;
  /**
   * The rendered body tiers (8k, 10k, 12k) on the same positions: decimated
   * tiers bridge hollows (the heel's crease, under the chin, between fingers)
   * where the full body dips, each a little differently, so cloth keeps clear
   * of all of them (`bodyDistance`), whichever the export profile shows.
   */
  tiers: { bvh: TriangleBVH; tris: Uint32Array; normals: Float32Array }[];
  tierTris: Uint32Array[];
  /**
   * Per hm08 vertex, how far the tiers' surfaces stand off the full body near
   * it at most (measured on the reference body, spread two rings, with a
   * margin): a point farther than that beyond what a check needs from the
   * full body there is clear of every tier too (fingers' webs, ears: about
   * 2 cm; the torso: a few mm).
   */
  tierSlack: Float32Array;
  /** Waist and hip girths of the reference body (metres): garments are graded from them (`grade`). */
  refGirth: { waist: number; hips: number };
  /** Lowest point of the feet: the ground. */
  ground: number;
  /** hm08 positions of the reference body (all vertices), metres. */
  hm08: Float32Array;
  assets: CoreAssets;
}

const cache = new WeakMap<CoreAssets, Map<ShellTier, Promise<ShellBody>>>();

/** The shell body of the reference character (cached per asset set). */
export function shellBody(assets: CoreAssets, tierId: ShellTier = SHELL_SOURCE_TIER): Promise<ShellBody> {
  let byTier = cache.get(assets);
  if (!byTier) {
    byTier = new Map();
    cache.set(assets, byTier);
  }
  let p = byTier.get(tierId);
  if (!p) {
    p = build(assets, tierId);
    byTier.set(tierId, p);
  }
  return p;
}

async function build(assets: CoreAssets, tierId: ShellTier): Promise<ShellBody> {
  const engine = new CharacterEngine(assets, defaultCharacter());
  const hm08 = engine.positions.slice();
  const tier = await assets.bodyMesh(tierId);
  if (!tier) throw new Error(`shell garments need the ${tierId} body tier`);
  // Weld the render mesh (UV seams split it) into geometry vertices.
  const shellOf = new Int32Array(assets.base.vertexCount).fill(-1);
  const source: number[] = [];
  for (let i = 0; i < tier.sourceVertex.length; i++) {
    const v = tier.sourceVertex[i]!;
    if (shellOf[v]! < 0) {
      shellOf[v] = source.length;
      source.push(v);
    }
  }
  // Ascending hm08 order, so shell vertex numbering never depends on the tier's render order.
  source.sort((a, b) => a - b);
  for (let i = 0; i < source.length; i++) shellOf[source[i]!] = i;
  const n = source.length;
  const tris = new Uint32Array(tier.indices.length);
  for (let i = 0; i < tier.indices.length; i++) tris[i] = shellOf[tier.sourceVertex[tier.indices[i]!]!]!;

  // Body part from the skin weights: the part whose bones weigh most.
  const names = assets.rig.bones.map((b) => b.name);
  const segOfBone = names.map((b) => SEG[segmentOfBone(b)]);
  const segment = new Uint8Array(n);
  const bone = new Uint16Array(n);
  const sums = new Float64Array(SEGMENTS.length);
  for (let i = 0; i < n; i++) {
    sums.fill(0);
    let bestBone = 0;
    let bestBoneW = -1;
    for (const [b, w] of assets.weights.sparse[source[i]!] ?? []) {
      sums[segOfBone[b]!]! += w;
      if (w > bestBoneW || (w === bestBoneW && b < bestBone)) {
        bestBone = b;
        bestBoneW = w;
      }
    }
    let best = 0;
    for (let s = 1; s < SEGMENTS.length; s++) if (sums[s]! > sums[best]!) best = s;
    segment[i] = best;
    bone[i] = bestBone;
  }

  // The full-resolution visible body for distances (closer to what the character shows than the tier).
  const faces = assets.base.facesWhere((g) => g === 'body');
  const bt: number[] = [];
  for (const f of faces) {
    const q = assets.base.faceVerts.subarray(f * 4, f * 4 + 4);
    bt.push(q[0]!, q[1]!, q[2]!);
    if (q[3] !== q[2]) bt.push(q[0]!, q[2]!, q[3]!);
  }
  const bvhTris = Uint32Array.from(bt);
  const tierTris: Uint32Array[] = [];
  for (const id of ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k'] as const) {
    const t = await assets.bodyMesh(id);
    if (t) tierTris.push(Uint32Array.from(t.indices, (r) => t.sourceVertex[r]!));
  }
  // The tiers share the full body's vertices; their triangles' middles stand off it (across hollows).
  const fullBvh = new TriangleBVH(hm08, bvhTris);
  const nv = assets.base.vertexCount;
  let slack = new Float32Array(nv);
  for (const T of tierTris) {
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t]! * 3;
      const b = T[t + 1]! * 3;
      const c = T[t + 2]! * 3;
      for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]] as const) {
        const q: [number, number, number] = [0, 1, 2].map((k) => wa * hm08[a + k]! + wb * hm08[b + k]! + wc * hm08[c + k]!) as [number, number, number];
        const hit = fullBvh.closestPoint(q, 0.05);
        if (!hit) continue;
        for (const v of [bvhTris[hit.triangle * 3]!, bvhTris[hit.triangle * 3 + 1]!, bvhTris[hit.triangle * 3 + 2]!, T[t]!, T[t + 1]!, T[t + 2]!]) slack[v] = Math.max(slack[v]!, hit.distance);
      }
    }
  }
  // Spread two rings over the full body.
  for (let ring = 0; ring < 2; ring++) {
    const next = Float32Array.from(slack);
    for (let t = 0; t < bvhTris.length; t += 3) {
      const a = bvhTris[t]!;
      const b = bvhTris[t + 1]!;
      const c = bvhTris[t + 2]!;
      const mx = Math.max(slack[a]!, slack[b]!, slack[c]!);
      next[a] = Math.max(next[a]!, mx);
      next[b] = Math.max(next[b]!, mx);
      next[c] = Math.max(next[c]!, mx);
    }
    slack = next;
  }
  const tierSlack = slack.map((x) => x * 1.5 + 0.002);
  const refGirth = { waist: girthOf(hm08, assets, 'waist'), hips: girthOf(hm08, assets, 'hips') };
  const statics = { source: Uint32Array.from(source), shellOf, tris, segment, bone, boneNames: names, bvhTris, tierTris, tierSlack, refGirth, assets };
  return shellBodyAt(statics, hm08, engine.skeleton);
}

/**
 * The shell body of any character: the same tier, parts and triangles as the
 * reference body's, on that character's positions. Garments are generated on
 * it with the reference body's topology (`runShell` replay), so they fit the
 * character's own shape.
 */
export function shellBodyAt(
  base: Pick<ShellBody, 'source' | 'shellOf' | 'tris' | 'segment' | 'bone' | 'boneNames' | 'bvhTris' | 'tierTris' | 'tierSlack' | 'refGirth' | 'assets'>,
  hm08: Float32Array,
  skeleton: FittedSkeleton,
): ShellBody {
  const n = base.source.length;
  const positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = hm08[base.source[i]! * 3 + k]!;
  const normals = vertexNormals(positions, base.tris);
  const bvhNormals = Float32Array.from(vertexNormals(hm08, base.bvhTris, base.assets.base.vertexCount));
  let ground = Infinity;
  for (let i = 0; i < n; i++) ground = Math.min(ground, positions[i * 3 + 1]!);
  return {
    source: base.source,
    shellOf: base.shellOf,
    tris: base.tris,
    segment: base.segment,
    bone: base.bone,
    boneNames: base.boneNames,
    bvhTris: base.bvhTris,
    tierTris: base.tierTris,
    tierSlack: base.tierSlack,
    refGirth: base.refGirth,
    tiers: base.tierTris.map((tris) => ({ bvh: new TriangleBVH(hm08, tris), tris, normals: Float32Array.from(vertexNormals(hm08, tris, base.assets.base.vertexCount)) })),
    assets: base.assets,
    positions,
    normals,
    skeleton,
    bvh: new TriangleBVH(hm08, base.bvhTris),
    bvhPositions: hm08,
    bvhNormals,
    ground,
    hm08,
  };
}

/** Area-weighted vertex normals of a triangle mesh. */
export function vertexNormals(P: ArrayLike<number>, tris: ArrayLike<number>, count = P.length / 3): Float64Array {
  const out = new Float64Array(count * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3;
    const b = tris[t + 1]! * 3;
    const c = tris[t + 2]! * 3;
    const e1x = P[b]! - P[a]!;
    const e1y = P[b + 1]! - P[a + 1]!;
    const e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!;
    const e2y = P[c + 1]! - P[a + 1]!;
    const e2z = P[c + 2]! - P[a + 2]!;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      out[v] = out[v]! + nx;
      out[v + 1] = out[v + 1]! + ny;
      out[v + 2] = out[v + 2]! + nz;
    }
  }
  for (let v = 0; v < count; v++) {
    const l = Math.sqrt(out[v * 3]! * out[v * 3]! + out[v * 3 + 1]! * out[v * 3 + 1]! + out[v * 3 + 2]! * out[v * 3 + 2]!) || 1;
    out[v * 3] = out[v * 3]! / l;
    out[v * 3 + 1] = out[v * 3 + 1]! / l;
    out[v * 3 + 2] = out[v * 3 + 2]! / l;
  }
  return out;
}

/** A bone's head and tail on the reference body. */
export function boneOf(body: ShellBody, name: string): Bone {
  const i = body.boneNames.indexOf(name);
  if (i < 0) throw new Error(`shell: no bone ${name}`);
  const h = body.skeleton.heads;
  const t = body.skeleton.tails;
  return { head: [h[i * 3]!, h[i * 3 + 1]!, h[i * 3 + 2]!], tail: [t[i * 3]!, t[i * 3 + 1]!, t[i * 3 + 2]!] };
}

/** Position of an hm08 vertex on the reference body. */
export function hmPoint(body: ShellBody, v: number): Vec3 {
  return [body.hm08[v * 3]!, body.hm08[v * 3 + 1]!, body.hm08[v * 3 + 2]!];
}

/** A landmark ring on the reference body: its centre, mean height and vertices (hm08). */
export function ringOf(body: ShellBody, name: string, side: 'l' | 'r' = 'l'): { centre: Vec3; y: number; points: Vec3[] } {
  const def = (body.assets.bodyLandmarks.rings as Record<string, { vertices: number[]; mirror?: number[] }>)[name];
  if (!def) throw new Error(`shell: no ring ${name}`);
  const verts = side === 'r' && def.mirror ? def.mirror : def.vertices;
  const points = verts.map((v) => hmPoint(body, v));
  let c: Vec3 = [0, 0, 0];
  for (const p of points) c = add(c, p);
  c = scale(c, 1 / points.length);
  return { centre: c, y: c[1], points };
}

/** Girth at a landmark ring (the length around its convex outline seen from above), metres. */
function girthOf(hm08: ArrayLike<number>, assets: CoreAssets, name: string): number {
  const def = (assets.bodyLandmarks.rings as Record<string, { vertices: number[] }>)[name];
  if (!def) return 0;
  const xs = def.vertices.map((v) => hm08[v * 3]!);
  const zs = def.vertices.map((v) => hm08[v * 3 + 2]!);
  const h = hull2d(xs, zs);
  let l = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!;
    const b = h[(i + 1) % h.length]!;
    l += hypot(xs[b]! - xs[a]!, zs[b]! - zs[a]!);
  }
  return l;
}

/**
 * How much bigger this body is round the waist and hips than the reference
 * body (1 = the same), clamped to 0.85-1.6: ease is set for the reference
 * figure and graded with the body, as patterns are between sizes, so a
 * garment sits on a heavy body as it does on the default one.
 */
export function grade(body: ShellBody): number {
  const w = body.refGirth.waist > 0 ? girthOf(body.hm08, body.assets, 'waist') / body.refGirth.waist : 1;
  const h = body.refGirth.hips > 0 ? girthOf(body.hm08, body.assets, 'hips') / body.refGirth.hips : 1;
  return Math.min(1.6, Math.max(0.85, (w + h) / 2));
}

/** A named landmark point on the reference body. */
export function pointOf(body: ShellBody, name: string): Vec3 {
  const v = (body.assets.bodyLandmarks.points as Record<string, number>)[name];
  if (v === undefined) throw new Error(`shell: no point ${name}`);
  return hmPoint(body, v);
}

/** A paired landmark (left or right) on the reference body. */
export function pairOf(body: ShellBody, name: string, side: 'l' | 'r'): Vec3 {
  const p = (body.assets.bodyLandmarks.pairs as Record<string, { l: number; r: number }>)[name];
  if (!p) throw new Error(`shell: no paired point ${name}`);
  return hmPoint(body, p[side]);
}

/** Parameter of a point along a bone: 0 at the head, 1 at the tail. */
export function alongBone(b: Bone, p: Vec3): number {
  const d = sub(b.tail, b.head);
  return dot(sub(p, b.head), d) / Math.max(1e-12, dot(d, d));
}

/** Distance of a point from a bone's line. */
export function fromBoneAxis(b: Bone, p: Vec3): number {
  const d = normalize(sub(b.tail, b.head));
  return len(cross(sub(p, b.head), d));
}
