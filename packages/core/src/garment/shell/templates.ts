/**
 * Shell garment templates (PRD Part 3, F28): each is a small parameter schema
 * and a function from parameters to a generator spec, written against the
 * reference body's landmarks. Tops, bottoms, hands and feet, and head pieces;
 * accessories (sweeps) are in `accessories.ts`.
 *
 * Defaults follow the era look of section 5.0 and the user's reference
 * characters: a little oversized, thick at the edges, straight trouser legs,
 * chunky soles.
 */
import { alongBone, SEG, type ShellBody, type ShellTier } from './body';
import { CLASS_MIN_EASE, GENERATED_SHARE, type BandSpec, type GarmentClass, type LoftSpec, type ShellSpec } from './build';
import type { Constraint } from './cut';
import { buildBelt, buildLimbBands, buildStrap } from './accessories';
import { buildBootsWithin } from './boots';
import { buildGlovesWithin } from './gloves';
import { SLOT_BUDGET } from '../../proxy/decimate';
import type { WorkMesh } from './mesh';
import { angleOf, dcos, landmarks, perpendicular, SIDES, type Landmarks, type Side } from './landmarks';
import type { ImportSlot } from '../../proxy/garment-import';
import { add, cross, dot, len, normalize, sub, type Vec3 } from './vec';

export type ParamKind = 'slider' | 'toggle' | 'choice';
export type ParamUnit = 'mm' | 'cm' | '%' | '';

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  min: number;
  max: number;
  step: number;
  unit: ParamUnit;
  default: number;
  /** Choice labels (the value is the index). */
  choices?: string[];
  help?: string;
}

export type ShellParams = Record<string, number>;
export type ShellCategory = 'tops' | 'bottoms' | 'hands-feet' | 'head' | 'accessories';

/** How a generated garment is dressed when it is first put on (an M15 look). */
export interface LookHint {
  material: string;
  tint: [number, number, number];
}

export interface ShellTemplate {
  id: string;
  name: string;
  category: ShellCategory;
  slot: ImportSlot;
  garmentClass: GarmentClass;
  look: LookHint;
  params: ParamDef[];
  /** Body tier the shell is cut from (default: the 12k tier). */
  tier?: ShellTier;
  /** The generator spec for these parameters (shell templates). */
  spec?: (body: ShellBody, p: ShellParams) => ShellSpec;
}

const mm = (v: number) => v / 1000;
const cm = (v: number) => v / 100;
const pct = (v: number) => v / 100;

const slider = (key: string, label: string, min: number, max: number, step: number, unit: ParamUnit, def: number, help?: string): ParamDef => ({ key, label, kind: 'slider', min, max, step, unit, default: def, help });
const toggle = (key: string, label: string, def: 0 | 1, help?: string): ParamDef => ({ key, label, kind: 'toggle', min: 0, max: 1, step: 1, unit: '', default: def, help });
const choice = (key: string, label: string, choices: string[], def: number): ParamDef => ({ key, label, kind: 'choice', min: 0, max: choices.length - 1, step: 1, unit: '', default: def, choices });

/** Parameters with every missing or out-of-range value replaced by the template's default (clamped). */
export function resolveParams(t: ShellTemplate, raw: Readonly<Record<string, unknown>> = {}): ShellParams {
  const out: ShellParams = {};
  for (const d of t.params) {
    const v = raw[d.key];
    let x = typeof v === 'number' && Number.isFinite(v) ? v : d.default;
    x = Math.min(d.max, Math.max(d.min, x));
    if (d.kind !== 'slider') x = Math.round(x);
    out[d.key] = x;
  }
  return out;
}

const sideSign = (s: Side) => (s === 'l' ? 1 : -1);
/** The cylinder smoothing's strength for a smoothness setting (60% and up: full). */
const smoothStrength = (smoothness: number) => Math.min(1, 0.3 + (1.2 * smoothness) / 100);
const segOf = (name: string): number => SEG[name as keyof typeof SEG];

// ------------------------------------------------------------------ shared pieces

const NECKLINES = ['Crew', 'Scoop', 'V-neck', 'Roll-neck', 'Mock neck'];

/** Neckline field: keep below a line around the neck ring, lowered or raised by style. */
function necklineConstraint(L: Landmarks, kind: number, depth: number, rollHeight: number): Constraint {
  const c = L.neck.centre;
  return {
    id: 'neck',
    segments: [SEG.torso, SEG.neck],
    value: (p) => {
      const a = angleOf(p[0] - c[0], p[2] - c[2]);
      const front = Math.max(0, dcos(a));
      let line = L.neck.base(a);
      if (kind === 0) line += 0.004 - 0.01 * front * front;
      else if (kind === 1) line -= depth * front * front * front;
      else if (kind === 2) {
        // A V at the front that meets the neck's base line tangentially (no corner where the two join).
        const half = 0.95;
        const t = Math.min(1, Math.abs(a) / half);
        line -= depth * (1 - t) * (1 - t) * (1 + t);
      } else if (kind === 3) line += rollHeight * (1 - 0.35 * front);
      else line += 0.025 * (1 - 0.4 * front);
      return line - p[1];
    },
  };
}

/** Is a triangle centre on the sleeve side of the armhole seam? (A plane through the shoulder joint, across the arm.) */
function sleeveSide(L: Landmarks, s: Side, c: Vec3): boolean {
  const a = L.arm[s];
  const d = normalize(sub(a.upper.tail, a.upper.head));
  const q = add(a.upper.head, [sideSign(s) * 0.012, 0, 0]);
  return sideSign(s) * c[0] > 0 && dot(sub(c, q), d) > 0;
}

