/**
 * Rig fitting (PRD M2). Bone heads/tails are placed from the morphed mesh the
 * way MPFB's `Rig.get_best_location_from_strategy` does: the mean of the
 * end's reference vertices (joint cube or explicit list) plus an optional
 * offset. Bone orientation follows Blender's `vec_roll_to_mat3_normalized`
 * (Y axis along the bone, roll about it), evaluated in Blender axes so MPFB's
 * roll values keep their meaning, then converted back to engine axes.
 */
import { readJson, type AssetSource } from '../io/source';
import {
  axisAngle3,
  fromRotationTranslation,
  invertRigid,
  mul3,
  mul4,
  normalize,
  sub,
  type Mat3,
  type Mat4,
  type Vec3,
} from '../math/mat4';

export interface BoneEndDef {
  vertices: number[];
  source: string;
  offset?: Vec3;
}

export interface BoneDef {
  name: string;
  parent: string | null;
  head: BoneEndDef;
  tail: BoneEndDef;
  roll: number;
  connected: boolean;
}

export interface RigDocument {
  format: 'ps2cc.rig/1';
  name: string;
  bones: BoneDef[];
}

export class RigDefinition {
  readonly name: string;
  readonly bones: readonly BoneDef[];
  readonly index: ReadonlyMap<string, number>;
  /** Parent index per bone (-1 for roots). Bones are ordered parent-first. */
  readonly parents: Int32Array;

  constructor(doc: RigDocument) {
    this.name = doc.name;
    this.bones = doc.bones;
    const index = new Map<string, number>();
    doc.bones.forEach((b, i) => index.set(b.name, i));
    this.index = index;
    this.parents = Int32Array.from(doc.bones, (b) => {
      if (!b.parent) return -1;
      const p = index.get(b.parent);
      if (p === undefined) throw new Error(`rig ${doc.name}: bone ${b.name} has unknown parent ${b.parent}`);
      return p;
    });
    this.parents.forEach((p, i) => {
      if (p >= i) throw new Error(`rig ${doc.name}: bones are not ordered parent-first`);
    });
  }

  static async load(source: AssetSource, name: 'game_engine' | 'default'): Promise<RigDefinition> {
    return new RigDefinition(await readJson<RigDocument>(source, `rigs/${name}.json`));
  }

  get boneCount(): number {
    return this.bones.length;
  }
}

/** Engine axes -> Blender axes: (x, y, z) -> (x, -z, y). */
const toBlender = (v: Vec3): Vec3 => [v[0], -v[2], v[1]];
/** Blender axes -> engine axes: (x, y, z) -> (x, z, -y). */
const fromBlender = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

/**
 * Port of Blender's vec_roll_to_mat3_normalized (column-major result).
 *
 * Blender switches to a series approximation of (1 + y) below SAFE_THRESHOLD
 * to survive float32 cancellation; that approximation leaves the matrix
 * non-orthonormal by ~1e-5 for bones pointing almost straight down (the toes).
 * In float64 the exact value is stable, so we only fall back to Blender's
 * approximation when 1 + y underflows to (nearly) zero.
 */
export function vecRollToMat3(nor: Vec3, roll: number): Mat3 {
  const CRITICAL_THRESHOLD = 2.5e-4;
  const THRESHOLD_SQUARED = CRITICAL_THRESHOLD * CRITICAL_THRESHOLD;
  const [x, y, z] = nor;
  let theta = 1.0 + y;
  const thetaAlt = x * x + z * z;
  const b = new Float64Array(9); // b[col*3+row]
  if (theta > 1e-12 || thetaAlt > THRESHOLD_SQUARED) {
    b[1] = -x; // bMatrix[0][1]
    b[3] = x; // bMatrix[1][0]
    b[4] = y; // bMatrix[1][1]
    b[5] = z; // bMatrix[1][2]
    b[7] = -z; // bMatrix[2][1]
    if (theta <= 1e-12) theta = thetaAlt * 0.5 + thetaAlt * thetaAlt * 0.125;
    b[0] = 1 - (x * x) / theta; // bMatrix[0][0]
    b[8] = 1 - (z * z) / theta; // bMatrix[2][2]
    b[2] = b[6] = (-x * z) / theta; // bMatrix[0][2], bMatrix[2][0]
  } else {
    b[0] = -1;
    b[4] = -1;
    b[8] = 1;
  }
  const r = axisAngle3(nor, roll);
  return mul3(r, b);
}

