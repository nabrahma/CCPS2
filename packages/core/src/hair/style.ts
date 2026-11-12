/**
 * Hairstyle parameters (PRD F5 steps 3–8). A style is plain data, saved as
 * `.ps2hair`; generation from it is deterministic for a given seed and body.
 * Lengths and offsets are in metres.
 */
import { ATLAS_TAGS, type AtlasTag } from './atlas';
import { DEFAULT_CARD_BUILD, type CardBuildParams } from './cards-from-curves';
import { isPaintString } from './hairline-paint';
import { STRAND_PRESETS, type StrandPreset } from './strand-atlas';

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

/**
 * A guide combed in Hair Studio (PRD F15). Stored on the NEUTRAL body, so the
 * same groom fits every character: the root is a point of an hm08 scalp
 * triangle, the shape is offsets from the root in the neutral head's frame,
 * scaled by the head's size on the current body.
 */
export interface AuthoredGuide {
  /** hm08 triangle corners and barycentric weights: [a, b, c, wa, wb, wc]. */
  root: [number, number, number, number, number, number];
  /** Points relative to the root (metres), flat xyz, the first just off the skin at the root. */
  points: number[];
  /** Lock tool: width and curl of the locks that follow this guide (multipliers; 1 is the style's own). */
  lockWidth?: number;
  lockCurl?: number;
}

/**
 * One card placed by hand (Hair Studio's card mode, D-114): one curve makes
 * exactly one card, as in the "Hair cards from curves" workflow where the
 * artist places every curve. Stored on the neutral head like an authored guide.
 */
export interface AuthoredCard extends AuthoredGuide {
  /** 'lock': a wide ribbon bowed across its width (the hair's mass); 'card': a flat detail card. */
  kind: 'lock' | 'card';
  /** Width at the root on the neutral head, metres. */
  width: number;
  /** Which texture strips it uses, and which of them (wrapping round the atlas's strips with that tag). */
  tag: AtlasTag;
  region: number;
  /** The strip mirrored across the card. */
  flip?: boolean;
  /** Twist from root to tip, in half turns (-1..1). */
  twist?: number;
  /** 0..1 draw order from the inside out (locks always go under the cards). */
  layer: number;
  /** 0..1 the card's own random tip tilt (as the generator gave it). */
  random?: number;
}

/** Most hand-placed cards a style may carry. */
export const MAX_AUTHORED_CARDS = 4000;

/**
 * Hair mass (PRD F15 layer 2): children clustered into locks, each a wide
 * ribbon curved across its width, mostly opaque. Locks make the silhouette and
 * hide the scalp; detail cards go over them.
 */
export interface LockParams {
  enabled: boolean;
  /** Most locks; fewer when the budget is tight. */
  count: number;
  /** Width at the root in metres (about 4 to 12 cm). */
  width: number;
  /** 0..1 random variation of the width. */
  widthJitter: number;
  /** 0..1 how far a lock curves across its width (0 is flat). */
  bow: number;
  /** Quads across a lock. */
  columns: number;
  /** 0..1 narrowing towards the tip. */
  taper: number;
  /** 0..1 share of the hair budget (after the scalp shell) that locks may use. */
  share: number;
  /** Lift of the lock layer off the scalp at the roots, metres. */
  lift: number;
}

export const DEFAULT_LOCKS: LockParams = { enabled: false, count: 60, width: 0.07, widthJitter: 0.3, bow: 0.35, columns: 2, taper: 0.35, share: 0.55, lift: 0.004 };

/**
 * Scalp layer (PRD F15 layer 1): short hair painted into the head texture
 * along the groom's flow, dense on the scalp and fading softly at the
 * hairline, sideburns and nape. It lands in the skin stack as an editable layer.
 */
export interface ScalpLayerParams {
  enabled: boolean;
  opacity: number;
  /** 0..1 width of the fade at the hairline. */
  softness: number;
  /** 0..1 strand contrast. */
  density: number;
}

