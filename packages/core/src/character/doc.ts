/**
 * The saved character document (.ps2char, JSON, versioned). PRD 4.3.
 *
 * Only data the user chose is stored; everything else is derived by the
 * engine. Assets are referenced by stable ids ("mh:clothes/male_casualsuit01",
 * "user:garment/my_jacket"), never by file path.
 */
import { validateAtlas, type AtlasSpec } from '../hair/atlas';
import { sanitiseAdjust, sanitiseStyle, type HairAdjust, type HairStyleParams } from '../hair/style';
import { sanitiseHairColour, type HairColour } from '../hair/strand-atlas';
import { sanitiseCardBrows, sanitiseFur, type CardBrows, type FurTrim } from '../hair/surface-cards';
import { newLayer, sanitiseSkin } from '../skin/layers';
import { DEFAULT_EYE_LOOK, sanitiseEyeLook, type EyeLook } from '../eyes/eye-texture';
import { sanitiseLook, type GarmentLook } from '../wardrobe/look';
import { DEFAULT_MACROS, normaliseEthnic, type MacroValues } from '../morph/macros';
import { MEASURE_BY_ID, type MeasureId } from '../anthro/definitions';
import { ARKIT_UNITS } from '../expression/faceunits';
import { sanitiseSculpt, sanitiseUserTargets, type SculptData } from '../sculpt/layer';
import {
  DEFAULT_PROFILE,
  profileSettings,
  sanitiseExport,
  type LightingModel,
  type QualityProfileId,
  type ShadowMode,
  type TextureSize,
} from '../quality/profiles';

export const CHARACTER_SCHEMA = 1;

export type BodyMeshId = 'ps2_body_8k' | 'ps2_body_10k' | 'ps2_body_12k' | 'ps2_body_16k' | 'ps2_body_20k' | 'ps2_body_full';
export type GarmentSlotName = 'top' | 'bottom' | 'full' | 'outer' | 'shoes' | 'hat' | 'gloves' | 'accessory';
export type BlendMode = 'normal' | 'multiply' | 'overlay' | 'screen';
export type RegionMask = 'none' | 'face' | 'body' | 'hands';

export interface Tint {
  /** Multiplier colour, linear 0..1 per channel. */
  color: [number, number, number];
  brightness: number;
}

export interface SkinLayer {
  id: string;
  kind:
    | 'tone'
    | 'darkCircles'
    | 'eyeBags'
    | 'stubble'
    | 'lips'
    | 'eyeliner'
    | 'blush'
    | 'freckles'
    | 'dirt'
    | 'bruises'
    | 'sweat'
    // Part 2 F19: the mouth interior darkening towards the throat, and painted eyebrows.
    | 'mouth'
    | 'brows'
    // Painted eyelashes (D-146).
    | 'lashes'
    // Part 2 F19 micro-detail: tileable pores and stubble hairs, masked per region.
    | 'pores'
    | 'stubbleHair'
    | 'image'
    // Baked from the assembled character by the bake engine (Part 2 F16).
    | 'occlusion'
    | 'cavity'
    | 'lightBake'
    // Hair v2 (Part 2 F15): short hair painted on the scalp, drawn from the hairstyle.
    | 'scalpHair';
  enabled: boolean;
  opacity: number;
  blend: BlendMode;
  mask: RegionMask;
  /** For kind 'image': library asset id of a PNG authored in hm08 UV space. */
  image?: string;
  /** For kind 'brows': what the brow brush added and took away (painted-hair.ts BROW_GRID, hex). */
  paint?: string;
  /** Kind-specific parameters (colour, hue shift, density...). */
  params: Record<string, number | string>;
}

export interface PhotoSpec {
  /** Library id of the front photo (user:photos/...). */
  image: string;
  /** Opacity of the projected face over the base skin. */
  strength: number;
  /** Match the photo's colour to the skin around the face (LAB mean and spread). */
  colourMatch: boolean;
  /** MediaPipe landmarks found in the photo: x, y (0..1 of width and height), z per landmark. */
  landmarks?: number[];
  /** Photo size in pixels when the landmarks were found. */
  width?: number;
  height?: number;
  /**
   * 'ibug68': the landmarks are 68 points placed by hand (x, y, 0 each; PRD
   * Part 3, F33) instead of MediaPipe's 478.
   */
  landmarkSet?: 'mediapipe' | 'ibug68';
  /** Face-skin mask from the segmenter (PRD Part 3, F33): a PNG data URL, red on face skin. Used when `useMask` is not false. */
  mask?: string;
  useMask?: boolean;
  /** Colours picked from the photo's hair and face skin (sRGB 0..255), kept so they can be applied again. */
  picked?: { hair?: [number, number, number]; skin?: [number, number, number] };
  /** Part 2 F19: side photos (three-quarter views work best), blended with the front one for full-head coverage. */
  sides?: { left?: SidePhoto | null; right?: SidePhoto | null };
}

