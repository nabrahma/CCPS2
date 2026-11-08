/**
 * Photo checks before projection (PRD F7 step 7): warn when the face is not
 * frontal (yaw or pitch over 10°) or the lighting is very uneven.
 */
import { sampleBilinear, type RgbaImage } from '../image';
import { rgbToLab } from './colour';

/** MediaPipe Face Mesh landmark indices used here. */
export const LM = {
  faceLeft: 234, // image left edge of the face oval (the subject's right)
  faceRight: 454,
  forehead: 10,
  chin: 152,
  noseTip: 1,
  cheekLeft: 205, // image left
  cheekRight: 425,
  eyeOuterLeft: 33,
  eyeInnerLeft: 133,
  eyeInnerRight: 362,
  eyeOuterRight: 263,
  mouthLeft: 61,
  mouthRight: 291,
  lipTop: 0,
  lipBottom: 17,
} as const;

export const MAX_YAW_PITCH = 10;
export const MAX_LIGHT_DELTA = 18; // L* units between the two cheeks

export interface PhotoCheck {
  yaw: number;
  pitch: number;
  /** L* difference between the left and right cheek. */
  lightingDelta: number;
  /** Mean L* of the face. */
  brightness: number;
  warnings: string[];
}

/** Landmark i in pixels (z scaled like x, as MediaPipe documents). */
export function landmarkPx(landmarks: ArrayLike<number>, i: number, width: number, height: number): [number, number, number] {
  return [landmarks[i * 3]! * width, landmarks[i * 3 + 1]! * height, landmarks[i * 3 + 2]! * width];
}

/** Head yaw and pitch in degrees from the face oval's plane (0, 0 = looking straight at the camera). */
export function headAngles(landmarks: ArrayLike<number>, width: number, height: number): { yaw: number; pitch: number } {
  const P = (i: number) => landmarkPx(landmarks, i, width, height);
  const l = P(LM.faceLeft);
  const r = P(LM.faceRight);
  const t = P(LM.forehead);
  const b = P(LM.chin);
  const h = [r[0] - l[0], r[1] - l[1], r[2] - l[2]];
  const v = [b[0] - t[0], b[1] - t[1], b[2] - t[2]];
  const n = [h[1]! * v[2]! - h[2]! * v[1]!, h[2]! * v[0]! - h[0]! * v[2]!, h[0]! * v[1]! - h[1]! * v[0]!];
  const deg = 180 / Math.PI;
  return { yaw: Math.atan2(n[0]!, n[2]!) * deg, pitch: Math.atan2(n[1]!, n[2]!) * deg };
}

/**
 * Head yaw and pitch in degrees from MediaPipe's facial transformation matrix
 * (4x4, column-major, canonical face model to camera): the direction the face's
 * forward axis points. Preferred over headAngles(), whose face-oval plane is
 * not perpendicular to the view even on a straight-on face (about 20° of pitch).
 */
export function anglesFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number } {
  // Third column: the canonical +Z (out of the face) in camera space.
  const fx = m[8]!;
  const fy = m[9]!;
  const fz = m[10]!;
  const deg = 180 / Math.PI;
  return { yaw: Math.atan2(fx, fz) * deg, pitch: Math.atan2(-fy, Math.hypot(fx, fz)) * deg };
}

/** Pose and lighting check; `angles` from anglesFromMatrix() when the detector gave a matrix. */
export function checkPhoto(photo: RgbaImage, landmarks: ArrayLike<number>, angles?: { yaw: number; pitch: number }): PhotoCheck {
  const { width: w, height: h } = photo;
  const { yaw, pitch } = angles ?? headAngles(landmarks, w, h);
  const P = (i: number) => landmarkPx(landmarks, i, w, h);
  const faceWidth = Math.hypot(P(LM.faceRight)[0] - P(LM.faceLeft)[0], P(LM.faceRight)[1] - P(LM.faceLeft)[1]);
  const radius = Math.max(2, faceWidth * 0.08);
  const tmp = [0, 0, 0, 0];
  const meanL = (c: [number, number, number]) => {
    let sum = 0;
    let n = 0;
    for (let dy = -radius; dy <= radius; dy += Math.max(1, radius / 6)) {
      for (let dx = -radius; dx <= radius; dx += Math.max(1, radius / 6)) {
        if (dx * dx + dy * dy > radius * radius) continue;
        sampleBilinear(photo, (c[0] + dx) / w, 1 - (c[1] + dy) / h, tmp);
        sum += rgbToLab(tmp[0]!, tmp[1]!, tmp[2]!)[0];
        n++;
      }
    }
    return sum / Math.max(1, n);
  };
  const left = meanL(P(LM.cheekLeft));
  const right = meanL(P(LM.cheekRight));
  const lightingDelta = Math.abs(left - right);
  const brightness = (left + right) / 2;
  const warnings: string[] = [];
  if (Math.abs(yaw) > MAX_YAW_PITCH) warnings.push(`The face is turned ${Math.abs(yaw).toFixed(0)}° to the side; use a straight-on photo (under ${MAX_YAW_PITCH}°).`);
  if (Math.abs(pitch) > MAX_YAW_PITCH) warnings.push(`The face is tilted ${Math.abs(pitch).toFixed(0)}° up or down; use a straight-on photo (under ${MAX_YAW_PITCH}°).`);
  if (lightingDelta > MAX_LIGHT_DELTA) warnings.push('The lighting is very uneven (one side of the face is much darker); the texture will keep that shadow.');
  if (brightness < 25) warnings.push('The photo is very dark.');
  return { yaw, pitch, lightingDelta, brightness, warnings };
}