function armSegs(s: Side): number[] {
  return [segOf(`upperarm_${s}`), segOf(`lowerarm_${s}`), segOf(`hand_${s}`)];
}
function legSegs(s: Side): number[] {
  return [segOf(`thigh_${s}`), segOf(`calf_${s}`), segOf(`foot_${s}`)];
}

/** Front or back of the torso (tailors' side seam). */
function torsoFront(L: Landmarks, c: Vec3): boolean {
  return c[2] > L.zc(c[1]);
}

// ------------------------------------------------------------------ tops

const TOP_PARAMS = (d: Partial<Record<string, number>>): ParamDef[] => [
  slider('length', 'Length', 0, 100, 1, '%', d.length ?? 45, 'From the waist (0) to below the hips (100)'),
  slider('sleeve', 'Sleeves', 0, 100, 1, '%', d.sleeve ?? 25, '0 is sleeveless, 100 reaches the wrist'),
  choice('neckline', 'Neckline', NECKLINES, d.neckline ?? 0),
  slider('neckDepth', 'Neckline depth', 2, 25, 0.5, 'cm', d.neckDepth ?? 8, 'Scoop and V-neck'),
  slider('rollHeight', 'Roll height', 2, 8, 0.5, 'cm', d.rollHeight ?? 5, 'Roll-neck'),
  slider('ease', 'Ease', 4, 50, 1, 'mm', d.ease ?? 12, 'Room between the skin and the cloth'),
  slider('drape', 'Drape', 0, 100, 1, '%', d.drape ?? 45, 'How much the cloth bridges hollows (the convex hull blend)'),
  slider('smoothness', 'Smoothness', 0, 100, 1, '%', d.smoothness ?? 60, 'Hides muscle, navel and other body detail'),
  slider('armhole', 'Armhole', 8, 14, 0.5, 'cm', d.armhole ?? 10.5, 'Sleeveless: how deep the armhole is'),
  slider('opening', 'Front opening', 0, 12, 0.5, 'cm', d.opening ?? 0, 'Open front: the gap between the fronts'),
  toggle('cuffs', 'Rib cuffs', (d.cuffs ?? 0) as 0 | 1),
  toggle('hemBand', 'Rib hem band', (d.hemBand ?? 0) as 0 | 1),
  toggle('zip', 'Zip line', (d.zip ?? 0) as 0 | 1, 'Splits the front at the centre (for a zip decal)'),
  toggle('pockets', 'Chest pockets', (d.pockets ?? 0) as 0 | 1),
  slider('thickness', 'Cloth thickness', 1, 8, 0.5, 'mm', d.thickness ?? 3),
];

