/**
 * Face points placed by hand (PRD Part 3, F33): the 68 points of the iBUG
 * 300-W convention (jaw 0-16, brows 17-26, nose 27-35, eyes 36-47, lips
 * 48-67), for photos where MediaPipe finds no face, and to correct detected
 * points. Each is matched to the MediaPipe landmark at the same place, so the
 * projection uses them like detected landmarks (the others are left out).
 *
 * The mapping follows the usual MediaPipe-to-68 correspondence; iBUG 4, 5, 11
 * and 12 (the lower jaw) use MediaPipe 215, 138, 367 and 435, the nearest
 * jaw-line landmarks PS2CC's landmark table maps (checked on the default face).
 */
import { LANDMARK_COUNT, landmarkPoint, type LandmarkTable } from './project';

export const IBUG_COUNT = 68;

/** MediaPipe landmark index of each iBUG point. */
export const IBUG_TO_MEDIAPIPE: readonly number[] = [
  // Jaw, from the right ear (image left) to the left ear.
  127, 234, 93, 132, 215, 138, 136, 150, 152, 379, 365, 367, 435, 361, 323, 454, 356,
  // Brows: right, then left.
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
  // Nose bridge, then the base from right to left.
  168, 197, 5, 4, 75, 97, 2, 326, 305,
  // Eyes: right (outer corner first), then left (inner corner first).
  33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
  // Outer lips, then inner lips.
  61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181, 78, 82, 13, 312, 308, 317, 14, 87,
];

/** The iBUG point on the other side of the face (itself on the midline). */
export const IBUG_MIRROR: readonly number[] = [
  16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
  27, 28, 29, 30, 35, 34, 33, 32, 31,
  45, 44, 43, 42, 47, 46, 39, 38, 37, 36, 41, 40,
  54, 53, 52, 51, 50, 49, 48, 59, 58, 57, 56, 55, 64, 63, 62, 61, 60, 67, 66, 65,
];

/** Names of the point groups, for the editor. */
export const IBUG_GROUPS: readonly { name: string; from: number; to: number; closed: boolean }[] = [
  { name: 'Jaw', from: 0, to: 17, closed: false },
  { name: 'Right brow', from: 17, to: 22, closed: false },
  { name: 'Left brow', from: 22, to: 27, closed: false },
  { name: 'Nose', from: 27, to: 31, closed: false },
  { name: 'Nostrils', from: 31, to: 36, closed: false },
  { name: 'Right eye', from: 36, to: 42, closed: true },
  { name: 'Left eye', from: 42, to: 48, closed: true },
  { name: 'Lips', from: 48, to: 60, closed: true },
  { name: 'Mouth opening', from: 60, to: 68, closed: true },
];

/**
 * Hand-placed points (x, y per point, 0..1 of the photo, y down) as MediaPipe
 * landmarks: 478 x (x, y, z), NaN where no point was placed.
 */
export function expandIbug(points: ArrayLike<number>): number[] {
  const out = new Array<number>(LANDMARK_COUNT * 3).fill(Number.NaN);
  for (let k = 0; k < IBUG_COUNT; k++) {
    const x = points[k * 2];
    const y = points[k * 2 + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const i = IBUG_TO_MEDIAPIPE[k]!;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = 0;
  }
  return out;
}

/** A photo's landmarks as 478 MediaPipe landmarks: detected ones as they are, hand-placed ones expanded. */
export function photoLandmarks(spec: { landmarks?: number[]; landmarkSet?: 'mediapipe' | 'ibug68' } | null | undefined): number[] | null {
  if (!spec?.landmarks) return null;
  return spec.landmarkSet === 'ibug68' ? expandIbug(spec.landmarks) : spec.landmarks;
}

/** The iBUG points of detected MediaPipe landmarks (x, y per point), to start the editor from. */
export function ibugFromMediapipe(landmarks: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (const i of IBUG_TO_MEDIAPIPE) out.push(landmarks[i * 3]!, landmarks[i * 3 + 1]!);
  return out;
}

/**
 * The 68 points of the current head seen from the front, scaled so the face
 * (jaw ends) is 1 wide and centred on 0: a template to drop on a photo where
 * no face was found. y points down, like image coordinates.
 */
export function ibugTemplate(table: LandmarkTable, positions: ArrayLike<number>): number[] {
  const pts: [number, number][] = [];
  for (const i of IBUG_TO_MEDIAPIPE) {
    const p = landmarkPoint(table, i, positions);
    pts.push(p ? [p[0], p[1]] : [Number.NaN, Number.NaN]);
  }
  // The character's left (+x) is on the image's right in a front photo.
  const xs = pts.map((p) => p[0]).filter(Number.isFinite);
  const ys = pts.map((p) => p[1]).filter(Number.isFinite);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(...xs) - Math.min(...xs) || 1;
  const out: number[] = [];
  for (const [x, y] of pts) out.push((x - cx) / width, -(y - cy) / width);
  return out;
}

/** Place a template (from ibugTemplate) on a photo: centre and face width in photo fractions. */
export function placeTemplate(template: ArrayLike<number>, cx: number, cy: number, width: number, aspect: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < IBUG_COUNT; k++) out.push(cx + template[k * 2]! * width, cy + template[k * 2 + 1]! * width * aspect);
  return out;
}
