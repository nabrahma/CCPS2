/**
 * Hairstyle parameters (PRD F5 steps 3–8). A style is plain data, saved as
 * `.ps2hair`; generation from it is deterministic for a given seed and body.
 * Lengths and offsets are in metres.
 */
import { DEFAULT_CARD_BUILD, type CardBuildParams } from './cards-from-curves';
import { isPaintString } from './hairline-paint';

export type PartSide = 'none' | 'left' | 'right' | 'center';
export type HairlinePreset = 'full' | 'low' | 'receding' | 'high-nape' | 'custom' | 'painted';

/**
 * Where hair grows, as the largest polar angle from the crown (degrees) at
 * the front, temples (±50°), sides (sideburns, ±88°) and nape (back),
 * interpolated around the head with a notch over the ears (see Scalp.maskLimit).
 */
export interface HairlineMask {
  preset: HairlinePreset;
  front: number;
  temples: number;
  sides: number;
  nape: number;
  /** Only with preset 'painted': the bitmap from the hairline painter (hairline-paint.ts). The angles above are then ignored. */
  painted?: string;
}

/**
 * The groom: a few guide curves carry the hairstyle's shape, and every card's
 * curve is interpolated from the guides around its root (docs/hair-system.md).
 */
export interface GroomParams {
  /** Guide curves over the whole scalp. */
  guides: number;
  /** Nearest guides blended for each hair (1 follows a single guide exactly). */
  interpolate: number;
  /** 0..1 how far hairs are pulled onto their nearest guide, forming locks. */
  clump: number;
  /** Where along the hair the clumping takes hold (see shapeRange): low is from the root, high only at the tip. */
  clumpShape: number;
  /** Random waviness of each hair, in metres at full strength. */
  frizz: number;
  frizzShape: number;
  /** Extra lift of the loose "flyaway" hairs off the layers below, in metres at the tip. */
  flyawayLift: number;
}

export const DEFAULT_GROOM: GroomParams = { guides: 36, interpolate: 3, clump: 0.35, clumpShape: 0.6, frizz: 0.004, frizzShape: 0.4, flyawayLift: 0.008 };

export interface HairStyleParams {
  name: string;
  seed: number;
  /** Cards in the outermost layer; inner layers use fewer. */
  guides: number;
  length: { front: number; sides: number; back: number; top: number };
  /** 0..1 random variation of each strand's length. */
  lengthJitter: number;
  part: { side: PartSide; /** -1..1 across the head (negative = character's right). */ position: number };
  /** 0 = hair falls away from the part, 1 = combed straight back. */
  flowBack: number;
  /** 0..1 how much the hair at the front falls forward, to hang around the face instead of beside the head. */
  frame: number;
  /** 0..1 how strongly strands bend down. */
  gravity: number;
  /** Lift of the outer layer from the scalp at the roots. */
  volume: number;
  curl: { amplitude: number; /** Cycles per metre of strand. */ frequency: number };
  bangs: { enabled: boolean; length: number; /** Fraction of the front hairline that becomes bangs (0..1). */ width: number };
  ponytail: { enabled: boolean; /** 0 = nape, 1 = crown. */ height: number; length: number };
  /** `segments` is the most quads a card may have; long cards get one per `build.segmentLength`. */
  cards: { segments: number; width: number; /** 0..1 narrowing towards the tip. */ taper: number; layers: number; /** Fraction of outer cards that use flyaway regions. */ flyaway: number };
  groom: GroomParams;
  /** How cards are built on the curves: the inputs of the "Hair cards from curves" node group. */
  build: CardBuildParams;
  shell: { enabled: boolean; offset: number };
  hairline: HairlineMask;
  /** Triangle budget [min, max] the style must stay inside (PRD: 1,500 to 3,500 for hair). */
  budget: [number, number];
}

export const HAIRLINE_PRESETS: Record<Exclude<HairlinePreset, 'custom' | 'painted'>, Omit<HairlineMask, 'preset'>> = {
  full: { front: 63, temples: 71, sides: 100, nape: 138 },
  low: { front: 67, temples: 75, sides: 102, nape: 142 },
  receding: { front: 40, temples: 46, sides: 92, nape: 130 },
  'high-nape': { front: 56, temples: 64, sides: 92, nape: 116 },
};