/** A side photo for the three-photo projection (Part 2 F19). */
export interface SidePhoto {
  image: string;
  landmarks: number[];
  width: number;
  height: number;
  landmarkSet?: 'mediapipe' | 'ibug68';
  mask?: string;
}

export interface SkinStack {
  base: string; // e.g. "mh:skins/young_caucasian_male"
  /** Overlay layers, bottom first (the last one wins). */
  layers: SkinLayer[];
  /** Projected face photo (PRD F7), composited right above the base skin. */
  photo?: PhotoSpec | null;
}

export interface GarmentSlot {
  slot: GarmentSlotName;
  asset: string;
  texture?: string | null; // library texture id overriding the diffuse
  /** Texture Studio (Part 2 F17): the garment as painted in Material Painter, shown over `texture` (library image). */
  paint?: string | null;
  tint: Tint;
  dirt: number; // 0..1
  hideBody: boolean;
  /** Hair v2 (Part 2 F15): fur cards grown along the garment's collar, cuffs or hem. */
  fur?: FurTrim;
  /** Part 2 F18: material zones, seams, folds and decals; absent or null = the garment's own texture as before. */
  look?: GarmentLook | null;
}

/**
 * A garment reshaped in Garment Studio for this character only (D-151): the
 * garment bound to the reference body like an imported one, as a proxy
 * container (JSON header and base64 binary). Worn by its id ("edit:…").
 * Never changed once made: a new edit replaces it.
 */
export interface GarmentEdit {
  /** The library garment it was made from (name, licence and credits come from it). */
  base: string;
  meta: Record<string, unknown>;
  bin: string;
}

export interface HairSpec {
  mode: 'none' | 'mesh' | 'cards';
  /** mode 'mesh': MHCLO hair asset id. */
  asset?: string;
  /** mode 'mesh': user texture overriding the asset's diffuse. */
  texture?: string | null;
  /** mode 'cards': generated style parameters (see hair/style.ts). */
  style?: HairStyleParams;
  /** mode 'cards': the card atlas (texture + tagged regions); null = the built-in default atlas. */
  atlas?: AtlasSpec | null;
  /** mode 'cards': dithered transparency on the outer layer instead of a hard cutout. */
  ditherOuter?: boolean;
  /**
   * mode 'cards', Hair v2: the colour, as a gradient map over the greyscale
   * strand atlas. Hair from before v2 has none and keeps its tinted atlas.
   */
  colour?: HairColour;
  /** mode 'cards': the Character Creator's length, volume and fringe sliders on top of the style. */
  adjust?: HairAdjust;
  tint: Tint;
  alphaThreshold: number;
}

export interface AssetRef {
  asset: string | null;
  tint?: Tint;
  opacity?: number;
  /** Texture override, e.g. an eye colour (mh:eyecolour/...) or a library image URL. */
  texture?: string | null;
  /** Eyebrows only, Hair v2 (Part 2 F15): card brows grown on the eyebrow mesh instead of the mesh itself. */
  cards?: CardBrows | null;
  /** Eyes only, Part 2 F19: a generated eye (iris library, sclera, pupil, lid shadow) instead of `texture`. */
  look?: EyeLook | null;
}

export interface ExportSettings {
  /** The quality profile these settings came from (F13); the fields below may override it. */
  profile: QualityProfileId;
  triangleBudget: number;
  hardMax: number;
  /** Most triangles for card hair; each style's budget is scaled to it. */
  hairBudget: number;
  headTexture: TextureSize;
  bodyTexture: TextureSize;
  hairTexture: TextureSize;
  garmentAtlas: TextureSize;
  eyesAtlas: TextureSize;
  /** How Unity lights the character: per vertex (Classic) or per pixel. */
  lighting: LightingModel;
  shadows: ShadowMode;
  /** Bake ambient occlusion from the whole character into the diffuse textures. */
  bakeAO: boolean;
  /** Bake sky and key light occlusion into the diffuse (for per-vertex lighting). */
  bakeLight: boolean;
  writeGlb: boolean;
  tPose: boolean;
  unityProject?: string | null;
}

