/**
 * Body landmarks for anthropometry (PRD Part 3, F24): named vertex sets on
 * hm08, from `assets/core/anthro/landmarks.json` (built by the asset
 * compiler's `anthro` stage). Left is +X, the character's own left.
 */

export interface RingDef {
  /** Vertices of the loop, on the body. */
  vertices: number[];
  /** Limb rings are the left side's; `mirror` is the same loop on the right. */
  side?: 'l';
  mirror?: number[];
}

export interface LandmarkFile {
  format: 'ps2cc.anthro-landmarks/1';
  rings: Record<RingName, RingDef>;
  points: Record<PointName, number>;
  pairs: Record<PairName, { l: number; r: number }>;
}

export const RING_NAMES = ['neck', 'bust', 'underbust', 'waist', 'hips', 'thigh', 'knee', 'calf', 'ankle', 'upperArm', 'wrist', 'head'] as const;
export type RingName = (typeof RING_NAMES)[number];

export const POINT_NAMES = ['crown', 'nape', 'noseTip', 'brow', 'occiput', 'crotch', 'waistBack', 'waistFront', 'hipFront'] as const;
export type PointName = (typeof POINT_NAMES)[number];

export const PAIR_NAMES = [
  'shoulderTip',
  'neckSide',
  'armpit',
  'elbow',
  'wrist',
  'bustPoint',
  'seatPoint',
  'waistFrontUnderBust',
  'kneeTop',
  'ankle',
  'heel',
] as const;
export type PairName = (typeof PAIR_NAMES)[number];

/** Check a landmark file against the mesh it is for; throws with the first problem found. */
export function validateLandmarks(file: LandmarkFile, bodyVertexCount: number): LandmarkFile {
  if (file.format !== 'ps2cc.anthro-landmarks/1') throw new Error(`landmarks: unknown format ${String(file.format)}`);
  const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < bodyVertexCount;
  for (const name of RING_NAMES) {
    const ring = file.rings[name];
    if (!ring || ring.vertices.length < 8 || !ring.vertices.every(ok)) throw new Error(`landmarks: ring "${name}" is missing or leaves the body`);
    if (ring.mirror && (ring.mirror.length !== ring.vertices.length || !ring.mirror.every(ok))) throw new Error(`landmarks: ring "${name}" has a bad mirror`);
  }
  for (const name of POINT_NAMES) if (!ok(file.points[name])) throw new Error(`landmarks: point "${name}" is missing`);
  for (const name of PAIR_NAMES) {
    const p = file.pairs[name];
    if (!p || !ok(p.l) || !ok(p.r)) throw new Error(`landmarks: paired point "${name}" is missing`);
  }
  return file;
}