function topSpec(body: ShellBody, p: ShellParams, slot: ImportSlot, cls: GarmentClass): ShellSpec {
  const L = landmarks(body);
  const e = mm(p.ease!);
  const yHem = L.waistY + (L.crotchY + 0.045 - L.waistY) * pct(p.length!);
  const sleeve = pct(p.sleeve!);
  const opening = cm(p.opening!);
  const split = opening > 0 || p.zip === 1;
  const torsoSegs = [SEG.torso, SEG.pelvis, SEG.thigh_l, SEG.thigh_r];
  const constraints: Constraint[] = [
    { id: 'hem', segments: torsoSegs, value: (q) => q[1] - yHem },
    necklineConstraint(L, p.neckline!, cm(p.neckDepth!), cm(p.rollHeight!)),
  ];
  const domain = [...torsoSegs, SEG.neck];
  for (const s of SIDES) {
    const a = L.arm[s];
    domain.push(...armSegs(s));
    if (sleeve > 0.02) {
      const cut = sleeve * (a.lu + a.ll) * 0.98;
      constraints.push({ id: `cuff_${s}`, segments: armSegs(s), value: (q, seg) => cut - a.s(q, seg) });
    } else {
      const S = add(a.upper.head, [sideSign(s) * 0.012, -0.03, 0]);
      const r = cm(p.armhole!);
      constraints.push({ id: `arm_${s}`, segments: [SEG.torso, SEG.pelvis], value: (q) => len(sub(q, S)) - r });
      constraints.push({ id: `arm_${s}`, segments: armSegs(s), value: (q) => Math.min(len(sub(q, S)) - r, -0.004) });
    }
  }
  if (opening > 0) {
    constraints.push({ id: 'front', segments: [SEG.torso, SEG.pelvis, SEG.neck, SEG.thigh_l, SEG.thigh_r], value: (q) => (torsoFront(L, q) ? Math.abs(q[0]) - opening / 2 : 1) });
  }
  const bands: BandSpec[] = [];
  if (p.cuffs === 1 && sleeve > 0.02) for (const s of SIDES) bands.push({ hem: `cuff_${s}`, height: 0.05, ease: Math.max(0.006, e * 0.6), rim: 0.01 });
  if (p.hemBand === 1) bands.push({ hem: 'hem', height: 0.06, ease: e * 0.85, rim: 0.01 });
  if (p.neckline === 3) bands.push({ hem: 'neck', height: cm(p.rollHeight!) + 0.03, ease: Math.max(0.014, e * 0.9), rim: 0.018 });
  else if (p.neckline === 4) bands.push({ hem: 'neck', height: 0.04, ease: Math.max(0.01, e * 0.8), rim: 0.012 });
  else if (cls === 'sweater') bands.push({ hem: 'neck', height: 0.02, ease: e * 0.7, rim: 0.009 });
  const pockets =
    p.pockets === 1
      ? SIDES.map((s) => ({
          centre: add(L.bustPoint[s], [sideSign(s) * 0.01, 0.035, 0.04]) as Vec3,
          up: [0, 1, 0] as Vec3,
          width: 0.105,
          height: 0.12,
          thickness: 0.004,
          flap: 0.3,
          name: `pocket_${s}`,
        }))
      : undefined;
  return {
    slot,
    garmentClass: cls,
    domain,
    constraints,
    // Cloth hangs from the shoulders: less ease where the body faces up (outer layers less so: they sit over a top).
    ease: (seg, _q, n) => (seg >= SEG.upperarm_l && seg <= SEG.hand_r ? Math.max(0.006, e * 0.8) : e * (1 - (slot === 'outer' ? 0.25 : 0.4) * Math.max(0, n[1]))),
    bands,
    rim: 0.007,
    thickness: mm(p.thickness!),
    smoothing: Math.round(6 + 24 * pct(p.smoothness!)),
    hull: [{ segments: [SEG.torso, SEG.pelvis, SEG.thigh_l, SEG.thigh_r], drape: pct(p.drape!), yMin: yHem - 0.01, yMax: Math.min(L.armpit.l[1], L.armpit.r[1]) + 0.01 }],
    cylinders: [
      {
        segments: [SEG.torso, SEG.pelvis, SEG.thigh_l, SEG.thigh_r],
        yMin: yHem - 0.005,
        yMax: Math.min(L.armpit.l[1], L.armpit.r[1]) + 0.01,
        axisAt: (y) => [0, L.zc(y)],
        strength: smoothStrength(p.smoothness!),
        floor: Math.max(CLASS_MIN_EASE[cls] / 2 + 0.001, e * 0.45),
        // Draped cloth falls from the chest (and a belly) more than it follows the body back in.
        hang: 1.3 - pct(p.drape!),
        envelope: 8,
        round: 4,
      },
    ],
    levelHems: ['hem'],
    radial:
      sleeve > 0.6
        ? SIDES.map((s) => ({
            segments: [segOf(`lowerarm_${s}`)],
            axisAt: (q: Vec3) => L.arm[s].at(L.arm[s].s(q, segOf(`lowerarm_${s}`))),
            axisDir: (q: Vec3) => L.arm[s].dir(L.arm[s].s(q, segOf(`lowerarm_${s}`))),
            factor: (q: Vec3) => 1 + 0.1 * Math.max(0, alongBone(L.arm[s].lower, q)),
          }))
        : undefined,
    pockets,
    panelOf: (c, seg) => {
      for (const s of SIDES) {
        if (armSegs(s).includes(seg) || ((seg === SEG.torso || seg === SEG.neck) && sleeveSide(L, s, c))) {
          if (!sleeveSide(L, s, c) && seg !== segOf(`lowerarm_${s}`) && seg !== segOf(`hand_${s}`)) break;
          const a = L.arm[s];
          const sv = a.s(c, armSegs(s).includes(seg) ? seg : segOf(`upperarm_${s}`));
          const fwd = perpendicular(a.dir(sv), [0, 0, 1]);
          return `sleeve_${s}_${dot(sub(c, a.at(sv)), fwd) >= 0 ? 'front' : 'back'}`;
        }
      }
      const f = torsoFront(L, c) ? 'front' : 'back';
      return split && f === 'front' ? `front_${c[0] >= 0 ? 'l' : 'r'}` : f;
    },
  };
}

// ------------------------------------------------------------------ bottoms

const BOTTOM_PARAMS = (d: Partial<Record<string, number>>): ParamDef[] => [
  slider('rise', 'Rise', 0, 100, 1, '%', d.rise ?? 70, 'Waistband height: hips (0) to the natural waist (100)'),
  slider('length', 'Length', 0, 100, 1, '%', d.length ?? 100),
  slider('ease', 'Ease at the hips', 4, 40, 1, 'mm', d.ease ?? 12),
  slider('legEase', 'Ease at the legs', 2, 60, 1, 'mm', d.legEase ?? 16),
  slider('flare', 'Flare', 0, 80, 1, '%', d.flare ?? 4, 'How much the leg widens towards the hem'),
  slider('drape', 'Drape', 0, 100, 1, '%', d.drape ?? 35),
  slider('smoothness', 'Smoothness', 0, 100, 1, '%', d.smoothness ?? 60),
  toggle('waistband', 'Waistband', (d.waistband ?? 1) as 0 | 1),
  toggle('cuffs', 'Rolled cuffs', (d.cuffs ?? 0) as 0 | 1),
  toggle('pockets', 'Cargo pockets', (d.pockets ?? 0) as 0 | 1),
  slider('thickness', 'Cloth thickness', 1, 8, 0.5, 'mm', d.thickness ?? 3),
];

type BottomCut = 'tube' | 'leggings' | 'shorts';