export interface CharacterDoc {
  schema: typeof CHARACTER_SCHEMA;
  id: string;
  name: string;
  macros: MacroValues;
  /** modifier fullName -> value, only non-default (non-macro) ones. */
  modifiers: Record<string, number>;
  bodyMesh: BodyMeshId;
  skin: SkinStack;
  eyes: AssetRef;
  eyebrows: AssetRef;
  eyelashes: AssetRef;
  teeth?: AssetRef;
  /** Part 2 F19: the tongue (with the teeth, at most 600 triangles). */
  tongue?: AssetRef;
  garments: GarmentSlot[];
  /** Garment Studio edits worn by this character, by id (D-151). */
  garmentEdits?: Record<string, GarmentEdit>;
  hair: HairSpec;
  expressionsToBake: string[];
  export: ExportSettings;
  /**
   * Measurements the user typed for this character (PRD Part 3, F24), in cm
   * and kg. Kept so the Body tab shows them again; the body itself is the
   * ordinary slider values the solve produced.
   */
  measurementTargets?: Partial<Record<MeasureId, number>>;
  /** Sculpted displacement of the body (PRD Part 3, F27), added after every slider. Never changed in place: replaced. */
  sculpt?: SculptData;
  /** Sliders made from sculpts (library .ps2target files) and their values, -1..1. */
  userTargets?: Record<string, number>;
}

export const NEUTRAL_TINT: Tint = Object.freeze({ color: [1, 1, 1], brightness: 1 }) as Tint;

/**
 * The blendshapes a new character exports (PRD Part 3, F25): the 52 ARKit face
 * units under their ARKit names. Documents from before 0.25.0 keep their own
 * list (CLASSIC_EXPRESSIONS), which the expression map still makes.
 */
export const DEFAULT_EXPRESSIONS: string[] = [...ARKIT_UNITS];

/** The blendshapes characters exported before 0.25.0. */
export const CLASSIC_EXPRESSIONS = [
  'blink_L',
  'blink_R',
  'jawOpen',
  'smile',
  'frown',
  'browsUp',
  'browsDown',
  'squint',
  'AA',
  'EE',
  'IH',
  'OH',
  'OU',
  'FV',
  'MBP',
];

export function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function defaultCharacter(name = 'New character', profileId: QualityProfileId = DEFAULT_PROFILE): CharacterDoc {
  return withBakeLayers({
    schema: CHARACTER_SCHEMA,
    id: newId(),
    name,
    macros: { ...DEFAULT_MACROS },
    modifiers: {},
    bodyMesh: bodyMeshFor(profileId), // leaves room for hair and clothes in the profile's budget (D-031, F13)
    // Part 2 F19: skin pores (micro-detail), and an open mouth reads as a mouth (dark towards the throat).
    // Brows and lashes are painted on the skin, with no geometry (D-146).
    skin: { base: 'mh:skins/young_caucasian_male', layers: [newLayer('pores'), newLayer('mouth'), newLayer('brows'), newLayer('lashes')], photo: null },
    eyes: { asset: 'mh:eyes/low-poly', look: { ...DEFAULT_EYE_LOOK } },
    eyebrows: { asset: null, tint: { ...NEUTRAL_TINT, color: [1, 1, 1] }, opacity: 1 },
    eyelashes: { asset: null, opacity: 1 },
    // Part 2 F19: low-poly teeth and tongue, so an open mouth reads correctly.
    teeth: { asset: 'mh:teeth/teeth_base' },
    tongue: { asset: 'mh:tongue/tongue01' },
    garments: [],
    hair: { mode: 'none', tint: { ...NEUTRAL_TINT, color: [1, 1, 1] }, alphaThreshold: 0.5 },
    expressionsToBake: [...DEFAULT_EXPRESSIONS],
    export: {
      ...profileSettings(profileId),
      writeGlb: false,
      tPose: false,
      unityProject: null,
    },
  });
}

/**
 * Make sure the skin stack has the baked layers the export settings ask for
 * (F16): occlusion and cavity when baking occlusion, light when baking light.
 * They go at the bottom of the stack, right above the base skin. Layers the
 * user already has are left alone. Returns the document (changed in place).
 */
