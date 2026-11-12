/**
 * Quality profiles (PRD Part 2, F13). A profile sets every budget at once:
 * triangles, texture sizes, the body tier, how the character is lit in Unity
 * and which maps are baked into the diffuse. Each value stays in the
 * document's export settings, so the user can still override any of them;
 * choosing a profile again resets them all.
 */
import type { BodyMeshId, ExportSettings } from '../character/doc';

export type QualityProfileId = 'classic' | 'enhanced' | 'hero';
export type LightingModel = 'vertex' | 'pixel';
/** 'key': shadows from the key light and flashlight on other surfaces; 'self': also hair onto face, arms onto torso. */
export type ShadowMode = 'off' | 'key' | 'self';
export type TextureSize = 512 | 1024 | 2048;

export interface QualityProfile {
  id: QualityProfileId;
  label: string;
  description: string;
  triangleBudget: number;
  hardMax: number;
  /** Most triangles the card hair may use (a style's own budget is scaled to it). */
  hairBudget: number;
  bodyMesh: BodyMeshId;
  headTexture: TextureSize;
  bodyTexture: TextureSize;
  hairTexture: TextureSize;
  garmentAtlas: TextureSize;
  eyesAtlas: TextureSize;
  lighting: LightingModel;
  shadows: ShadowMode;
  /** Ambient occlusion from the whole character, multiplied into every diffuse (F16). */
  bakeAO: boolean;
  /** Sky and key light (with occlusion) baked into the diffuse, for per-vertex lighting (F16). */
  bakeLight: boolean;
}

/** The hair budget every style's own `budget` was written for. */
export const STYLE_HAIR_BUDGET = 3500;

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'PS2 budgets: 12k triangles, 512 textures, per-vertex light with lighting baked into the texture.',
    triangleBudget: 12000,
    hardMax: 15000,
    hairBudget: 3500,
    bodyMesh: 'ps2_body_8k',
    headTexture: 512,
    bodyTexture: 512,
    hairTexture: 512,
    garmentAtlas: 1024,
    eyesAtlas: 512,
    lighting: 'vertex',
    shadows: 'off',
    bakeAO: true,
    bakeLight: true,
  },
  enhanced: {
    id: 'enhanced',
    label: 'Enhanced',
    description: 'Late-era budgets: 20k triangles, 1024 textures, per-pixel light with occlusion baked into the texture.',
    triangleBudget: 20000,
    hardMax: 24000,
    hairBudget: 6000,
    bodyMesh: 'ps2_body_12k',
    headTexture: 1024,
    bodyTexture: 1024,
    hairTexture: 1024,
    garmentAtlas: 2048,
    eyesAtlas: 512,
    lighting: 'pixel',
    shadows: 'key',
    bakeAO: true,
    bakeLight: false,
  },
  hero: {
    id: 'hero',
    label: 'Hero',
    description: 'Close-up characters: 30k triangles, a 2048 head texture, per-pixel light and self-shadowing.',
    triangleBudget: 30000,
    hardMax: 36000,
    hairBudget: 9000,
    bodyMesh: 'ps2_body_16k',
    headTexture: 2048,
    bodyTexture: 1024,
    hairTexture: 1024,
    garmentAtlas: 2048,
    eyesAtlas: 512,
    lighting: 'pixel',
    shadows: 'self',
    bakeAO: true,
    bakeLight: false,
  },
};

export const QUALITY_PROFILE_IDS = Object.keys(QUALITY_PROFILES) as QualityProfileId[];
export const DEFAULT_PROFILE: QualityProfileId = 'enhanced';

/**
 * Export settings of a document saved before profiles existed (PS2CC 0.12 and
 * earlier). Missing fields take these values, so an old character exports
 * exactly as it did: 1024 textures, no baking, per-vertex light.
 */