function bottomSpec(body: ShellBody, p: ShellParams, cut: BottomCut, cls: GarmentClass): ShellSpec {
  const L = landmarks(body);
  const e = mm(p.ease!);
  const le = mm(p.legEase!);
  const yWaist = L.hipsY + (L.waistY - L.hipsY) * pct(p.rise!) + 0.01;
  const domain = [SEG.torso, SEG.pelvis, ...legSegs('l'), ...legSegs('r')];
  const constraints: Constraint[] = [{ id: 'waist', segments: [SEG.torso, SEG.pelvis, SEG.thigh_l, SEG.thigh_r], value: (q) => yWaist - q[1] }];
  const lofts: LoftSpec[] = [];
  const levelHems = ['waist'];
  const bands: BandSpec[] = [];
  const front = (s: Side, c: Vec3, seg: number) => (legSegs(s).includes(seg) || seg < 0 ? c[2] > L.legAxis(s, c[1])[2] : torsoFront(L, c));
  const panel = (c: Vec3, seg: number) => {
    const s: Side = c[0] >= 0 ? 'l' : 'r';
    return `${front(s, c, seg) ? 'front' : 'back'}_${s}`;
  };
  for (const s of SIDES) {
    const knee = L.knee[s];
    if (cut === 'tube') {
      constraints.push({ id: `knee_${s}`, segments: legSegs(s), value: (q) => q[1] - knee.y });
      levelHems.push(`knee_${s}`);
      // Full length rests just above the instep (the tube would cut into the foot lower down).
      const hemY = L.ground + 0.06 + (1 - pct(p.length!)) * 0.3;
      const span = knee.y - hemY;
      const cuffH = 0.045;
      const tc = 1 - cuffH / span;
      const ts = p.cuffs === 1 ? [0.15, 0.35, 0.55, 0.75, tc - 0.01, tc, 1] : [0.15, 0.35, 0.55, 0.75, 0.9, 1];
      const flare = pct(p.flare!);
      lofts.push({
        from: `knee_${s}`,
        to: `hem_${s}`,
        hemY,
        hemCentre: L.ankle[s].centre,
        ts,
        radial: (t) => (1 + flare * t * t) * (p.cuffs === 1 && t >= tc ? 1.07 : 1),
        hold: { segments: [segOf(`calf_${s}`)], y0: knee.y, y1: Math.max(hemY, L.ankle[s].y + 0.03), ease: le },
        widen: { segments: [segOf(`thigh_${s}`)], height: 0.16, axisAt: (y) => L.legAxis(s, y) },
        seg: segOf(`calf_${s}`),
        ease: le,
        panelOf: (c) => panel(c, -1),
      });
      if (p.cuffs === 1) bands.push({ hem: `hem_${s}`, height: 0, ease: le, rim: 0.012 });
    } else {
      const hemY = cut === 'leggings' ? L.ankle[s].y + 0.01 + (1 - pct(p.length!)) * 0.3 : L.crotchY - 0.035 + (knee.y + 0.04 - (L.crotchY - 0.035)) * pct(p.length!);
      constraints.push({ id: `leg_${s}`, segments: legSegs(s), value: (q) => q[1] - hemY });
      levelHems.push(`leg_${s}`);
      if (cut === 'shorts') bands.push({ hem: `leg_${s}`, height: 0.03, ease: le + 0.004, rim: 0.009 });
    }
  }
  if (p.waistband === 1) bands.push({ hem: 'waist', height: 0.04, ease: e * 0.85 + 0.002, rim: 0.009 });
  const pockets =
    p.pockets === 1
      ? SIDES.map((s) => {
          const y = (L.crotchY + L.knee[s].y) / 2 - 0.02;
          const a = L.legAxis(s, y);
          return { centre: add(a, [sideSign(s) * 0.11, 0, 0.0]) as Vec3, up: [0, 1, 0] as Vec3, width: 0.14, height: 0.16, thickness: 0.006, flap: 0.28, name: `pocket_${s}` };
        })
      : undefined;
  return {
    slot: 'bottom',
    garmentClass: cls,
    domain,
    constraints,
    ease: (seg, q) => {
      if (seg === SEG.torso || seg === SEG.pelvis) return q[1] > L.hipsY ? e * 0.85 : e;
      return le;
    },
    bands,
    rim: 0.007,
    thickness: mm(p.thickness!),
    smoothing: Math.round(6 + 24 * pct(p.smoothness!)),
    hull: [
      // The seat down to just above the crotch (the lower seat is the thighs' by weight): cloth bridges the cleft.
      { segments: [SEG.torso, SEG.pelvis, SEG.thigh_l, SEG.thigh_r], drape: 1, yMin: L.crotchY + 0.012, yMax: yWaist },
      ...SIDES.map((s) => ({ segments: [segOf(`thigh_${s}`)], drape: pct(p.drape!) * 0.6, yMin: L.knee[s].y + 0.02, yMax: L.crotchY - 0.01 })),
    ],
    cylinders: [
      {
        segments: [SEG.torso, SEG.pelvis, SEG.thigh_l, SEG.thigh_r],
        yMin: L.crotchY + 0.012,
        yMax: yWaist - 0.01,
        axisAt: (y) => [0, L.zc(y)],
        strength: smoothStrength(p.smoothness!),
        floor: Math.max(CLASS_MIN_EASE[cls] / 2 + 0.001, e * 0.45),
        // The seat rests on the hips and the seat's highs; just over the crotch it still follows the body.
        envelope: 8,
        envelopeFade: 0.03,
      },
      ...SIDES.map((s) => ({
        segments: [segOf(`thigh_${s}`)],
        yMin: (cut === 'tube' ? L.knee[s].y : L.knee[s].y) + 0.03,
        yMax: L.crotchY - 0.02,
        axisAt: (y: number): [number, number] => {
          const a = L.legAxis(s, y);
          return [a[0], a[2]];
        },
        strength: smoothStrength(p.smoothness!),
        floor: Math.max(0.0015, le * 0.45),
        around: 4,
        up: 6,
      })),
    ],
    levelHems,
    lofts,
    pockets,
    panelOf: (c, seg) => panel(c, seg),
  };
}

// ------------------------------------------------------------------ hands and feet


