/**
 * Bake engine inputs and the CPU reference (PRD Part 2, F16). The GPU baker
 * (packages/viewport/src/bake.ts) traces the same rays against the same
 * packed hierarchy; this file defines what is traced, so the two agree:
 *
 * - Targets: what gets a baked map, in its own UV space. The body is baked
 *   from the full-density MakeHuman mesh (every tier shares its UVs, so one
 *   bake serves all of them, with all the face detail); garments from their
 *   scene meshes.
 * - Occluders: everything assembled, each triangle with an opacity (hair
 *   cards and lashes let some light through).
 * - Per texel: ambient occlusion (cosine-weighted rays, the product of
 *   (1 - opacity) of everything they pass within `aoDistance`), thickness
 *   (rays into the surface, mean distance to the far side), key-light
 *   visibility for the light bake, and cavity from mesh curvature.
 */
import type { CharacterScene, ScenePart } from '../scene/character-scene';
import { buildRenderTopology } from '../scene/render-mesh';
import { TriangleBVH } from '../mesh/bvh';

export interface BakeSettings {
  /** Texels across each map. */
  size: number;
  /** Rays per texel for occlusion (and as many again for thickness). */
  rays: number;
  /** Occluders further away than this do not darken (metres). */
  aoDistance: number;
  /** Thickness saturates at this depth (metres). */
  thicknessDistance: number;
  /** How strongly concave curvature darkens (cavity). */
  cavityScale: number;
}

export const DEFAULT_BAKE: BakeSettings = { size: 1024, rays: 64, aoDistance: 0.15, thicknessDistance: 0.06, cavityScale: 60 };

/**
 * The light the light bake assumes (Classic): an even sky and a key from
 * above, front and left. It shades the texture the way the era baked light
 * into the diffuse; per-vertex light on top supplies the direction.
 */
export const BAKE_LIGHT = { keyDirection: normalise([-0.45, 0.8, 0.4]), sky: 1, key: 1.5, keySoftness: 0.08 };

export interface BakeTarget {
  /** Scene part key ('body', a garment key). */
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Per vertex: concave curvature, already scaled to darkening 0..1. */
  cavity: Float32Array;
  /** UVs are OBJ-style (v up) and the map is stored rows top first. */
  size: number;
}

export interface BakeOccluders {
  positions: Float32Array;
  indices: Uint32Array;
  /** Per triangle, 0..1. */
  opacity: Float32Array;
}

export interface BakeInputs {
  targets: BakeTarget[];
  occluders: BakeOccluders;
  /** Changes when anything that affects the bake changes (shape, parts, settings). */
  signature: string;
}

export function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** How much light a part blocks. */
export function occluderOpacity(part: ScenePart): number {
  switch (part.kind) {
    case 'hair':
      return 0.45;
    case 'eyebrows':
      return 0.2;
    case 'eyelashes':
      return 0.1;
    case 'garment':
      return part.material.alphaCutout ? 0.5 : 1;
    default:
      return 1;
  }
}

/**
 * Concave curvature per vertex: the umbrella Laplacian along the normal over
 * the mean edge length, positive in creases, scaled and clamped to 0..1.
 */
export function vertexCavity(positions: ArrayLike<number>, normals: ArrayLike<number>, indices: ArrayLike<number>, vertexCount: number, scale: number): Float32Array {
  const sum = new Float64Array(vertexCount * 3);
  const count = new Uint32Array(vertexCount);
  const edge = new Float64Array(vertexCount);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!;
      const b = indices[t + ((k + 1) % 3)]!;
      for (const [p, q] of [[a, b], [b, a]] as const) {
        sum[p * 3] = sum[p * 3]! + positions[q * 3]!;
        sum[p * 3 + 1] = sum[p * 3 + 1]! + positions[q * 3 + 1]!;
        sum[p * 3 + 2] = sum[p * 3 + 2]! + positions[q * 3 + 2]!;
        count[p]!++;
        edge[p] = edge[p]! + Math.hypot(positions[q * 3]! - positions[p * 3]!, positions[q * 3 + 1]! - positions[p * 3 + 1]!, positions[q * 3 + 2]! - positions[p * 3 + 2]!);
      }
    }
  }
  const out = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const c = count[v]!;
    if (!c) continue;
    const lx = sum[v * 3]! / c - positions[v * 3]!;
    const ly = sum[v * 3 + 1]! / c - positions[v * 3 + 1]!;
    const lz = sum[v * 3 + 2]! / c - positions[v * 3 + 2]!;
    const along = lx * normals[v * 3]! + ly * normals[v * 3 + 1]! + lz * normals[v * 3 + 2]!;
    const len = edge[v]! / c;
    out[v] = Math.min(1, Math.max(0, (along / Math.max(len, 1e-6)) * (scale / 10)));
  }
  return out;
}