export const DEFAULT_SCALP_LAYER: ScalpLayerParams = { enabled: false, opacity: 0.9, softness: 0.5, density: 0.6 };

export interface HairStyleParams {
  name: string;
  seed: number;
  /** Cards in the outermost layer; inner layers use fewer. */
  guides: number;
  length: { front: number; sides: number; back: number; top: number };
  /** 0..1 random variation of each strand's length. */
  lengthJitter: number;
  part: {
    side: PartSide;
    /** -1..1 across the head (negative = the character's right). */
    position: number;
    /** A parting drawn on the scalp in Hair Studio: a polyline on the neutral head (flat xyz). Replaces side and position. */
    line?: number[];
    /**
     * How far round the head the parting reaches, degrees from the front (Hair v2). Behind it
     * the hair falls out from the head's middle instead of away from the parting. Unset: the whole head.
     */
    reach?: number;
  };
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
  groom: GroomParams & {
    /** Guides combed in Hair Studio; when present they replace the guides made from the sliders. */
    curves?: AuthoredGuide[];
    /**
     * Hand-placed cards (Hair Studio's card mode); when present they replace the generated locks and
     * cards, one card per curve. The guides above still give the scalp layer its flow when there are no cards.
     */
    cards?: AuthoredCard[];
  };
  /** Hair mass under the detail cards. */
  locks: LockParams;
  /** Short hair painted into the head texture. */
  scalpLayer: ScalpLayerParams;
  /** The strand look of the v2 atlas (straight fine, coarse, wavy, curly, stubble). */
  strands: StrandPreset;
  /** How cards are built on the curves: the inputs of the "Hair cards from curves" node group. */
  build: CardBuildParams;
  shell: {
    enabled: boolean;
    offset: number;
    /**
     * Hair v2: how far the shell reaches towards the hairline (hairline ratio; 1 is all the way).
     * Below 1 it is a cap over the crown that fills gaps between locks and ends well inside the
     * hairline, where the scalp layer takes over. Unset: all the way (Part 1).
     */
    reach?: number;
  };
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
  locks: { ...DEFAULT_LOCKS },
  scalpLayer: { ...DEFAULT_SCALP_LAYER },
  strands: 'straightFine',
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
  // Styles from before Hair v2 have no locks and no scalp layer, and keep looking as they did.
  const lk = { ...d.locks, ...(r.locks ?? {}) };
  const sl = { ...d.scalpLayer, ...(r.scalpLayer ?? {}) };
  const curves = sanitiseGuides(g.curves);
  const cards = sanitiseCards(g.cards);
  const line = sanitiseLine(r.part?.line);
  return {
    name: typeof r.name === 'string' && r.name ? r.name.slice(0, 64) : d.name,
    seed: int(r.seed, d.seed, 0, 2 ** 31 - 1),
    guides: int(r.guides, d.guides, 0, 600),
    length: { front: num(len.front, 0.07, 0, 0.8), sides: num(len.sides, 0.06, 0, 0.8), back: num(len.back, 0.07, 0, 0.8), top: num(len.top, 0.08, 0, 0.8) },
    lengthJitter: num(r.lengthJitter, d.lengthJitter, 0, 1),
    part: {
      side: sides.includes(r.part?.side as PartSide) ? r.part!.side : d.part.side,
      position: num(r.part?.position, 0, -1, 1),
      ...(line ? { line } : {}),
      ...(typeof r.part?.reach === 'number' && Number.isFinite(r.part.reach) ? { reach: Math.min(180, Math.max(20, r.part.reach)) } : {}),
    },
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
      ...(curves ? { curves } : {}),
      ...(cards ? { cards } : {}),
    },
    locks: {
      enabled: Boolean(lk.enabled),
      count: int(lk.count, d.locks.count, 0, 400),
      width: num(lk.width, d.locks.width, 0.02, 0.16),
      widthJitter: num(lk.widthJitter, d.locks.widthJitter, 0, 1),
      bow: num(lk.bow, d.locks.bow, 0, 1),
      columns: int(lk.columns, d.locks.columns, 1, 4),
      taper: num(lk.taper, d.locks.taper, 0, 1),
      share: num(lk.share, d.locks.share, 0, 1),
      lift: num(lk.lift, d.locks.lift, 0, 0.03),
    },
    scalpLayer: {
      enabled: Boolean(sl.enabled),
      opacity: num(sl.opacity, d.scalpLayer.opacity, 0, 1),
      softness: num(sl.softness, d.scalpLayer.softness, 0, 1),
      density: num(sl.density, d.scalpLayer.density, 0, 1),
    },
    strands: (STRAND_PRESETS as readonly string[]).includes(r.strands as string) ? (r.strands as StrandPreset) : d.strands,
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
    shell: {
      enabled: Boolean(r.shell?.enabled ?? d.shell.enabled),
      offset: num(r.shell?.offset, d.shell.offset, 0, 0.02),
      ...(typeof r.shell?.reach === 'number' && Number.isFinite(r.shell.reach) ? { reach: Math.min(1, Math.max(0.3, r.shell.reach)) } : {}),
    },
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

/** Authored guides read from a file: whole ones only, at most 400, every number finite. */
function sanitiseGuides(raw: unknown): AuthoredGuide[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: AuthoredGuide[] = [];
  for (const g of raw.slice(0, 400) as Partial<AuthoredGuide>[]) {
    const root = g?.root;
    const pts = g?.points;
    if (!Array.isArray(root) || root.length !== 6 || !root.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    if (!Array.isArray(pts) || pts.length < 6 || pts.length % 3 !== 0 || pts.length > 96) continue;
    if (!pts.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 2)) continue;
    const guide: AuthoredGuide = { root: [Math.round(root[0]!), Math.round(root[1]!), Math.round(root[2]!), root[3]!, root[4]!, root[5]!], points: pts.slice() };
    if (typeof g.lockWidth === 'number' && Number.isFinite(g.lockWidth)) guide.lockWidth = Math.min(3, Math.max(0.2, g.lockWidth));
    if (typeof g.lockCurl === 'number' && Number.isFinite(g.lockCurl)) guide.lockCurl = Math.min(1, Math.max(0, g.lockCurl));
    out.push(guide);
  }
  return out.length ? out : undefined;
}

/** Hand-placed cards read from a file: whole ones only, every number finite and in range. */
function sanitiseCards(raw: unknown): AuthoredCard[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: AuthoredCard[] = [];
  const clamp = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  for (const c of raw.slice(0, MAX_AUTHORED_CARDS) as Partial<AuthoredCard>[]) {
    const g = sanitiseGuides([c])?.[0];
    if (!g) continue;
    const card: AuthoredCard = {
      root: g.root,
      points: g.points,
      kind: c.kind === 'lock' ? 'lock' : 'card',
      width: clamp(c.width, 0.002, 0.2, 0.03),
      tag: ATLAS_TAGS.includes(c.tag as AtlasTag) ? (c.tag as AtlasTag) : 'clump',
      region: Math.round(clamp(c.region, 0, 255, 0)),
      layer: clamp(c.layer, 0, 1, 1),
    };
    if (c.flip === true) card.flip = true;
    if (typeof c.twist === 'number' && Number.isFinite(c.twist) && c.twist !== 0) card.twist = Math.min(1, Math.max(-1, c.twist));
    if (typeof c.random === 'number' && Number.isFinite(c.random)) card.random = Math.min(1, Math.max(0, c.random));
    out.push(card);
  }
  return out.length ? out : undefined;
}

function sanitiseLine(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length < 6 || raw.length % 3 !== 0 || raw.length > 300) return undefined;
  return raw.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 3) ? (raw as number[]).slice() : undefined;
}