function gloveSpec(_body: ShellBody, p: ShellParams): ShellSpec {
  const e = mm(p.ease!);
  const fingerless = p.fingerless === 1;
  const hems = SIDES.flatMap((s) => (fingerless ? [`cuff_${s}`, `finger_${s}`] : [`cuff_${s}`]));
  return {
    slot: 'gloves',
    garmentClass: 'gloves',
    domain: [],
    constraints: [],
    extraHems: hems,
    ease: () => e,
    bands: hems.map((h) => ({ hem: h, height: 0, ease: e, rim: 0.007 })),
    rim: 0.006,
    thickness: mm(1.5),
    smoothing: 0,
    generate: (b, hem) =>
      buildGlovesWithin(
        b,
        {
          cuff: cm(p.cuffLength!),
          ease: e,
          cuffEase: 0.004,
          fingerless,
          // Smoothness: points around each ring.
          around: 10 + 2 * Math.round(3 * pct(p.smoothness!)),
          hem: { l: { cuff: hem('cuff_l'), fingers: hem('finger_l') }, r: { cuff: hem('cuff_r'), fingers: hem('finger_r') } },
        },
        SLOT_BUDGET.gloves!,
        Math.round(SLOT_BUDGET.gloves! * GENERATED_SHARE),
      ),
    panelOf: (c) => `glove_${c[0] >= 0 ? 'l' : 'r'}_a`,
  };
}

function footPanel(L: Landmarks, prefix: string) {
  return (c: Vec3) => {
    const s: Side = c[0] >= 0 ? 'l' : 'r';
    const ax = L.legAxis(s, Math.max(c[1], L.ankle[s].y));
    return `${prefix}_${s}_${(c[0] - ax[0]) * sideSign(s) >= 0 ? 'out' : 'in'}`;
  };
}

function sockSpec(body: ShellBody, p: ShellParams): ShellSpec {
  const L = landmarks(body);
  const e = mm(p.ease!);
  // Rings over the foot like a boot's (knit bridges the toes; a shell cut from the body would follow each toe),
  // close, without a sole: the bottom ring sits just under the ground.
  return {
    slot: 'shoes',
    garmentClass: 'socks',
    domain: [],
    constraints: [],
    extraHems: ['top_l', 'top_r'],
    ease: () => e,
    bands: SIDES.map((s) => ({ hem: `top_${s}`, height: 0, ease: e + 0.0035, rim: 0.006 })),
    rim: 0.006,
    thickness: mm(1.5),
    smoothing: 0,
    generate: (b, hem) =>
      buildBootsWithin(b, {
        height: cm(p.height!),
        ease: e,
        shaftEase: e + 0.0015,
        sole: 0,
        welt: 0,
        toeBox: 0.004,
        around: 20,
        hem: { l: hem('top_l'), r: hem('top_r') },
        slab: false,
      }, SLOT_BUDGET.shoes!, Math.round(SLOT_BUDGET.shoes! * GENERATED_SHARE)),
    panelOf: footPanel(L, 'sock'),
  };
}

function bootSpec(body: ShellBody, p: ShellParams): ShellSpec {
  const L = landmarks(body);
  return {
    slot: 'shoes',
    garmentClass: 'boots',
    domain: [],
    constraints: [],
    extraHems: ['top_l', 'top_r'],
    ease: () => mm(p.ease!),
    bands: SIDES.map((s) => ({ hem: `top_${s}`, height: 0, ease: mm(p.shaftEase!), rim: 0.009 })),
    rim: 0.009,
    thickness: mm(3),
    smoothing: 0,
    generate: (b, hem) =>
      buildBootsWithin(b, {
        height: cm(p.height!),
        ease: mm(p.ease!),
        shaftEase: mm(p.shaftEase!),
        sole: mm(p.sole!),
        welt: mm(p.welt!),
        toeBox: cm(p.toeBox!),
        around: 14,
        hem: { l: hem('top_l'), r: hem('top_r') },
      }, SLOT_BUDGET.shoes!, Math.round(SLOT_BUDGET.shoes! * GENERATED_SHARE)),
    panelOf: footPanel(L, 'boot'),
  };
}

// ------------------------------------------------------------------ head

function headPlane(L: Landmarks, front: number, back: number): Constraint {
  const F = add(L.head.brow, [0, front, 0]);
  const B = add(L.head.occiput, [0, back, 0]);
  const n = normalize(cross([1, 0, 0], sub(B, F)));
  const up = n[1] < 0 ? ([-n[0], -n[1], -n[2]] as Vec3) : n;
  return { id: 'brim', segments: [SEG.head], value: (q) => dot(sub(q, F), up) };
}

function hatSpec(body: ShellBody, p: ShellParams, cap: boolean): ShellSpec {
  const L = landmarks(body);
  const e = mm(p.ease!);
  const plane = headPlane(L, cm(p.front!), cm(p.back!));
  const bands: BandSpec[] = p.cuff === 1 && !cap ? [{ hem: 'brim', height: cm(p.cuffHeight!), ease: e + 0.008, rim: 0.014 }] : [];
  return {
    slot: 'hat',
    garmentClass: 'hat',
    domain: [SEG.head],
    constraints: [plane],
    ease: () => e,
    bands,
    rim: cap ? 0.006 : 0.008,
    thickness: mm(3),
    smoothing: 16,
    skull: { drape: pct(p.roundness!), grow: e + mm(1.5), yMin: Math.min(L.head.brow[1], L.head.occiput[1]) - 0.06 },
    brim: cap ? { hem: 'brim', length: cm(p.brim!), droop: 0.22, thickness: 0.006 } : undefined,
    panelOf: (c) => `crown_${c[0] >= 0 ? 'l' : 'r'}`,
  };
}