export interface FittedSkeleton {
  rig: RigDefinition;
  /** Bone heads/tails in engine space, metres, xyz per bone. */
  heads: Float64Array;
  tails: Float64Array;
  /** Rest (bind) world matrix per bone, column-major, 16 per bone. */
  restWorld: Float64Array;
  /** Rest matrix relative to the parent bone. */
  restLocal: Float64Array;
  /** Inverse bind matrices (inverse of restWorld). */
  inverseBind: Float64Array;
}

function endPosition(end: BoneEndDef, positions: ArrayLike<number>): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of end.vertices) {
    x += positions[v * 3]!;
    y += positions[v * 3 + 1]!;
    z += positions[v * 3 + 2]!;
  }
  const n = end.vertices.length;
  const p: Vec3 = [x / n, y / n, z / n];
  if (end.offset) {
    p[0] += end.offset[0];
    p[1] += end.offset[1];
    p[2] += end.offset[2];
  }
  return p;
}

/** Fit a rig to morphed positions (metres, engine axes). */
export function fitSkeleton(rig: RigDefinition, positions: ArrayLike<number>): FittedSkeleton {
  const n = rig.boneCount;
  const heads = new Float64Array(n * 3);
  const tails = new Float64Array(n * 3);
  const restWorld = new Float64Array(n * 16);
  const restLocal = new Float64Array(n * 16);
  const inverseBind = new Float64Array(n * 16);
  for (let i = 0; i < n; i++) {
    const b = rig.bones[i]!;
    const h = endPosition(b.head, positions);
    const t = endPosition(b.tail, positions);
    heads.set(h, i * 3);
    tails.set(t, i * 3);
    // Orientation in Blender space, then convert the axes back.
    const dirB = normalize(toBlender(sub(t, h)));
    const rb = vecRollToMat3(dirB, b.roll);
    const cols: Vec3[] = [0, 1, 2].map((c) => fromBlender([rb[c * 3]!, rb[c * 3 + 1]!, rb[c * 3 + 2]!]));
    const r = Float64Array.of(...cols[0]!, ...cols[1]!, ...cols[2]!);
    const world = fromRotationTranslation(r, h);
    restWorld.set(world, i * 16);
    const inv = invertRigid(world);
    inverseBind.set(inv, i * 16);
    const p = rig.parents[i]!;
    const local: Mat4 = p < 0 ? world : mul4(inverseBind.subarray(p * 16, p * 16 + 16) as Mat4, world);
    restLocal.set(local, i * 16);
  }
  return { rig, heads, tails, restWorld, restLocal, inverseBind };
}

/** World matrices for a pose given per-bone local rotations (3x3, applied in bone space). */
export function poseWorldMatrices(sk: FittedSkeleton, localRotations: (Mat3 | null)[]): Float64Array {
  const n = sk.rig.boneCount;
  const world = new Float64Array(n * 16);
  for (let i = 0; i < n; i++) {
    let local = sk.restLocal.subarray(i * 16, i * 16 + 16) as Mat4;
    const r = localRotations[i];
    if (r) local = mul4(local, fromRotationTranslation(r, [0, 0, 0]));
    const p = sk.rig.parents[i]!;
    const w = p < 0 ? local : mul4(world.subarray(p * 16, p * 16 + 16) as Mat4, local);
    world.set(w, i * 16);
  }
  return world;
}

/** Skinning matrices (world * inverseBind) for a pose. */
export function skinningMatrices(sk: FittedSkeleton, world: Float64Array): Float64Array {
  const n = sk.rig.boneCount;
  const out = new Float64Array(n * 16);
  for (let i = 0; i < n; i++) {
    out.set(
      mul4(world.subarray(i * 16, i * 16 + 16) as Mat4, sk.inverseBind.subarray(i * 16, i * 16 + 16) as Mat4),
      i * 16,
    );
  }
  return out;
}