/** Targets and occluders of the scene as it is now. */
export function bakeInputs(scene: CharacterScene, settings: BakeSettings = DEFAULT_BAKE): BakeInputs {
  const engine = scene.engine;
  const base = engine.assets.base;
  const targets: BakeTarget[] = [];
  // The body from the full-density MakeHuman mesh, in its own UVs.
  const faces = base.facesWhere((g) => g === 'body');
  const topo = buildRenderTopology(base.faceVerts, base.faceUvs, base.uvs, faces);
  const n = topo.sourceVertex.length;
  const bodyPos = new Float32Array(n * 3);
  const bodyNrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = topo.sourceVertex[i]!;
    for (let k = 0; k < 3; k++) {
      bodyPos[i * 3 + k] = engine.positions[v * 3 + k]!;
      bodyNrm[i * 3 + k] = engine.normals[v * 3 + k]!;
    }
  }
  // Curvature on the welded mesh (seam copies would see half a neighbourhood each).
  const welded = vertexCavity(engine.positions, engine.normals, weldedTriangles(topo.indices, topo.sourceVertex), base.vertexCount, settings.cavityScale);
  const bodyCavity = Float32Array.from(topo.sourceVertex, (v) => welded[v]!);
  if (scene.parts.some((p) => p.kind === 'body')) {
    targets.push({ key: 'body', positions: bodyPos, normals: bodyNrm, uvs: topo.uvs, indices: topo.indices, cavity: bodyCavity, size: settings.size });
  }
  for (const p of scene.parts) {
    if (p.kind !== 'garment' || p.indices.length === 0) continue;
    const cav = vertexCavity(p.positions, p.normals, p.indices, p.positions.length / 3, settings.cavityScale);
    targets.push({ key: p.key, positions: p.positions, normals: p.normals, uvs: p.uvs, indices: p.indices, cavity: cav, size: Math.min(settings.size, 1024) });
  }
  // Occluders: the full body (where the texels are) and every other visible part.
  const parts: { positions: ArrayLike<number>; indices: ArrayLike<number>; opacity: number }[] = [
    { positions: bodyPos, indices: topo.indices, opacity: 1 },
  ];
  for (const p of scene.parts) if (p.kind !== 'body' && p.indices.length) parts.push({ positions: p.positions, indices: p.indices, opacity: occluderOpacity(p) });
  const occluders = merge(parts);
  return { targets, occluders, signature: bakeSignature(scene, settings) };
}

/** Changes whenever a bake of the scene would come out different (cheap: no geometry is read). */
export function bakeSignature(scene: CharacterScene, settings: BakeSettings): string {
  return JSON.stringify({ g: scene.engine.geometryVersion, parts: scene.parts.map((p) => [p.key, p.assetId, p.indices.length, p.kind === 'hair' ? p.version : 0]), settings });
}

function weldedTriangles(indices: Uint32Array, sourceVertex: Uint32Array): Uint32Array {
  return Uint32Array.from(indices, (i) => sourceVertex[i]!);
}

function merge(parts: { positions: ArrayLike<number>; indices: ArrayLike<number>; opacity: number }[]): BakeOccluders {
  let nv = 0;
  let nt = 0;
  for (const p of parts) {
    nv += p.positions.length / 3;
    nt += p.indices.length / 3;
  }
  const positions = new Float32Array(nv * 3);
  const indices = new Uint32Array(nt * 3);
  const opacity = new Float32Array(nt);
  let v0 = 0;
  let t0 = 0;
  for (const p of parts) {
    positions.set(p.positions, v0 * 3);
    for (let i = 0; i < p.indices.length; i++) indices[t0 * 3 + i] = p.indices[i]! + v0;
    opacity.fill(p.opacity, t0, t0 + p.indices.length / 3);
    v0 += p.positions.length / 3;
    t0 += p.indices.length / 3;
  }
  return { positions, indices, opacity };
}

/**
 * The hierarchy and triangles packed for the GPU: RGBA32F texels, `width`
 * wide. Nodes take two texels (min xyz + link0, max xyz + link1); triangles
 * three, in leaf order (v0 + opacity, v1, v2).
 */
export interface PackedBvh {
  width: number;
  nodes: Float32Array;
  nodeRows: number;
  triangles: Float32Array;
  triangleRows: number;
  bvh: TriangleBVH;
}

export function packBvh(occ: BakeOccluders, width = 2048): PackedBvh {
  const bvh = new TriangleBVH(occ.positions, occ.indices);
  const { nodeCount, bounds, links, order } = bvh.exportNodes();
  const nodeTexels = nodeCount * 2;
  const nodeRows = Math.max(1, Math.ceil(nodeTexels / width));
  const nodes = new Float32Array(nodeRows * width * 4);
  for (let i = 0; i < nodeCount; i++) {
    nodes.set([bounds[i * 6]!, bounds[i * 6 + 1]!, bounds[i * 6 + 2]!, links[i * 2]!], i * 8);
    nodes.set([bounds[i * 6 + 3]!, bounds[i * 6 + 4]!, bounds[i * 6 + 5]!, links[i * 2 + 1]!], i * 8 + 4);
  }
  const triTexels = order.length * 3;
  const triangleRows = Math.max(1, Math.ceil(triTexels / width));
  const triangles = new Float32Array(triangleRows * width * 4);
  const P = occ.positions;
  for (let i = 0; i < order.length; i++) {
    const t = order[i]!;
    for (let c = 0; c < 3; c++) {
      const v = occ.indices[t * 3 + c]! * 3;
      triangles.set([P[v]!, P[v + 1]!, P[v + 2]!, c === 0 ? occ.opacity[t]! : 0], (i * 3 + c) * 4);
    }
  }
  return { width, nodes, nodeRows, triangles, triangleRows, bvh };
}