function hoodSpec(body: ShellBody, p: ShellParams): ShellSpec {
  const L = landmarks(body);
  const e = mm(p.ease!);
  const nose = L.head.nose;
  const cy = nose[1] - 0.005;
  const rx = cm(p.openingWidth!) / 2;
  const ry = cm(p.openingHeight!) / 2;
  const zFace = nose[2] - 0.085;
  const yHem = Math.min(L.shoulderTip.l[1], L.shoulderTip.r[1]) - cm(p.drop!);
  const face: Constraint = {
    id: 'face',
    segments: [SEG.head, SEG.neck, SEG.torso],
    value: (q) => {
      const ex = q[0] / rx;
      const ey = (q[1] - cy) / ry;
      const ellipse = q[2] < zFace ? 1 : (Math.sqrt(ex * ex + ey * ey) - 1) * 0.06;
      // The slot down the front, through the neck too (no strap across the throat under the opening).
      const front = q[1] > L.neck.base(0) ? q[2] > L.neck.centre[2] : torsoFront(L, q);
      const keyhole = front && q[1] < cy ? Math.abs(q[0]) - 0.06 : 1;
      return Math.min(ellipse, keyhole);
    },
  };
  return {
    slot: 'hat',
    garmentClass: 'hat',
    domain: [SEG.head, SEG.neck, SEG.torso],
    constraints: [face, { id: 'hem', segments: [SEG.torso], value: (q) => q[1] - yHem }],
    ease: (seg) => (seg === SEG.head ? e : e * 1.2),
    rim: 0.009,
    thickness: mm(4),
    smoothing: 20,
    // The jaw joins the neck's slices: the cloth hangs from the jaw line to the neck instead of following under it.
    hull: [{ segments: [SEG.head, SEG.neck, SEG.torso], drape: 1, yMin: yHem, yMax: L.head.nose[1] - 0.03, band: 3 }],
    // The skull's ellipsoid over the ears too: era hoods are smooth balloons, no ear or skull bumps.
    skull: { drape: 1, grow: e + mm(2), yMin: L.head.nose[1] - 0.06, extentFrom: L.head.nose[1] - 0.03, both: true },
    levelHems: ['hem'],
    panelOf: (c) => `hood_${c[0] >= 0 ? 'l' : 'r'}`,
  };
}

// ------------------------------------------------------------------ the list

const look = (material: string, tint: [number, number, number]): LookHint => ({ material: `ps2cc:materials/${material}`, tint });

