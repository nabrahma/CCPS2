/**
 * MakeHuman face pose units (PRD F8): 60 unit poses on the default rig's face
 * bones (`expressions/face_poseunits.json`, converted from face-poseunits.bvh
 * by the asset compiler). A unit pose is a world-space rotation about the head
 * of each posed bone; an expression is a weighted blend of unit poses.
 *
 * `blend` is a port of animation.PoseUnit.getBlendedPose (additive blending,
 * the mode MakeHuman's expression library uses): per bone, each unit's
 * rotation is slerped from the identity by its weight, and the results are
 * multiplied in order (q_n ... q_2 q_1).
 */
import { readJson, type AssetSource } from '../io/source';

/** Unit quaternion [w, x, y, z]. */
export type Quat = [number, number, number, number];

export interface PoseUnitsDocument {
  format: 'ps2cc.poseunits/1';
  rig: string;
  units: { name: string; bones: Record<string, Quat> }[];
}

export const POSE_UNITS_FILE = 'expressions/face_poseunits.json';

const IDENTITY: Quat = [1, 0, 0, 0];
/** transformations.py `_EPS`. */
const EPS = Number.EPSILON * 4;

/** Port of transformations.quaternion_slerp (spin 0, shortest path). */
export function quatSlerp(q0: Quat, q1: Quat, fraction: number): Quat {
  if (fraction === 0) return [...q0];
  if (fraction === 1) return [...q1];
  let d = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3];
  if (Math.abs(Math.abs(d) - 1) < EPS) return [...q0];
  let b = q1;
  if (d < 0) {
    d = -d;
    b = [-q1[0], -q1[1], -q1[2], -q1[3]];
  }
  const angle = Math.acos(Math.min(1, d));
  if (Math.abs(angle) < EPS) return [...q0];
  const isin = 1 / Math.sin(angle);
  const s0 = Math.sin((1 - fraction) * angle) * isin;
  const s1 = Math.sin(fraction * angle) * isin;
  return [q0[0] * s0 + b[0] * s1, q0[1] * s0 + b[1] * s1, q0[2] * s0 + b[2] * s1, q0[3] * s0 + b[3] * s1];
}

/** Port of transformations.quaternion_multiply(q1, q0): the rotation q0 followed by q1. */
export function quatMultiply(q1: Quat, q0: Quat): Quat {
  const [w0, x0, y0, z0] = q0;
  const [w1, x1, y1, z1] = q1;
  return [
    -x1 * x0 - y1 * y0 - z1 * z0 + w1 * w0,
    x1 * w0 + y1 * z0 - z1 * y0 + w1 * x0,
    -x1 * z0 + y1 * w0 + z1 * x0 + w1 * y0,
    x1 * y0 - y1 * x0 + z1 * w0 + w1 * z0,
  ];
}

/** Column-major 3x3 rotation matrix of a unit quaternion. */
export function quatToMat3(q: Quat): Float64Array {
  const [w, x, y, z] = q;
  const n = w * w + x * x + y * y + z * z;
  const s = n > 0 ? 2 / n : 0;
  const xx = x * x * s, yy = y * y * s, zz = z * z * s;
  const xy = x * y * s, xz = x * z * s, yz = y * z * s;
  const wx = w * x * s, wy = w * y * s, wz = w * z * s;
  return Float64Array.of(1 - yy - zz, xy + wz, xz - wy, xy - wz, 1 - xx - zz, yz + wx, xz + wy, yz - wx, 1 - xx - yy);
}

export class FacePoseUnits {
  readonly names: readonly string[];
  private readonly units: ReadonlyMap<string, ReadonlyMap<string, Quat>>;

  constructor(doc: PoseUnitsDocument) {
    if (doc.format !== 'ps2cc.poseunits/1') throw new Error(`unsupported pose units format ${String(doc.format)}`);
    this.names = doc.units.map((u) => u.name);
    this.units = new Map(doc.units.map((u) => [u.name, new Map(Object.entries(u.bones))]));
  }

  static async load(source: AssetSource): Promise<FacePoseUnits> {
    return new FacePoseUnits(await readJson<PoseUnitsDocument>(source, POSE_UNITS_FILE));
  }

  has(name: string): boolean {
    return this.units.has(name);
  }

  /** Bones posed by a unit. */
  bones(name: string): string[] {
    return [...(this.units.get(name)?.keys() ?? [])];
  }

  /**
   * Blend unit poses (in the given order) into one rotation per posed bone.
   * Bones no unit poses are left out (they stay at rest).
   */
  blend(blend: readonly (readonly [string, number])[]): Map<string, Quat> {
    const out = new Map<string, Quat>();
    if (blend.length === 0) return out;
    const units = blend.map(([name, w]) => {
      const u = this.units.get(name);
      if (!u) throw new Error(`unknown face pose unit ${name}`);
      return [u, w] as const;
    });
    const bones = new Set<string>();
    for (const [u] of units) for (const b of u.keys()) bones.add(b);
    for (const bone of bones) {
      let quat: Quat | null = null;
      for (const [u, w] of units) {
        const q = quatSlerp(IDENTITY, u.get(bone) ?? IDENTITY, w);
        quat = quat === null ? q : quatMultiply(q, quat);
      }
      out.set(bone, quat!);
    }
    return out;
  }
}
