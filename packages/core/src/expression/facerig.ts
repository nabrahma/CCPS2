/**
 * The MakeHuman default rig as a face rig for blendshape baking (PRD F8).
 * The export skeleton (GameEngine) has no face bones; faces animate by
 * blendshapes baked here by posing the default rig and taking the mesh delta.
 *
 * MakeHuman's posing, ported:
 *  - joints: the mean of each joint's reference vertices on the morphed mesh
 *    (skeleton.getJointPosition);
 *  - weights: default_weights.mhw normalised per vertex, entries of 1e-4 or
 *    less dropped (VertexBoneWeights._build_vertex_weights_data);
 *  - pose: a unit pose is a world rotation R per bone (Skeleton.setPose turns
 *    it into R_local = Rest^-1 R Rest), so through the hierarchy each bone's
 *    skinning matrix is G_i = G_parent T(h_i) R_i T(-h_i), h_i the rest head;
 *  - skinning: linear blend, sum_b w_b G_b x (Skeleton.skinMesh).
 * The delta of a vertex is sum_b w_b (G_b x - x), MakeHuman's posed mesh minus
 * the same skinning at rest.
 */
import type { RigDefinition } from '../skeleton/rig';
import type { SparseWeights } from '../skeleton/weights';
import { quatToMat3, type Quat } from './poseunits';

/** VertexBoneWeights WEIGHT_THRESHOLD. */
const WEIGHT_THRESHOLD = 1e-4;

export class FaceRig {
  /** Normalised weights per base vertex, as MakeHuman skins with them. */
  readonly weights: SparseWeights;

  constructor(
    readonly rig: RigDefinition,
    raw: SparseWeights,
  ) {
    this.weights = normaliseWeights(raw, 0);
  }

  /** Bone heads (rest) on the morphed base mesh, xyz per bone. */
  heads(positions: ArrayLike<number>): Float64Array {
    const out = new Float64Array(this.rig.boneCount * 3);
    this.rig.bones.forEach((b, i) => {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const v of b.head.vertices) {
        x += positions[v * 3]!;
        y += positions[v * 3 + 1]!;
        z += positions[v * 3 + 2]!;
      }
      const n = b.head.vertices.length;
      out[i * 3] = x / n;
      out[i * 3 + 1] = y / n;
      out[i * 3 + 2] = z / n;
    });
    return out;
  }

  /**
   * Skinning matrices (column-major 4x4 per bone, metres) for world rotations
   * per bone name. Bones without a rotation follow their parent.
   */
  skinMatrices(heads: Float64Array, rotations: ReadonlyMap<string, Quat>): Float64Array {
    const n = this.rig.boneCount;
    const out = new Float64Array(n * 16);
    for (let i = 0; i < n; i++) {
      const q = rotations.get(this.rig.bones[i]!.name);
      // Local: rotation about the head, T(h) R T(-h) = [R, h - R h].
      const local = new Float64Array(16);
      if (q) {
        const r = quatToMat3(q);
        const hx = heads[i * 3]!;
        const hy = heads[i * 3 + 1]!;
        const hz = heads[i * 3 + 2]!;
        for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) local[c * 4 + k] = r[c * 3 + k]!;
        local[12] = hx - (r[0]! * hx + r[3]! * hy + r[6]! * hz);
        local[13] = hy - (r[1]! * hx + r[4]! * hy + r[7]! * hz);
        local[14] = hz - (r[2]! * hx + r[5]! * hy + r[8]! * hz);
      } else {
        local[0] = local[5] = local[10] = 1;
      }
      local[15] = 1;
      const p = this.rig.parents[i]!;
      out.set(p < 0 ? local : mulAffine(out.subarray(p * 16, p * 16 + 16), local), i * 16);
    }
    return out;
  }

  /** Bones whose skinning matrix is not the identity (they or an ancestor rotate). */
  static moving(skin: Float64Array): Uint8Array {
    const n = skin.length / 16;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 16; k++) {
        const id = k % 5 === 0 ? 1 : 0;
        if (Math.abs(skin[i * 16 + k]! - id) > 1e-12) {
          out[i] = 1;
          break;
        }
      }
    }
    return out;
  }
}

/** a * b for affine column-major 4x4 matrices. */
function mulAffine(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 3; r++) {
      o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + (c === 3 ? a[12 + r]! : 0);
    }
  }
  o[15] = 1;
  return o;
}

/**
 * MakeHuman's weight normalisation: duplicates merged, each weight divided by
 * the vertex total, entries at or below 1e-4 dropped (not renormalised).
 * Vertices without weights go to `rootBone` with weight 1.
 */
export function normaliseWeights(raw: SparseWeights, rootBone: number): SparseWeights {
  return raw.map((list) => {
    const acc = new Map<number, number>();
    let total = 0;
    for (const [b, w] of list) {
      acc.set(b, (acc.get(b) ?? 0) + w);
      total += w;
    }
    if (acc.size === 0 || total <= 0) return [[rootBone, 1]];
    const out: [number, number][] = [];
    for (const [b, w] of acc) if (w / total > WEIGHT_THRESHOLD) out.push([b, w / total]);
    return out;
  });
}

/**
 * Deltas of skinned points: sum_b w_b (G_b p - p) per point, xyz.
 * `moving` (from FaceRig.moving) skips bones that stay put.
 */
export function skinDeltas(
  points: ArrayLike<number>,
  weights: SparseWeights,
  skin: Float64Array,
  moving: Uint8Array,
  out: Float32Array = new Float32Array(points.length),
): Float32Array {
  const n = points.length / 3;
  for (let v = 0; v < n; v++) {
    const x = points[v * 3]!;
    const y = points[v * 3 + 1]!;
    const z = points[v * 3 + 2]!;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const [b, w] of weights[v] ?? []) {
      if (!moving[b]) continue;
      const m = b * 16;
      dx += w * (skin[m]! * x + skin[m + 4]! * y + skin[m + 8]! * z + skin[m + 12]! - x);
      dy += w * (skin[m + 1]! * x + skin[m + 5]! * y + skin[m + 9]! * z + skin[m + 13]! - y);
      dz += w * (skin[m + 2]! * x + skin[m + 6]! * y + skin[m + 10]! * z + skin[m + 14]! - z);
    }
    out[v * 3] = dx;
    out[v * 3 + 1] = dy;
    out[v * 3 + 2] = dz;
  }
  return out;
}
