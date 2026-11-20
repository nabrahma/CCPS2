/**
 * The part of SciPy's `scipy.spatial.transform.Rotation` GarmentCode uses: quaternions composed from elementary
 * rotations (`from_euler`), `from_rotvec`, composition, `apply`, the matrix, and `as_euler` by SciPy's algorithm
 * (Bernardes and Viollet, 2022). Quaternions are scalar-last `[x, y, z, w]` as in SciPy. dmath only.
 */
import { atan2, cos, PI, sin } from '../../../math/dmath';

export type Quat = [number, number, number, number];
export type V3 = [number, number, number];

const deg2rad = (d: number): number => d * (PI / 180);
const rad2deg = (r: number): number => r * (180 / PI);
const hypot2 = (a: number, b: number): number => Math.sqrt(a * a + b * b);

function compose(p: Quat, q: Quat): Quat {
  const c0 = p[1] * q[2] - p[2] * q[1];
  const c1 = p[2] * q[0] - p[0] * q[2];
  const c2 = p[0] * q[1] - p[1] * q[0];
  return [
    p[3] * q[0] + q[3] * p[0] + c0,
    p[3] * q[1] + q[3] * p[1] + c1,
    p[3] * q[2] + q[3] * p[2] + c2,
    p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
  ];
}

function elementary(axis: number, angle: number): Quat {
  const q: Quat = [0, 0, 0, cos(angle / 2)];
  q[axis] = sin(angle / 2);
  return q;
}

const AXIS: Record<string, number> = { x: 0, y: 1, z: 2 };

export class Rotation {
  /** Immutable: a deep copy may share it (see pattern/utils deepcopy). */
  readonly deepcopyShare = true;
  private constructor(readonly quat: Quat) {}

  static fromQuat(q: Quat, normalize = true): Rotation {
    if (!normalize) return new Rotation([q[0], q[1], q[2], q[3]]);
    const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    return new Rotation([q[0] / n, q[1] / n, q[2] / n, q[3] / n]);
  }

  static identity(): Rotation {
    return new Rotation([0, 0, 0, 1]);
  }

  /** SciPy from_euler: upper-case sequences are intrinsic, lower-case extrinsic. */
  static fromEuler(seq: string, angles: readonly number[], degrees = false): Rotation {
    const intrinsic = seq === seq.toUpperCase();
    const s = seq.toLowerCase();
    const a = degrees ? angles.map(deg2rad) : angles.slice();
    let r = elementary(AXIS[s[0]!]!, a[0]!);
    for (let i = 1; i < s.length; i++) {
      const e = elementary(AXIS[s[i]!]!, a[i]!);
      r = intrinsic ? compose(r, e) : compose(e, r);
    }
    return new Rotation(r);
  }

  static fromRotvec(v: readonly number[]): Rotation {
    const angle = Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!);
    let scale: number;
    if (angle <= 1e-3) {
      const a2 = angle * angle;
      scale = 0.5 - a2 / 48 + (a2 * a2) / 3840;
    } else scale = sin(angle / 2) / angle;
    return new Rotation([scale * v[0]!, scale * v[1]!, scale * v[2]!, cos(angle / 2)]);
  }

  /** this * other: apply other first, then this (SciPy semantics); the result is normalised. */
  mul(other: Rotation): Rotation {
    return Rotation.fromQuat(compose(this.quat, other.quat), true);
  }

  matrix(): [V3, V3, V3] {
    const [x, y, z, w] = this.quat;
    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;
    const w2 = w * w;
    const xy = x * y;
    const zw = z * w;
    const xz = x * z;
    const yw = y * w;
    const yz = y * z;
    const xw = x * w;
    return [
      [x2 - y2 - z2 + w2, 2 * (xy - zw), 2 * (xz + yw)],
      [2 * (xy + zw), -x2 + y2 - z2 + w2, 2 * (yz - xw)],
      [2 * (xz - yw), 2 * (yz + xw), -x2 - y2 + z2 + w2],
    ];
  }

  apply(v: readonly number[]): V3 {
    const m = this.matrix();
    const p: V3 = [v[0]!, v[1]!, v[2] ?? 0];
    return [m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2], m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2], m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2]];
  }

  /** SciPy as_euler (quaternion algorithm, SciPy >= 1.11): Tait-Bryan middle angle in [-90, 90] degrees. */
  asEuler(seq: string, degrees = false): V3 {
    const extrinsic = seq !== seq.toUpperCase();
    let s = seq.toLowerCase();
    if (!extrinsic) s = s.split('').reverse().join('');
    const i = AXIS[s[0]!]!;
    const j = AXIS[s[1]!]!;
    let k = AXIS[s[2]!]!;
    const isProper = i === k;
    if (isProper) k = 3 - i - j;
    const sign = ((i - j) * (j - k) * (k - i)) / 2;
    const q = this.quat;
    let a: number;
    let b: number;
    let c: number;
    let d: number;
    if (isProper) {
      a = q[3];
      b = q[i]!;
      c = q[j]!;
      d = q[k]! * sign;
    } else {
      a = q[3] - q[j]!;
      b = q[i]! + q[k]! * sign;
      c = q[j]! + q[3];
      d = q[k]! * sign - q[i]!;
    }
    // SciPy writes the regular case straight into the reversed slots for intrinsic sequences; the degenerate
    // (gimbal lock) case always zeroes the last slot.
    const first = extrinsic ? 0 : 2;
    const third = extrinsic ? 2 : 0;
    const ang: V3 = [0, 2 * atan2(hypot2(c, d), hypot2(a, b)), 0];
    const eps = 1e-7;
    let kase = 0;
    if (Math.abs(ang[1]) <= eps) kase = 1;
    else if (Math.abs(ang[1] - PI) <= eps) kase = 2;
    const halfSum = atan2(b, a);
    const halfDiff = atan2(d, c);
    if (kase === 0) {
      ang[first] = halfSum - halfDiff;
      ang[third] = halfSum + halfDiff;
    } else {
      ang[2] = 0;
      ang[0] = kase === 1 ? 2 * halfSum : 2 * halfDiff * (extrinsic ? -1 : 1);
    }
    if (!isProper) {
      ang[third] *= sign;
      ang[1] -= PI / 2;
    }
    for (let n = 0; n < 3; n++) {
      const v = ang[n]!;
      if (v < -PI) ang[n] = v + 2 * PI;
      else if (v > PI) ang[n] = v - 2 * PI;
    }
    return degrees ? [rad2deg(ang[0]), rad2deg(ang[1]), rad2deg(ang[2])] : ang;
  }
}