/** Low-discrepancy point i of n in [0,1)^2, rotated by a per-texel offset (Cranley-Patterson). */
export function samplePoint(i: number, n: number, offset: [number, number]): [number, number] {
  // Hammersley: (i/n, radical inverse of i).
  let bits = i >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  const ri = bits / 4294967296;
  return [((i + 0.5) / n + offset[0]) % 1, (ri + offset[1]) % 1];
}

/** Cosine-weighted direction around n from a point in [0,1)^2. */
export function cosineDirection(n: ArrayLike<number>, u: [number, number]): [number, number, number] {
  const r = Math.sqrt(u[0]);
  const phi = 2 * Math.PI * u[1];
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi);
  const z = Math.sqrt(Math.max(0, 1 - u[0]));
  // Orthonormal basis (Frisvad / Duff et al.).
  const s = n[2]! >= 0 ? 1 : -1;
  const a = -1 / (s + n[2]!);
  const b = n[0]! * n[1]! * a;
  const t1 = [1 + s * n[0]! * n[0]! * a, s * b, -s * n[0]!];
  const t2 = [b, s + n[1]! * n[1]! * a, -n[1]!];
  return [x * t1[0]! + y * t2[0]! + z * n[0]!, x * t1[1]! + y * t2[1]! + z * n[1]!, x * t1[2]! + y * t2[2]! + z * n[2]!];
}

/** Per-texel offset of the sample pattern (the GPU uses the same hash). */
export function texelOffset(x: number, y: number): [number, number] {
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  return [h(x, y), h(y + 17.0, x + 31.0)];
}

/** Transmittance along a ray: the product of (1 - opacity) of every hit within (tMin, tMax]. */
export function transmittance(packed: PackedBvh, opacity: Float32Array, o: ArrayLike<number>, d: ArrayLike<number>, tMin: number, tMax: number): number {
  let t = 1;
  packed.bvh.raycast(o, d, tMin, tMax, (hit) => {
    t *= 1 - opacity[hit.triangle]!;
    return false; // keep going: every hit counts
  });
  return t;
}

/** Distance to the first opaque-ish hit (opacity >= 0.5), or tMax. */
export function firstHit(packed: PackedBvh, opacity: Float32Array, o: ArrayLike<number>, d: ArrayLike<number>, tMin: number, tMax: number): number {
  const hit = packed.bvh.raycast(o, d, tMin, tMax, (h) => opacity[h.triangle]! >= 0.5);
  return hit ? hit.t : tMax;
}

/** CPU reference for one texel (the acceptance test compares the GPU bake with it). */
export function referenceTexel(
  packed: PackedBvh,
  opacity: Float32Array,
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  settings: BakeSettings,
  rays: number,
  offset: [number, number] = [0, 0],
): { ao: number; thickness: number; keyVisibility: number } {
  const eps = 0.0005;
  const o = [position[0]! + normal[0]! * eps, position[1]! + normal[1]! * eps, position[2]! + normal[2]! * eps];
  const inside = [position[0]! - normal[0]! * eps, position[1]! - normal[1]! * eps, position[2]! - normal[2]! * eps];
  const back = [-normal[0]!, -normal[1]!, -normal[2]!];
  let ao = 0;
  let depth = 0;
  let key = 0;
  const soft = BAKE_LIGHT.keySoftness * BAKE_LIGHT.keySoftness;
  for (let i = 0; i < rays; i++) {
    const u = samplePoint(i, rays, offset);
    ao += transmittance(packed, opacity, o, cosineDirection(normal, u), 1e-4, settings.aoDistance);
    depth += firstHit(packed, opacity, inside, cosineDirection(back, u), 1e-4, settings.thicknessDistance);
    // The soft key light, jittered within a small cone as the GPU does.
    key += transmittance(packed, opacity, o, normalise(cosineDirection(BAKE_LIGHT.keyDirection, [u[0] * soft, u[1]])), 1e-4, 4);
  }
  return { ao: ao / rays, thickness: depth / rays / settings.thicknessDistance, keyVisibility: key / rays };
}

/** Light occlusion stored in the bake's alpha (see BAKE_LIGHT): sky by AO, key by its visibility. */
export function lightOcclusion(ao: number, keyVisibility: number, nDotL: number): number {
  const k = BAKE_LIGHT.key * Math.max(0, nDotL);
  return (BAKE_LIGHT.sky * ao + k * keyVisibility) / (BAKE_LIGHT.sky + k);
}
