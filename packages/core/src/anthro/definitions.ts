/**
 * The measurements (PRD Part 3, F24): what each one is and how it is taken.
 * All are taken on the rest shape (arms down at about 45 degrees), in
 * centimetres unless the unit says otherwise.
 *
 * Methods:
 * - `extent`: highest minus lowest point of the body.
 * - `tape`: the body is cut by a plane, and the perimeter of the convex hull
 *   of the cut is measured, as a tape measure bridges hollows. The plane is
 *   the least-squares plane through the ring's vertices, except bust,
 *   underbust and hips, which tailors measure parallel to the floor: there
 *   the plane is horizontal, through the bust points, the ring's centre and
 *   the seat points.
 * - `back arc`: the part of that hull behind the two side points.
 * - `geodesic`: distance along the skin between two landmarks.
 * - `straight`: distance in a straight line; `vertical`: height difference.
 */

export type MeasureUnit = 'cm' | 'deg' | 'kg' | 'l' | 'bmi';
export type MeasureGroup = 'Height and weight' | 'Circumferences' | 'Lengths' | 'Widths' | 'Angles';

export interface MeasureDef {
  id: MeasureId;
  label: string;
  unit: MeasureUnit;
  group: MeasureGroup;
  method: 'extent' | 'tape' | 'back arc' | 'geodesic' | 'straight' | 'vertical' | 'volume' | 'angle';
  /** How it is taken, for the Help text and the docs. */
  how: string;
  /** May be given as a target for the measurement solve. */
  target: boolean;
  /** Shown in the short readout on the Body tab. */
  key?: boolean;
}

export const MEASURE_IDS = [
  'height',
  'mass',
  'bmi',
  'volume',
  'neck',
  'bust',
  'underbust',
  'waist',
  'hips',
  'thigh',
  'knee',
  'calf',
  'ankle',
  'upperArm',
  'wrist',
  'head',
  'armLength',
  'inseam',
  'waistLine',
  'bustLine',
  'waistOverBust',
  'vertBustLine',
  'hipLine',
  'crotchHipDiff',
  'armscyeDepth',
  'headLength',
  'shoulderWidth',
  'backWidth',
  'waistBackWidth',
  'hipBackWidth',
  'neckWidth',
  'bustPoints',
  'seatPoints',
  'shoulderInclination',
  'hipInclination',
  'armPoseAngle',
] as const;
export type MeasureId = (typeof MEASURE_IDS)[number];

export type Measurements = Record<MeasureId, number>;

