/**
 * Design groups and registration of this project's programs (F29). Groups use GarmentCode's schema
 * ({v, range, type, default_prob}); each program also fixes some of GarmentCode's sleeve and collar values
 * (a bomber always has long sleeves with a rib cuff, a hoodie always has a hood) and narrows some ranges.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultDesign } from '../design';
import { buildGarment } from '../build';
import { bodyParameters, type Design } from './base';
import { buildBomber, buildCoat, buildHoodie, buildUtilityVest, buildWorkShirt, type TopGarment } from './ps2cc';
import { registerProgram, type PatternProgram } from './registry';

const f = (v: number, lo: number, hi: number, p?: number) => ({ v, range: [lo, hi], type: 'float', ...(p !== undefined ? { default_prob: p } : {}) });
const b = (v: boolean, p = 0.5) => ({ v, range: [true, false], type: 'bool', default_prob: p });

export const PS2CC_GROUPS: Record<string, any> = {
  bomber: {
    length: f(1.25, 1.05, 1.45, 0.3),
    width: f(1.2, 1.08, 1.4, 0.3),
    flare: f(0.98, 0.92, 1.05, 0.5),
    overlap: f(1.5, 0, 3, 0.4),
    hem_band: f(6, 4, 9, 0.4),
    hem_rib: f(0.88, 0.8, 1, 0.4),
    chest_pockets: b(true),
    chest_pocket_w: f(11, 9, 13, 0.5),
    flaps: b(true),
    hip_pockets: b(false, 0.7),
    hip_pocket_w: f(15, 12, 17, 0.5),
  },
  coat: {
    length: f(2.4, 2.0, 2.9, 0.3),
    width: f(1.25, 1.12, 1.45, 0.3),
    flare: f(1.08, 1.0, 1.3, 0.3),
    overlap: f(5, 2, 8, 0.4),
    hip_pockets: b(true, 0.7),
    hip_pocket_w: f(18, 15, 21, 0.5),
    flaps: b(true),
    chest_pockets: b(false, 0.8),
    chest_pocket_w: f(11, 9, 13, 0.5),
  },
  'utility-vest': {
    length: f(1.3, 1.1, 1.5, 0.3),
    width: f(1.2, 1.1, 1.4, 0.3),
    flare: f(1.0, 0.96, 1.08, 0.5),
    overlap: f(1.5, 0, 3, 0.4),
    hem_band: f(0, 0, 5, 0.6),
    hem_rib: f(1, 0.92, 1, 0.6),
    chest_pockets: b(true, 0.7),
    chest_pocket_w: f(12, 10, 14, 0.5),
    hip_pockets: b(true, 0.7),
    hip_pocket_w: f(16, 13, 18, 0.5),
    flaps: b(true),
  },
  hoodie: {
    length: f(1.3, 1.1, 1.5, 0.3),
    width: f(1.18, 1.08, 1.4, 0.3),
    flare: f(1, 0.95, 1.05, 0.5),
    hem_band: f(6, 4, 8, 0.4),
    hem_rib: f(0.9, 0.82, 1, 0.4),
    handwarmer: b(true, 0.7),
  },
  'work-shirt': {
    length: f(1.45, 1.25, 1.7, 0.3),
    width: f(1.12, 1.05, 1.3, 0.3),
    flare: f(1.0, 0.98, 1.08, 0.5),
    overlap: f(1.8, 1.2, 2.5, 0.4),
    yoke: f(9, 6, 12, 0.4),
    chest_pockets: b(true, 0.7),
    chest_pocket_w: f(12, 10, 13.5, 0.5),
    flaps: b(true),
  },
};

interface ProgramDef {
  id: string;
  label: string;
  group: string;
  build: (name: string, body: ReturnType<typeof bodyParameters>, d: Design) => TopGarment;
  /** GarmentCode values the program fixes (path -> value), applied after sampling. */
  fixed: Record<string, unknown>;
  /** GarmentCode values the program re-ranges or re-defaults (path -> leaf fields). */
  overrides: Record<string, Record<string, unknown>>;
}

const LONG_SLEEVE = {
  'sleeve.sleeveless': false,
  'sleeve.armhole_shape': 'ArmholeCurve',
};