export function withBakeLayers(doc: CharacterDoc): CharacterDoc {
  const has = (k: SkinLayer['kind']) => doc.skin.layers.some((l) => l.kind === k);
  const add: SkinLayer[] = [];
  if (doc.export.bakeAO && !has('occlusion')) add.push(newLayer('occlusion'), newLayer('cavity'));
  if (doc.export.bakeLight && !has('lightBake')) add.push(newLayer('lightBake'));
  if (add.length) doc.skin.layers = [...add, ...doc.skin.layers];
  return doc;
}

/** Does the hair want short hair painted on the scalp (Hair v2 card hair with its scalp layer on)? */
export function wantsScalpLayer(doc: CharacterDoc): boolean {
  return doc.hair.mode === 'cards' && Boolean(doc.hair.colour) && Boolean(doc.hair.style?.scalpLayer?.enabled);
}

/**
 * Add the scalp hair layer to the skin stack when the hair wants one (at the
 * bottom, so the baked occlusion darkens it under the locks like the skin, at
 * the style's opacity), and drop it when the hair no longer does. Edits the
 * document in place and returns it.
 */
export function withScalpLayer(doc: CharacterDoc): CharacterDoc {
  const at = doc.skin.layers.findIndex((l) => l.kind === 'scalpHair');
  if (wantsScalpLayer(doc)) {
    if (at < 0) doc.skin.layers = [newLayer('scalpHair', { opacity: doc.hair.style!.scalpLayer.opacity }), ...doc.skin.layers];
  } else if (at >= 0) {
    doc.skin.layers = doc.skin.layers.filter((l) => l.kind !== 'scalpHair');
  }
  return doc;
}

/** The body tier a profile starts with. */
export function bodyMeshFor(id: QualityProfileId): BodyMeshId {
  return id === 'classic' ? 'ps2_body_8k' : id === 'enhanced' ? 'ps2_body_12k' : 'ps2_body_16k';
}

export class CharacterDocError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parse and validate a saved document. Unknown fields are dropped, missing
 * optional fields get defaults, invalid numbers are rejected.
 */
export function parseCharacter(json: unknown): CharacterDoc {
  if (typeof json !== 'object' || json === null) throw new CharacterDocError('not an object');
  const raw = json as Partial<CharacterDoc> & Record<string, unknown>;
  if (raw.schema !== CHARACTER_SCHEMA) {
    throw new CharacterDocError(`unsupported schema ${String(raw.schema)} (expected ${CHARACTER_SCHEMA})`);
  }
  const base = defaultCharacter(typeof raw.name === 'string' ? raw.name : 'Character');
  const macros: MacroValues = { ...base.macros };
  if (raw.macros && typeof raw.macros === 'object') {
    for (const k of Object.keys(macros) as (keyof MacroValues)[]) {
      const v = (raw.macros as unknown as Record<string, unknown>)[k];
      if (v !== undefined) {
        if (!isNum(v)) throw new CharacterDocError(`macro ${k} is not a number`);
        macros[k] = Math.min(1, Math.max(0, v));
      }
    }
  }
  // Normalise only a mix that does not already sum to 1: renormalising a normalised mix moves the
  // last bit, and a loaded character must be exactly the saved one (PRD M9 round trip).
  if (Math.abs(macros.african + macros.asian + macros.caucasian - 1) > 1e-12) normaliseEthnic(macros);
  const modifiers: Record<string, number> = {};
  if (raw.modifiers && typeof raw.modifiers === 'object') {
    for (const [k, v] of Object.entries(raw.modifiers)) {
      if (!isNum(v)) throw new CharacterDocError(`modifier ${k} is not a number`);
      modifiers[k] = v;
    }
  }
  const { measurementTargets: rawTargets, sculpt: rawSculpt, userTargets: rawUser, ...rest } = raw as CharacterDoc;
  const targets = sanitiseMeasurementTargets(rawTargets);
  const sculpt = sanitiseSculpt(rawSculpt);
  const userTargets = sanitiseUserTargets(rawUser);
  return {
    ...base,
    ...(rest as CharacterDoc),
    schema: CHARACTER_SCHEMA,
    id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    name: typeof raw.name === 'string' ? raw.name : base.name,
    macros,
    modifiers,
    skin: sanitiseSkin(raw.skin, base.skin.base),
    garments: Array.isArray(raw.garments)
      ? raw.garments.map((g) => {
          if (!g) return g;
          let out = g;
          if (g.fur !== undefined) out = { ...out, fur: sanitiseFur(g.fur) };
          if (g.look !== undefined && g.look !== null) out = { ...out, look: sanitiseLook(g.look) };
          return out;
        })
      : [],
    garmentEdits: sanitiseGarmentEdits(raw.garmentEdits, Array.isArray(raw.garments) ? raw.garments : []),
    hair: sanitiseHair({ ...base.hair, ...(raw.hair ?? {}) }),
    eyebrows: raw.eyebrows?.cards ? { ...raw.eyebrows, cards: sanitiseCardBrows(raw.eyebrows.cards) } : (raw.eyebrows ?? base.eyebrows),
    eyes: raw.eyes ? { ...raw.eyes, look: raw.eyes.look ? sanitiseEyeLook(raw.eyes.look) : null } : base.eyes,
    // Documents from before Part 2 F19 had no tongue and stay as they were saved.
    teeth: raw.teeth ?? { asset: null },
    tongue: raw.tongue ?? { asset: null },
    // Old documents (no profile) keep the settings they were made with (LEGACY_EXPORT).
    export: sanitiseExport(raw.export, base.export),
    expressionsToBake: Array.isArray(raw.expressionsToBake) ? raw.expressionsToBake : base.expressionsToBake,
    // No field at all without targets, so documents from before Part 3 load and save exactly as they were.
    ...(targets ? { measurementTargets: targets } : {}),
    ...(sculpt ? { sculpt } : {}),
    ...(userTargets ? { userTargets } : {}),
  };
}