export const LEGACY_EXPORT = {
  profile: 'classic',
  triangleBudget: 12000,
  hardMax: 15000,
  hairBudget: 3500,
  headTexture: 1024,
  bodyTexture: 1024,
  hairTexture: 1024,
  garmentAtlas: 1024,
  eyesAtlas: 512,
  lighting: 'vertex',
  shadows: 'off',
  bakeAO: false,
  bakeLight: false,
} as const satisfies Partial<ExportSettings>;

/** The export settings a profile sets (everything but the destination and file options). */
export function profileSettings(id: QualityProfileId): Pick<
  ExportSettings,
  | 'profile'
  | 'triangleBudget'
  | 'hardMax'
  | 'hairBudget'
  | 'headTexture'
  | 'bodyTexture'
  | 'hairTexture'
  | 'garmentAtlas'
  | 'eyesAtlas'
  | 'lighting'
  | 'shadows'
  | 'bakeAO'
  | 'bakeLight'
> {
  const p = QUALITY_PROFILES[id];
  return {
    profile: id,
    triangleBudget: p.triangleBudget,
    hardMax: p.hardMax,
    hairBudget: p.hairBudget,
    headTexture: p.headTexture,
    bodyTexture: p.bodyTexture,
    hairTexture: p.hairTexture,
    garmentAtlas: p.garmentAtlas,
    eyesAtlas: p.eyesAtlas,
    lighting: p.lighting,
    shadows: p.shadows,
    bakeAO: p.bakeAO,
    bakeLight: p.bakeLight,
  };
}

/** Names of the settings that differ from the profile's own values (the user's overrides). */
export function profileOverrides(ex: ExportSettings): string[] {
  const p = profileSettings(ex.profile);
  return (Object.keys(p) as (keyof typeof p)[]).filter((k) => k !== 'profile' && ex[k] !== p[k]);
}

const SIZES: TextureSize[] = [512, 1024, 2048];
const size = (v: unknown, fallback: TextureSize): TextureSize => (SIZES.includes(v as TextureSize) ? (v as TextureSize) : fallback);
const int = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : fallback;

/** Fill missing export fields (old documents get LEGACY_EXPORT) and clamp the rest. */
export function sanitiseExport(raw: Partial<ExportSettings> | undefined, base: ExportSettings): ExportSettings {
  const r = { ...LEGACY_EXPORT, ...(raw ?? {}) } as Partial<ExportSettings>;
  const profile = QUALITY_PROFILE_IDS.includes(r.profile as QualityProfileId) ? (r.profile as QualityProfileId) : 'classic';
  const hardMax = int(r.hardMax, LEGACY_EXPORT.hardMax, 1000, 100000);
  return {
    ...base,
    ...r,
    profile,
    triangleBudget: int(r.triangleBudget, LEGACY_EXPORT.triangleBudget, 1000, hardMax),
    hardMax,
    hairBudget: int(r.hairBudget, LEGACY_EXPORT.hairBudget, 500, 20000),
    headTexture: size(r.headTexture, 1024),
    bodyTexture: size(r.bodyTexture, 1024),
    hairTexture: size(r.hairTexture, 1024),
    garmentAtlas: size(r.garmentAtlas, 1024),
    eyesAtlas: size(r.eyesAtlas, 512),
    lighting: r.lighting === 'pixel' ? 'pixel' : 'vertex',
    shadows: r.shadows === 'key' || r.shadows === 'self' ? r.shadows : 'off',
    bakeAO: Boolean(r.bakeAO),
    bakeLight: Boolean(r.bakeLight),
  };
}

/** Scale a style's hair budget ([min, max] written for 3,500 triangles) to the document's hair budget. */
export function scaledHairBudget(budget: [number, number], hairBudget: number): [number, number] {
  const f = hairBudget / STYLE_HAIR_BUDGET;
  if (Math.abs(f - 1) < 1e-9) return budget;
  return [Math.round(budget[0] * f), Math.round(budget[1] * f)];
}