export const MEASURES: readonly MeasureDef[] = [
  { id: 'height', label: 'Height', unit: 'cm', group: 'Height and weight', method: 'extent', how: 'Top of the head to the soles.', target: true, key: true },
  { id: 'mass', label: 'Weight', unit: 'kg', group: 'Height and weight', method: 'volume', how: 'Body volume times 985 kg per cubic metre.', target: true, key: true },
  { id: 'bmi', label: 'BMI', unit: 'bmi', group: 'Height and weight', method: 'volume', how: 'Weight in kg divided by height in metres squared.', target: false, key: true },
  { id: 'volume', label: 'Volume', unit: 'l', group: 'Height and weight', method: 'volume', how: 'Volume enclosed by the skin.', target: false },
  { id: 'neck', label: 'Neck', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round the middle of the neck.', target: true },
  { id: 'bust', label: 'Chest / bust', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Level with the floor, through the bust points.', target: true, key: true },
  { id: 'underbust', label: 'Underbust', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Level with the floor, just under the bust.', target: true },
  { id: 'waist', label: 'Waist', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Between the ribs and the hip bones.', target: true, key: true },
  { id: 'hips', label: 'Hips', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Level with the floor, through the fullest part of the seat.', target: true, key: true },
  { id: 'thigh', label: 'Thigh', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round the top of one thigh (mean of both).', target: true },
  { id: 'knee', label: 'Knee', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round one knee (mean of both).', target: true },
  { id: 'calf', label: 'Calf', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round the fullest part of one calf (mean of both).', target: true },
  { id: 'ankle', label: 'Ankle', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round one ankle (mean of both).', target: true },
  { id: 'upperArm', label: 'Upper arm', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round the middle of one upper arm (mean of both).', target: true },
  { id: 'wrist', label: 'Wrist', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round one wrist (mean of both).', target: true },
  { id: 'head', label: 'Head', unit: 'cm', group: 'Circumferences', method: 'tape', how: 'Round the brow and the back of the skull.', target: false },
  { id: 'armLength', label: 'Arm length', unit: 'cm', group: 'Lengths', method: 'straight', how: 'Shoulder tip to elbow to wrist, two straight lines (mean of both arms).', target: true },
  { id: 'inseam', label: 'Inseam', unit: 'cm', group: 'Lengths', method: 'vertical', how: 'Crotch to the floor.', target: true },
  { id: 'waistLine', label: 'Nape to waist', unit: 'cm', group: 'Lengths', method: 'geodesic', how: 'Down the back from the nape of the neck to the waist, along the skin.', target: true },
  { id: 'bustLine', label: 'Shoulder to bust point', unit: 'cm', group: 'Lengths', method: 'geodesic', how: 'From the side of the neck base to the bust point, along the skin (mean of both sides).', target: false },
  { id: 'waistOverBust', label: 'Neck to waist over the bust', unit: 'cm', group: 'Lengths', method: 'geodesic', how: 'Shoulder to bust point along the skin, then straight to the waist as a tape bridges the hollow under the bust.', target: false },
  { id: 'vertBustLine', label: 'Nape to bust level', unit: 'cm', group: 'Lengths', method: 'vertical', how: 'Height of the nape above the bust line.', target: false },
  { id: 'hipLine', label: 'Waist to hip', unit: 'cm', group: 'Lengths', method: 'vertical', how: 'Height of the waist above the hip line.', target: true },
  { id: 'crotchHipDiff', label: 'Hip to crotch', unit: 'cm', group: 'Lengths', method: 'vertical', how: 'Height of the hip line above the crotch.', target: false },
  { id: 'armscyeDepth', label: 'Armscye depth', unit: 'cm', group: 'Lengths', method: 'vertical', how: 'Height of the shoulder tip above the bottom of the underarm (mean of both sides).', target: false },
  { id: 'headLength', label: 'Nape to top of head', unit: 'cm', group: 'Lengths', method: 'vertical', how: 'Height of the top of the head above the nape, so that height minus this minus nape-to-waist is the waist level.', target: false },
  { id: 'shoulderWidth', label: 'Shoulder width', unit: 'cm', group: 'Widths', method: 'straight', how: 'Straight between the two shoulder tips.', target: true },
  { id: 'backWidth', label: 'Back width', unit: 'cm', group: 'Widths', method: 'back arc', how: 'Round the back at bust level, from one side of the body to the other.', target: false },
  { id: 'waistBackWidth', label: 'Waist back width', unit: 'cm', group: 'Widths', method: 'back arc', how: 'Round the back at the waist, from one side to the other.', target: false },
  { id: 'hipBackWidth', label: 'Hip back width', unit: 'cm', group: 'Widths', method: 'back arc', how: 'Round the back at hip level, from one side to the other.', target: false },
  { id: 'neckWidth', label: 'Neck base width', unit: 'cm', group: 'Widths', method: 'geodesic', how: 'Round the back of the neck base, from one side to the other, along the skin.', target: false },
  { id: 'bustPoints', label: 'Bust point distance', unit: 'cm', group: 'Widths', method: 'straight', how: 'Straight between the two bust points.', target: false },
  { id: 'seatPoints', label: 'Seat point distance', unit: 'cm', group: 'Widths', method: 'straight', how: 'Straight between the two fullest points of the seat.', target: false },
  { id: 'shoulderInclination', label: 'Shoulder slope', unit: 'deg', group: 'Angles', method: 'angle', how: 'Angle below level of the line from the side of the neck base to the shoulder tip, seen from the front.', target: false },
  { id: 'hipInclination', label: 'Hip slope', unit: 'deg', group: 'Angles', method: 'angle', how: 'Angle from upright of the side of the body between waist and hip.', target: false },
  { id: 'armPoseAngle', label: 'Arm pose angle', unit: 'deg', group: 'Angles', method: 'angle', how: 'Angle below level of the upper arm, seen from the front (0 is a T-pose).', target: false },
];

export const MEASURE_BY_ID: ReadonlyMap<MeasureId, MeasureDef> = new Map(MEASURES.map((m) => [m.id, m]));

/** Density used for body mass, kg per cubic metre. */
export const BODY_DENSITY = 985;

export const CM_PER_INCH = 2.54;

/** A measurement as text in centimetres or inches (angles, kg and BMI are not converted). */
export function formatMeasure(id: MeasureId, value: number, inches: boolean): string {
  const def = MEASURE_BY_ID.get(id)!;
  if (def.unit === 'cm') return inches ? `${(value / CM_PER_INCH).toFixed(1)} in` : `${value.toFixed(1)} cm`;
  if (def.unit === 'deg') return `${value.toFixed(1)}°`;
  if (def.unit === 'kg') return `${value.toFixed(1)} kg`;
  if (def.unit === 'l') return `${value.toFixed(1)} l`;
  return value.toFixed(1);
}

/** GarmentCode's body-measurement keys (its `assets/bodies/*.yaml`), from our measurements. */
export function garmentCodeBody(m: Measurements): Record<string, number> {
  return {
    arm_length: m.armLength,
    arm_pose_angle: m.armPoseAngle,
    armscye_depth: m.armscyeDepth,
    back_width: m.backWidth,
    bum_points: m.seatPoints,
    bust: m.bust,
    bust_line: m.bustLine,
    bust_points: m.bustPoints,
    crotch_hip_diff: m.crotchHipDiff,
    head_l: m.headLength,
    height: m.height,
    hip_back_width: m.hipBackWidth,
    hip_inclination: m.hipInclination,
    hips: m.hips,
    hips_line: m.hipLine,
    leg_circ: m.thigh,
    neck_w: m.neckWidth,
    shoulder_incl: m.shoulderInclination,
    shoulder_w: m.shoulderWidth,
    underbust: m.underbust,
    vert_bust_line: m.vertBustLine,
    waist: m.waist,
    waist_back_width: m.waistBackWidth,
    waist_line: m.waistLine,
    waist_over_bust_line: m.waistOverBust,
    wrist: m.wrist,
  };
}