export const SHELL_TEMPLATES: ShellTemplate[] = [
  {
    id: 'tshirt',
    name: 'T-shirt',
    category: 'tops',
    slot: 'top',
    garmentClass: 'tshirt',
    look: look('cotton_jersey', [0.75, 0.74, 0.7]),
    params: TOP_PARAMS({ length: 50, sleeve: 24, ease: 11, drape: 45 }),
    spec: (b, p) => topSpec(b, p, 'top', 'tshirt'),
  },
  {
    id: 'longsleeve',
    name: 'Long-sleeve top',
    category: 'tops',
    slot: 'top',
    garmentClass: 'tshirt',
    look: look('cotton_jersey', [0.5, 0.52, 0.56]),
    params: TOP_PARAMS({ length: 55, sleeve: 100, ease: 12, cuffs: 1 }),
    spec: (b, p) => topSpec(b, p, 'top', 'tshirt'),
  },
  {
    id: 'rollneck',
    name: 'Roll-neck sweater',
    category: 'tops',
    slot: 'top',
    garmentClass: 'sweater',
    look: look('knit', [0.72, 0.66, 0.58]),
    params: TOP_PARAMS({ length: 60, sleeve: 100, neckline: 3, ease: 19, drape: 60, cuffs: 1, hemBand: 1, thickness: 4 }),
    spec: (b, p) => topSpec(b, p, 'top', 'sweater'),
  },
  {
    id: 'tank',
    name: 'Tank top',
    category: 'tops',
    slot: 'top',
    garmentClass: 'tshirt',
    look: look('cotton_jersey', [0.85, 0.85, 0.82]),
    params: TOP_PARAMS({ length: 50, sleeve: 0, neckline: 1, neckDepth: 7, ease: 9, armhole: 10 }),
    spec: (b, p) => topSpec(b, p, 'top', 'tshirt'),
  },
  {
    id: 'utilityvest',
    name: 'Utility vest',
    category: 'tops',
    slot: 'outer',
    garmentClass: 'jacket',
    look: look('canvas', [0.42, 0.45, 0.33]),
    params: TOP_PARAMS({ length: 60, sleeve: 0, neckline: 2, neckDepth: 14, ease: 27, drape: 70, armhole: 10.5, opening: 4, pockets: 1, thickness: 5 }),
    spec: (b, p) => topSpec(b, p, 'outer', 'jacket'),
  },
  {
    id: 'leggings',
    name: 'Leggings',
    category: 'bottoms',
    slot: 'bottom',
    garmentClass: 'tight',
    look: look('cotton_jersey', [0.2, 0.2, 0.22]),
    params: BOTTOM_PARAMS({ ease: 3, legEase: 2, drape: 10, flare: 0, waistband: 1 }),
    spec: (b, p) => bottomSpec(b, p, 'leggings', 'tight'),
  },
  {
    id: 'straighttrousers',
    name: 'Straight trousers',
    category: 'bottoms',
    slot: 'bottom',
    garmentClass: 'trousers',
    look: look('wool_herringbone', [0.45, 0.44, 0.38]),
    params: BOTTOM_PARAMS({ ease: 13, legEase: 16, flare: 4 }),
    spec: (b, p) => bottomSpec(b, p, 'tube', 'trousers'),
  },
  {
    id: 'flaredtrousers',
    name: 'Flared trousers',
    category: 'bottoms',
    slot: 'bottom',
    garmentClass: 'jeans',
    look: look('denim', [0.55, 0.62, 0.8]),
    params: BOTTOM_PARAMS({ ease: 10, legEase: 10, flare: 45 }),
    spec: (b, p) => bottomSpec(b, p, 'tube', 'jeans'),
  },
  {
    id: 'cargotrousers',
    name: 'Cargo trousers',
    category: 'bottoms',
    slot: 'bottom',
    garmentClass: 'trousers',
    look: look('canvas', [0.42, 0.42, 0.34]),
    params: BOTTOM_PARAMS({ ease: 15, legEase: 20, flare: 2, pockets: 1, thickness: 3.5 }),
    spec: (b, p) => bottomSpec(b, p, 'tube', 'trousers'),
  },
  {
    id: 'shorts',
    name: 'Shorts',
    category: 'bottoms',
    slot: 'bottom',
    garmentClass: 'trousers',
    look: look('canvas', [0.6, 0.55, 0.42]),
    params: BOTTOM_PARAMS({ ease: 12, legEase: 18, length: 55 }),
    spec: (b, p) => bottomSpec(b, p, 'shorts', 'trousers'),
  },
  {
    id: 'gloves',
    tier: 'ps2_body_full',
    name: 'Gloves',
    category: 'hands-feet',
    slot: 'gloves',
    garmentClass: 'gloves',
    look: look('leather_black', [1, 1, 1]),
    params: [slider('cuffLength', 'Cuff length', 2, 14, 0.5, 'cm', 6), slider('ease', 'Ease', 2, 8, 0.5, 'mm', 4), toggle('fingerless', 'Fingerless', 0), slider('smoothness', 'Smoothness', 0, 100, 1, '%', 40)],
    spec: (b, p) => gloveSpec(b, p),
  },
  {
    id: 'socks',
    tier: 'ps2_body_full',
    name: 'Socks',
    category: 'hands-feet',
    slot: 'shoes',
    garmentClass: 'socks',
    look: look('knit', [0.3, 0.3, 0.32]),
    params: [slider('height', 'Height above the ankle', 3, 25, 0.5, 'cm', 12), slider('ease', 'Ease', 1, 4, 0.5, 'mm', 2)],
    spec: (b, p) => sockSpec(b, p),
  },
  {
    id: 'workboots',
    tier: 'ps2_body_full',
    name: 'Work boots',
    category: 'hands-feet',
    slot: 'shoes',
    garmentClass: 'boots',
    look: look('leather_worn', [1, 1, 1]),
    params: [
      slider('height', 'Height above the ankle', 0, 25, 0.5, 'cm', 9),
      slider('ease', 'Ease over the foot', 6, 14, 0.5, 'mm', 8),
      slider('shaftEase', 'Ease at the shaft', 6, 30, 1, 'mm', 14),
      slider('sole', 'Sole', 12, 32, 1, 'mm', 22),
      slider('welt', 'Welt', 0, 8, 0.5, 'mm', 4),
      slider('toeBox', 'Toe box', 0, 3, 0.1, 'cm', 2.0, 'How much the boot rises over the toes'),
    ],
    spec: (b, p) => bootSpec(b, p),
  },
  {
    id: 'sneakers',
    tier: 'ps2_body_full',
    name: 'Sneakers',
    category: 'hands-feet',
    slot: 'shoes',
    garmentClass: 'boots',
    look: look('canvas', [0.85, 0.84, 0.8]),
    params: [
      slider('height', 'Height above the ankle', 0, 25, 0.5, 'cm', 0.5),
      slider('ease', 'Ease over the foot', 6, 14, 0.5, 'mm', 9),
      slider('shaftEase', 'Ease at the shaft', 6, 30, 1, 'mm', 12),
      slider('sole', 'Sole', 12, 32, 1, 'mm', 20),
      slider('welt', 'Welt', 0, 8, 0.5, 'mm', 5),
      slider('toeBox', 'Toe box', 0, 3, 0.1, 'cm', 1.0),
    ],
    spec: (b, p) => bootSpec(b, p),
  },
  {
    id: 'beanie',
    tier: 'ps2_body_full',
    name: 'Beanie',
    category: 'head',
    slot: 'hat',
    garmentClass: 'hat',
    look: look('knit', [0.3, 0.3, 0.33]),
    params: [
      slider('front', 'Front edge above the brow', -1, 6, 0.5, 'cm', 2),
      slider('back', 'Back edge', -6, 4, 0.5, 'cm', -2),
      slider('ease', 'Ease', 3, 15, 0.5, 'mm', 6),
      slider('roundness', 'Roundness', 0, 100, 1, '%', 90),
      toggle('cuff', 'Rolled cuff', 1),
      slider('cuffHeight', 'Cuff height', 2, 6, 0.5, 'cm', 3.5),
    ],
    spec: (b, p) => hatSpec(b, p, false),
  },
  {
    id: 'cap',
    tier: 'ps2_body_full',
    name: 'Cap',
    category: 'head',
    slot: 'hat',
    garmentClass: 'hat',
    look: look('cotton_jersey', [0.25, 0.3, 0.42]),
    params: [
      slider('front', 'Front edge above the brow', -1, 6, 0.5, 'cm', 3),
      slider('back', 'Back edge', -6, 4, 0.5, 'cm', 1),
      slider('ease', 'Ease', 3, 15, 0.5, 'mm', 6),
      slider('roundness', 'Roundness', 0, 100, 1, '%', 85),
      slider('brim', 'Brim length', 3, 10, 0.5, 'cm', 7),
    ],
    spec: (b, p) => hatSpec(b, p, true),
  },
  {
    id: 'hood',
    name: 'Hood',
    category: 'head',
    slot: 'hat',
    garmentClass: 'hat',
    look: look('cotton_jersey', [0.4, 0.4, 0.42]),
    params: [
      slider('ease', 'Ease', 10, 50, 1, 'mm', 28),
      slider('openingWidth', 'Opening width', 12, 22, 0.5, 'cm', 16),
      slider('openingHeight', 'Opening height', 16, 30, 0.5, 'cm', 23),
      slider('drop', 'Drop below the shoulders', 0, 10, 0.5, 'cm', 3),
    ],
    spec: (b, p) => hoodSpec(b, p),
  },
];