/** Keeps only solvable measurements with sensible values; no field at all when there are none. */
export function sanitiseMeasurementTargets(raw: unknown): Partial<Record<MeasureId, number>> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Partial<Record<MeasureId, number>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = MEASURE_BY_ID.get(k as MeasureId);
    if (def?.target && isNum(v) && v > 0 && v < 400) out[def.id] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitiseHair(h: HairSpec): HairSpec {
  const mode = h.mode === 'mesh' || h.mode === 'cards' ? h.mode : 'none';
  const out: HairSpec = { ...h, mode };
  if (mode === 'cards') {
    out.style = sanitiseStyle(h.style);
    out.atlas = h.atlas ? validateAtlas(h.atlas) : null;
  }
  if (h.colour !== undefined) out.colour = sanitiseHairColour(h.colour);
  if (h.adjust !== undefined) out.adjust = sanitiseAdjust(h.adjust);
  return out;
}

/**
 * Stable, pretty JSON for saving. The document goes through parseCharacter
 * first, so what is written is exactly what loading gives back (same fields,
 * same key order): save -> load -> save is byte-identical (PRD M9 round trip).
 * Modifier keys are sorted so diffs are readable.
 */
export function serializeCharacter(doc: CharacterDoc): string {
  const canonical = parseCharacter(JSON.parse(JSON.stringify(doc)));
  const modifiers: Record<string, number> = {};
  for (const k of Object.keys(canonical.modifiers).sort()) modifiers[k] = canonical.modifiers[k]!;
  return JSON.stringify({ ...canonical, modifiers }, null, 2) + '\n';
}

export function cloneCharacter(doc: CharacterDoc): CharacterDoc {
  // Garment edits and the sculpt are large and never change once made: copies (and undo steps) share them.
  const { garmentEdits, sculpt, ...rest } = doc;
  const out = structuredClone(rest) as CharacterDoc;
  if (garmentEdits) out.garmentEdits = { ...garmentEdits };
  if (sculpt) out.sculpt = sculpt;
  return out;
}

/** Keep only well-formed garment edits that a worn garment uses. */
export function sanitiseGarmentEdits(raw: unknown, garments: readonly GarmentSlot[]): Record<string, GarmentEdit> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const worn = new Set(garments.map((g) => g?.asset));
  const out: Record<string, GarmentEdit> = {};
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    const v = e as Partial<GarmentEdit> | null;
    if (!worn.has(id) || !v || typeof v.base !== 'string' || typeof v.bin !== 'string' || !v.meta || typeof v.meta !== 'object') continue;
    out[id] = v as GarmentEdit;
  }
  return Object.keys(out).length ? out : undefined;
}