export const PS2CC_PROGRAMS: ProgramDef[] = [
  {
    id: 'Bomber',
    label: 'Bomber / blouson jacket',
    group: 'bomber',
    build: buildBomber,
    fixed: { ...LONG_SLEEVE, 'sleeve.cuff.type': 'CuffBand', 'collar.f_collar': 'CircleNeckHalf', 'collar.b_collar': 'CircleNeckHalf' },
    overrides: {
      'sleeve.length': { v: 0.95, range: [0.85, 1.05] },
      'sleeve.end_width': { v: 1.0, range: [0.85, 1.2] },
      'sleeve.cuff.cuff_len': { v: 0.1, range: [0.06, 0.14] },
      'collar.component.style': { v: 'Turtle', range: ['Turtle', 'SimpleLapel', null], default_prob: 0.5 },
      'collar.width': { v: 0.2, range: [0, 0.5] },
      'collar.fc_depth': { v: 0.5, range: [0.3, 0.9] },
      'collar.component.depth': { v: 6, range: [4, 8] },
    },
  },
  {
    id: 'Coat',
    label: 'Coat',
    group: 'coat',
    build: buildCoat,
    fixed: { ...LONG_SLEEVE, 'collar.component.style': 'SimpleLapel', 'collar.b_collar': 'CircleNeckHalf' },
    overrides: {
      'sleeve.length': { v: 1.0, range: [0.9, 1.1] },
      'sleeve.end_width': { v: 1.0, range: [0.9, 1.3] },
      'collar.f_collar': { v: 'VNeckHalf', range: ['VNeckHalf', 'CircleNeckHalf', 'TrapezoidNeckHalf'], default_prob: 0.5 },
      'collar.fc_depth': { v: 1.2, range: [0.8, 1.8] },
      'collar.width': { v: 0.3, range: [0.1, 0.6] },
    },
  },
  {
    id: 'UtilityVest',
    label: 'Utility vest',
    group: 'utility-vest',
    build: buildUtilityVest,
    fixed: { 'sleeve.sleeveless': true, 'collar.component.style': null },
    overrides: {
      'collar.f_collar': { v: 'VNeckHalf', range: ['VNeckHalf', 'CircleNeckHalf', 'SquareNeckHalf'], default_prob: 0.5 },
      'collar.fc_depth': { v: 1.0, range: [0.4, 1.6] },
      'sleeve.armhole_shape': { v: 'ArmholeCurve', range: ['ArmholeCurve', 'ArmholeAngle'], default_prob: 0.7 },
    },
  },
  {
    id: 'Hoodie',
    label: 'Hoodie',
    group: 'hoodie',
    build: buildHoodie,
    fixed: { ...LONG_SLEEVE, 'sleeve.cuff.type': 'CuffBand', 'collar.component.style': 'Hood2Panels', 'collar.f_collar': 'CircleNeckHalf', 'collar.b_collar': 'CircleNeckHalf' },
    overrides: {
      'sleeve.length': { v: 0.95, range: [0.85, 1.05] },
      'sleeve.cuff.cuff_len': { v: 0.1, range: [0.06, 0.14] },
      'collar.width': { v: 0.2, range: [0, 0.4] },
      'collar.fc_depth': { v: 0.4, range: [0.3, 0.7] },
    },
  },
  {
    id: 'WorkShirt',
    label: 'Work shirt',
    group: 'work-shirt',
    build: buildWorkShirt,
    fixed: { ...LONG_SLEEVE, 'collar.component.style': 'Turtle', 'collar.f_collar': 'CircleNeckHalf', 'collar.b_collar': 'CircleNeckHalf' },
    overrides: {
      'sleeve.length': { v: 0.95, range: [0.35, 1.05] },
      'sleeve.cuff.type': { v: 'CuffBand', range: ['CuffBand', null], default_prob: 0.6 },
      'collar.component.depth': { v: 4, range: [3, 5] },
      'collar.width': { v: 0.1, range: [0, 0.3] },
      'collar.fc_depth': { v: 0.35, range: [0.3, 0.6] },
    },
  },
];

function setPath(d: any, path: string, fields: Record<string, unknown>): void {
  const keys = path.split('.');
  let n = d;
  for (const k of keys) n = n[k];
  Object.assign(n, fields);
}

/** The program's default design: GarmentCode's defaults, the program's group and its overrides and fixed values. */
export function ps2ccDefaultDesign(def: ProgramDef): Design {
  const d = defaultDesign();
  d.meta.upper.v = null;
  d.meta.bottom.v = null;
  d.meta.wb.v = null;
  d[def.group] = JSON.parse(JSON.stringify(PS2CC_GROUPS[def.group]));
  for (const [p, fields] of Object.entries(def.overrides)) setPath(d, p, fields);
  for (const [p, v] of Object.entries(def.fixed)) setPath(d, p, { v });
  return d;
}

export function applyFixed(def: ProgramDef, d: Design): void {
  for (const [p, v] of Object.entries(def.fixed)) setPath(d, p, { v });
}

for (const def of PS2CC_PROGRAMS) {
  const prog: PatternProgram = {
    id: def.id,
    label: def.label,
    origin: 'ps2cc',
    meta: { upper: null, bottom: null, wb: null },
    groups: [def.group, 'sleeve', 'collar'],
    defaultDesign: () => ps2ccDefaultDesign(def),
    fix: (d) => applyFixed(def, d),
    build: (name, design, measurements) => buildGarment(def.build(name, bodyParameters(measurements), design)),
  };
  registerProgram(prog);
}