/**
 * The style itself when it has every groom, lock and card build setting,
 * otherwise a sanitised copy with the missing ones at their defaults. Cheap
 * enough to run on every document edit.
 */
export function completeStyle(style: HairStyleParams): HairStyleParams {
  const has = (part: object | undefined, like: object) => part !== undefined && Object.keys(like).every((k) => k in part);
  const complete =
    has(style.groom, DEFAULT_GROOM) && has(style.build, DEFAULT_CARD_BUILD) && has(style.locks, DEFAULT_LOCKS) && has(style.scalpLayer, DEFAULT_SCALP_LAYER) && style.strands !== undefined;
  return complete ? style : sanitiseStyle(style);
}

/**
 * The Character Creator's sliders on top of an authored style (PRD F15):
 * length, volume and fringe as multipliers, so the style asset stays as it was made.
 */
export interface HairAdjust {
  length: number;
  volume: number;
  fringe: number;
}

export const NEUTRAL_ADJUST: HairAdjust = { length: 1, volume: 1, fringe: 1 };

export function sanitiseAdjust(raw: unknown): HairAdjust {
  const r = (raw ?? {}) as Partial<HairAdjust>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0.3, v)) : 1);
  return { length: num(r.length), volume: num(r.volume), fringe: num(r.fringe) };
}