export function hairline(preset: Exclude<HairlinePreset, 'custom' | 'painted'>): HairlineMask {
  return { preset, ...HAIRLINE_PRESETS[preset] };
}

export const DEFAULT_HAIR_STYLE: HairStyleParams = {
  name: 'Short messy',
  seed: 1,
  guides: 110,
  length: { front: 0.07, sides: 0.06, back: 0.07, top: 0.08 },
  lengthJitter: 0.25,
  part: { side: 'none', position: 0 },
  flowBack: 0.5,
  frame: 0,
  gravity: 0.35,
  volume: 0.012,
  curl: { amplitude: 0.004, frequency: 18 },
  bangs: { enabled: false, length: 0.06, width: 0.5 },
  ponytail: { enabled: false, height: 0.45, length: 0.25 },
  cards: { segments: 3, width: 0.035, taper: 0.2, layers: 3, flyaway: 0.15 },
  groom: { ...DEFAULT_GROOM },
  build: { ...DEFAULT_CARD_BUILD },
  shell: { enabled: true, offset: 0.002 },
  hairline: hairline('full'),
  budget: [1500, 3500],
};

/** Merge a (possibly partial or old) style over the defaults and clamp every field. */
export function sanitiseStyle(raw: unknown): HairStyleParams {
  const r = (raw ?? {}) as Partial<HairStyleParams>;
  const d = DEFAULT_HAIR_STYLE;
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  const int = (v: unknown, def: number, lo: number, hi: number) => Math.round(num(v, def, lo, hi));
  const len = { ...d.length, ...(r.length ?? {}) };
  const sides: PartSide[] = ['none', 'left', 'right', 'center'];
  const presets: HairlinePreset[] = ['full', 'low', 'receding', 'high-nape', 'custom', 'painted'];
  const painted = isPaintString((r.hairline as HairlineMask | undefined)?.painted) ? (r.hairline as HairlineMask).painted : undefined;
  const hl = { ...d.hairline, ...(r.hairline ?? {}) };
  const budget = Array.isArray(r.budget) && r.budget.length === 2 ? r.budget : d.budget;
  // Styles saved before the groom existed load with the defaults.
  const g = { ...d.groom, ...(r.groom ?? {}) };
  const b = { ...d.build, ...(r.build ?? {}) };
  return {
    name: typeof r.name === 'string' && r.name ? r.name.slice(0, 64) : d.name,
    seed: int(r.seed, d.seed, 0, 2 ** 31 - 1),
    guides: int(r.guides, d.guides, 0, 600),
    length: { front: num(len.front, 0.07, 0, 0.8), sides: num(len.sides, 0.06, 0, 0.8), back: num(len.back, 0.07, 0, 0.8), top: num(len.top, 0.08, 0, 0.8) },
    lengthJitter: num(r.lengthJitter, d.lengthJitter, 0, 1),
    part: { side: sides.includes(r.part?.side as PartSide) ? r.part!.side : d.part.side, position: num(r.part?.position, 0, -1, 1) },
    flowBack: num(r.flowBack, d.flowBack, 0, 1),
    frame: num(r.frame, d.frame, 0, 1),
    gravity: num(r.gravity, d.gravity, 0, 1),
    volume: num(r.volume, d.volume, 0, 0.05),
    curl: { amplitude: num(r.curl?.amplitude, d.curl.amplitude, 0, 0.05), frequency: num(r.curl?.frequency, d.curl.frequency, 0, 60) },
    bangs: {
      enabled: Boolean(r.bangs?.enabled ?? d.bangs.enabled),
      length: num(r.bangs?.length, d.bangs.length, 0.01, 0.3),
      width: num(r.bangs?.width, d.bangs.width, 0, 1),
    },
    ponytail: {
      enabled: Boolean(r.ponytail?.enabled ?? d.ponytail.enabled),
      height: num(r.ponytail?.height, d.ponytail.height, 0, 1),
      length: num(r.ponytail?.length, d.ponytail.length, 0.05, 0.8),
    },
    cards: {
      segments: int(r.cards?.segments, d.cards.segments, 1, 16),
      width: num(r.cards?.width, d.cards.width, 0.005, 0.12),
      taper: num(r.cards?.taper, d.cards.taper, 0, 1),
      layers: int(r.cards?.layers, d.cards.layers, 1, 6),
      flyaway: num(r.cards?.flyaway, d.cards.flyaway, 0, 1),
    },
    groom: {
      guides: int(g.guides, d.groom.guides, 4, 160),
      interpolate: int(g.interpolate, d.groom.interpolate, 1, 4),
      clump: num(g.clump, d.groom.clump, 0, 1),
      clumpShape: num(g.clumpShape, d.groom.clumpShape, -1, 1),
      frizz: num(g.frizz, d.groom.frizz, 0, 0.05),
      frizzShape: num(g.frizzShape, d.groom.frizzShape, -1, 1),
      flyawayLift: num(g.flyawayLift, d.groom.flyawayLift, 0, 0.05),
    },
    build: {
      lengthFactor: num(b.lengthFactor, d.build.lengthFactor, 0.05, 1),
      tipTwist: num(b.tipTwist, d.build.tipTwist, 0, 1),
      alignToSurface: num(b.alignToSurface, d.build.alignToSurface, 0, 1),
      rootAlign: num(b.rootAlign, d.build.rootAlign, 0, 1),
      tipAlign: num(b.tipAlign, d.build.tipAlign, 0, 1),
      offsetTilt: num(b.offsetTilt, d.build.offsetTilt, -180, 180),
      rootSnap: num(b.rootSnap, d.build.rootSnap, 0, 0.1),
      snapIfInside: num(b.snapIfInside, d.build.snapIfInside, 0, 0.1),
      surfaceOffset: num(b.surfaceOffset, d.build.surfaceOffset, 0, 0.02),
      segmentLength: num(b.segmentLength, d.build.segmentLength, 0.01, 0.5),
      normalFromSurface: num(b.normalFromSurface, d.build.normalFromSurface, 0, 1),
      partSnap: num(b.partSnap, d.build.partSnap, 0, 0.1),
      partLiftHeight: num(b.partLiftHeight, d.build.partLiftHeight, 0, 0.05),
      partLiftDistance: num(b.partLiftDistance, d.build.partLiftDistance, 0, 0.2),
      downscale: num(b.downscale, d.build.downscale, 0.5, 1),
    },
    shell: { enabled: Boolean(r.shell?.enabled ?? d.shell.enabled), offset: num(r.shell?.offset, d.shell.offset, 0, 0.02) },
    hairline: {
      // A painted mask needs its bitmap; without one the angles below describe the hairline.
      preset: hl.preset === 'painted' && !painted ? 'custom' : presets.includes(hl.preset) ? hl.preset : 'full',
      ...(hl.preset === 'painted' && painted ? { painted } : {}),
      front: num(hl.front, 56, 0, 140),
      temples: num(hl.temples, 64, 0, 140),
      sides: num(hl.sides, 95, 0, 150),
      nape: num(hl.nape, 132, 0, 160),
    },
    budget: [int(budget[0], 1500, 0, 20000), int(budget[1], 3500, 0, 20000)],
  };
}

/**
 * The style itself when it has every groom and card build setting, otherwise a
 * sanitised copy with the missing ones at their defaults. Cheap enough to run
 * on every document edit.
 */
export function completeStyle(style: HairStyleParams): HairStyleParams {
  const has = (part: object | undefined, like: object) => part !== undefined && Object.keys(like).every((k) => k in part);
  return has(style.groom, DEFAULT_GROOM) && has(style.build, DEFAULT_CARD_BUILD) ? style : sanitiseStyle(style);
}

/** `.ps2hair` file contents. */
export interface HairStyleFile {
  format: 'ps2cc.hair/1';
  style: HairStyleParams;
}

export function hairStyleFile(style: HairStyleParams): HairStyleFile {
  return { format: 'ps2cc.hair/1', style: sanitiseStyle(style) };
}

export function parseHairStyleFile(raw: unknown): HairStyleParams {
  const f = raw as Partial<HairStyleFile>;
  if (!f || f.format !== 'ps2cc.hair/1') throw new Error('not a PS2CC hairstyle (format ps2cc.hair/1)');
  return sanitiseStyle(f.style);
}