const accessory = (generate: (b: ShellBody, p: ShellParams) => WorkMesh) => (_b: ShellBody, p: ShellParams): ShellSpec => ({
  slot: 'accessory',
  garmentClass: 'accessory',
  domain: [],
  constraints: [],
  ease: () => 0,
  rim: 0.006,
  thickness: 0,
  smoothing: 0,
  generate: (body) => generate(body, p),
  panelOf: () => 'main',
});

const sidesOf = (v: number): Side[] => (v === 0 ? ['l', 'r'] : v === 1 ? ['l'] : ['r']);

SHELL_TEMPLATES.push(
  {
    id: 'belt',
    name: 'Belt',
    category: 'accessories',
    slot: 'accessory',
    garmentClass: 'accessory',
    look: look('leather_worn', [1, 1, 1]),
    tier: 'ps2_body_full',
    params: [
      slider('height', 'Height above the hips', -4, 14, 0.5, 'cm', 6),
      slider('width', 'Width', 2, 6, 0.5, 'cm', 3.5),
      slider('thickness', 'Thickness', 3, 10, 0.5, 'mm', 5),
      slider('offset', 'Over the clothes by', 0, 40, 1, 'mm', 16),
      toggle('buckle', 'Buckle', 1),
    ],
    spec: accessory((b, p) => buildBelt(b, { height: cm(p.height!), width: cm(p.width!), thickness: mm(p.thickness!), offset: mm(p.offset!), buckle: p.buckle === 1 })),
  },
  {
    id: 'wristband',
    name: 'Wristband',
    category: 'accessories',
    slot: 'accessory',
    garmentClass: 'accessory',
    look: look('leather_black', [1, 1, 1]),
    tier: 'ps2_body_full',
    params: [
      choice('side', 'Wrists', ['Both', 'Left', 'Right'], 1),
      slider('at', 'Along the forearm', 50, 100, 1, '%', 88),
      slider('width', 'Width', 1, 8, 0.5, 'cm', 3),
      slider('thickness', 'Thickness', 2, 10, 0.5, 'mm', 4),
      slider('offset', 'Gap to the skin', 0, 20, 0.5, 'mm', 2),
    ],
    spec: accessory((b, p) => buildLimbBands(b, 'arm', { sides: sidesOf(p.side!), at: pct(p.at!), width: cm(p.width!), thickness: mm(p.thickness!), offset: mm(p.offset!) })),
  },
  {
    id: 'holster',
    name: 'Holster band',
    category: 'accessories',
    slot: 'accessory',
    garmentClass: 'accessory',
    look: look('leather_black', [1, 1, 1]),
    tier: 'ps2_body_full',
    params: [
      choice('side', 'Thighs', ['Both', 'Left', 'Right'], 2),
      slider('at', 'Along the thigh', 20, 80, 1, '%', 45),
      slider('width', 'Width', 2, 8, 0.5, 'cm', 4),
      slider('thickness', 'Thickness', 3, 10, 0.5, 'mm', 5),
      slider('offset', 'Over the clothes by', 0, 40, 1, 'mm', 18),
      toggle('holster', 'Holster', 1),
    ],
    spec: accessory((b, p) => buildLimbBands(b, 'thigh', { sides: sidesOf(p.side!), at: pct(p.at!), width: cm(p.width!), thickness: mm(p.thickness!), offset: mm(p.offset!), holster: p.holster === 1 })),
  },
  {
    id: 'strap',
    name: 'Shoulder strap',
    category: 'accessories',
    slot: 'accessory',
    garmentClass: 'accessory',
    look: look('leather_worn', [1, 1, 1]),
    tier: 'ps2_body_full',
    params: [
      choice('shoulder', 'Over the shoulder', ['Left', 'Right'], 0),
      slider('width', 'Width', 2, 8, 0.5, 'cm', 4),
      slider('thickness', 'Thickness', 3, 10, 0.5, 'mm', 5),
      slider('offset', 'Over the clothes by', 0, 50, 1, 'mm', 22),
    ],
    spec: accessory((b, p) => buildStrap(b, { shoulder: p.shoulder === 0 ? 'l' : 'r', width: cm(p.width!), thickness: mm(p.thickness!), offset: mm(p.offset!) })),
  },
  {
    id: 'satchel',
    name: 'Satchel',
    category: 'accessories',
    slot: 'accessory',
    garmentClass: 'accessory',
    look: look('canvas', [0.45, 0.4, 0.3]),
    tier: 'ps2_body_full',
    params: [
      choice('shoulder', 'Over the shoulder', ['Left', 'Right'], 0),
      slider('width', 'Strap width', 2, 8, 0.5, 'cm', 4),
      slider('offset', 'Over the clothes by', 0, 50, 1, 'mm', 22),
      slider('bagWidth', 'Bag width', 15, 40, 1, 'cm', 26),
      slider('bagHeight', 'Bag height', 12, 35, 1, 'cm', 20),
      slider('bagDepth', 'Bag depth', 4, 15, 0.5, 'cm', 7),
    ],
    spec: accessory((b, p) =>
      buildStrap(b, { shoulder: p.shoulder === 0 ? 'l' : 'r', width: cm(p.width!), thickness: mm(5), offset: mm(p.offset!), bag: { width: cm(p.bagWidth!), height: cm(p.bagHeight!), depth: cm(p.bagDepth!) } }),
    ),
  },
);

export function shellTemplate(id: string): ShellTemplate | undefined {
  return SHELL_TEMPLATES.find((t) => t.id === id);
}