/** A copy of the style with the adjustments applied (the style itself when they are all 1). */
export function adjustStyle(style: HairStyleParams, adjust: HairAdjust | undefined): HairStyleParams {
  if (!adjust || (adjust.length === 1 && adjust.volume === 1 && adjust.fringe === 1)) return style;
  const s = structuredClone(style);
  const L = adjust.length;
  s.length = { front: s.length.front * L * adjust.fringe, sides: s.length.sides * L, back: s.length.back * L, top: s.length.top * L };
  s.bangs.length *= adjust.fringe;
  s.ponytail.length *= L;
  s.volume *= adjust.volume;
  s.locks.lift *= adjust.volume;
  // Authored guides and hand-placed cards grow or shrink from their roots; the ones that hang forward by the fringe as well.
  const scaled = <G extends AuthoredGuide>(g: G): G => {
    const forward = g.points[g.points.length - 1]! > 0.02;
    const k = L * (forward ? adjust.fringe : 1);
    return { ...g, points: g.points.map((v) => v * k) };
  };
  if (s.groom.curves) s.groom.curves = s.groom.curves.map(scaled);
  if (s.groom.cards) s.groom.cards = s.groom.cards.map(scaled);
  return s;
}

/** Triangles a style's budget is written for (Part 1's hair budget); profiles scale it (F13). */
export const STYLE_BUDGET_BASE = 3500;

/**
 * A style fitted to a profile's hair budget (F13): its budget, its cards and
 * its locks scale with it, so a bigger budget buys denser hair, not just room for it.
 */
export function styleForBudget(style: HairStyleParams, hairBudget: number): HairStyleParams {
  const f = hairBudget / STYLE_BUDGET_BASE;
  if (Math.abs(f - 1) < 1e-9) return style;
  return {
    ...style,
    guides: Math.max(1, Math.round(style.guides * f)),
    locks: { ...style.locks, count: Math.round(style.locks.count * Math.sqrt(f)) },
    budget: [Math.round(style.budget[0] * f), Math.round(style.budget[1] * f)],
  };
}

/** `.ps2hair` file contents. Version 2 adds locks, the scalp layer, strands, an authored groom and hand-placed cards. */
export interface HairStyleFile {
  format: 'ps2cc.hair/2';
  style: HairStyleParams;
}

export function hairStyleFile(style: HairStyleParams): HairStyleFile {
  return { format: 'ps2cc.hair/2', style: sanitiseStyle(style) };
}

export function parseHairStyleFile(raw: unknown): HairStyleParams {
  const f = raw as { format?: string; style?: unknown };
  if (!f || (f.format !== 'ps2cc.hair/1' && f.format !== 'ps2cc.hair/2')) throw new Error('not a PS2CC hairstyle (format ps2cc.hair/1 or ps2cc.hair/2)');
  return sanitiseStyle(f.style);
}
