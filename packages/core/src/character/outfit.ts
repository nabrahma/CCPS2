/**
 * Outfits (Part 2 F20): a set of garments, each with its tint, grime, look and
 * fur, put on together from the Character Creator's Wardrobe step. Two ship
 * with the app (the benchmark outfits); users save their own as `.ps2outfit`.
 */
import { sanitiseFur } from '../hair/surface-cards';
import type { GarmentDefaults } from '../proxy/proxy';
import { newLook, sanitiseLook } from '../wardrobe/look';
import { cloneCharacter, NEUTRAL_TINT, type CharacterDoc, type GarmentSlot, type GarmentSlotName } from './doc';

export const GARMENT_SLOT_NAMES: readonly GarmentSlotName[] = ['top', 'bottom', 'full', 'outer', 'shoes', 'hat', 'gloves', 'accessory'];

export interface Outfit {
  id: string;
  label: string;
  garments: GarmentSlot[];
}

/** `.ps2outfit` file contents. */
export interface OutfitFile {
  format: 'ps2cc.outfit/1';
  outfit: { label: string; garments: GarmentSlot[] };
}

/** The most garments an outfit keeps (more than anyone wears at once). */
export const MAX_OUTFIT_GARMENTS = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

/** A garment slot read from a file: unknown fields dropped, numbers clamped. Null when it is not a garment. */
export function sanitiseGarmentSlot(raw: unknown): GarmentSlot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Partial<GarmentSlot> & Record<string, unknown>;
  if (typeof g.asset !== 'string' || !g.asset || g.asset.length > 200) return null;
  const slot = GARMENT_SLOT_NAMES.includes(g.slot as GarmentSlotName) ? (g.slot as GarmentSlotName) : 'accessory';
  const c = Array.isArray(g.tint?.color) ? g.tint.color : [1, 1, 1];
  const out: GarmentSlot = {
    slot,
    asset: g.asset,
    tint: { color: [num(c[0], 1, 0, 2), num(c[1], 1, 0, 2), num(c[2], 1, 0, 2)], brightness: num(g.tint?.brightness, 1, 0.3, 1.6) },
    dirt: num(g.dirt, 0, 0, 1),
    hideBody: g.hideBody !== false,
  };
  if (typeof g.texture === 'string' && g.texture) out.texture = g.texture;
  if (g.fur !== undefined && g.fur !== null) out.fur = sanitiseFur(g.fur);
  if (g.look !== undefined && g.look !== null) out.look = sanitiseLook(g.look);
  return out;
}

/** The current character's garments as an outfit file. Painted textures belong to the character and are left out. */
export function outfitFromCharacter(doc: Readonly<CharacterDoc>, label: string): OutfitFile {
  const garments = doc.garments.map((g) => {
    const copy = structuredClone(g) as GarmentSlot;
    delete copy.paint;
    return copy;
  });
  return { format: 'ps2cc.outfit/1', outfit: { label: label.slice(0, 64), garments } };
}

/** Read a `.ps2outfit`. Garments `known` does not have (an asset since deleted) are dropped. */
export function parseOutfitFile(raw: unknown, known: (asset: string) => boolean = () => true): Outfit {
  const file = raw as Partial<OutfitFile> | null;
  if (!file || file.format !== 'ps2cc.outfit/1' || typeof file.outfit !== 'object' || file.outfit === null) throw new Error('not a PS2CC outfit');
  const o = file.outfit;
  if (typeof o.label !== 'string' || !o.label.trim()) throw new Error('the outfit has no name');
  const garments = (Array.isArray(o.garments) ? o.garments : [])
    .map(sanitiseGarmentSlot)
    .filter((g): g is GarmentSlot => g !== null && known(g.asset))
    .slice(0, MAX_OUTFIT_GARMENTS);
  const label = o.label.trim().slice(0, 64);
  return { id: `user:${label}`, label, garments };
}

/**
 * Put an outfit on: it replaces what the character wears. A garment with no
 * look of its own gets its library defaults (look, fur, tint), as it does when
 * put on from the Wardrobe.
 */
export function applyOutfit(doc: Readonly<CharacterDoc>, outfit: Outfit, defaults: (asset: string) => GarmentDefaults | undefined = () => undefined): CharacterDoc {
  const out = cloneCharacter(doc as CharacterDoc);
  out.garments = outfit.garments.map((g) => {
    const copy = structuredClone(g) as GarmentSlot;
    const def = defaults(g.asset);
    if (copy.look === undefined && def?.look) copy.look = sanitiseLook(def.look);
    if (copy.fur === undefined && def?.fur) copy.fur = sanitiseFur(def.fur);
    return copy;
  });
  return out;
}

const tint = (r: number, g: number, b: number) => ({ color: [r, g, b] as [number, number, number], brightness: 1 });

/** A library garment dressed in one library material: [material, tint, wear]. */
function dressed(asset: string, slot: GarmentSlotName, material: string, colour: [number, number, number], wear: number): GarmentSlot {
  const look = newLook(`ps2cc:materials/${material}`);
  look.zones[0]!.tint = colour;
  look.zones[0]!.wear = wear;
  return { slot, asset, tint: { ...NEUTRAL_TINT, color: [1, 1, 1] }, dirt: 0, hideBody: true, look };
}

const worn = (asset: string, slot: GarmentSlotName, extra: Partial<GarmentSlot> = {}): GarmentSlot => ({
  slot,
  asset,
  tint: { ...NEUTRAL_TINT, color: [1, 1, 1] },
  dirt: 0,
  hideBody: true,
  ...extra,
});

/**
 * The benchmark outfits (PRD Part 2 section 4), made in Garment Studio
 * (`pnpm build:outfits`). Garments made there bring their own look and fur
 * (applyOutfit); boots and gloves are dressed in library leather here.
 */
export const BUILTIN_OUTFITS: readonly Outfit[] = [
  {
    id: 'utility-vest',
    label: 'Utility vest and roll-neck',
    garments: [
      worn('ps2cc:clothes/rollneck_sweater', 'top', { tint: tint(0.62, 0.7, 0.62), dirt: 0.25 }),
      worn('ps2cc:clothes/mara_utility_vest', 'outer', { dirt: 0.45 }),
      worn('ps2cc:clothes/cargo_trousers', 'bottom', { tint: tint(0.9, 0.86, 0.76), dirt: 0.4 }),
      dressed('mh:clothes/toigo_ankle_boots_female', 'shoes', 'leather_worn', [0.7, 0.6, 0.5], 0.5),
      worn('ps2cc:clothes/wristbands', 'gloves'),
    ],
  },
  {
    id: 'leather-jacket',
    label: 'Cropped leather jacket',
    garments: [
      worn('ps2cc:clothes/rollneck_sweater', 'top', { tint: tint(0.4, 0.4, 0.42) }),
      worn('ps2cc:clothes/cole_leather_jacket', 'outer', { dirt: 0.2 }),
      worn('ps2cc:clothes/cargo_trousers', 'bottom', { tint: tint(0.66, 0.68, 0.6), dirt: 0.3 }),
      dressed('mh:clothes/toigo_ankle_boots_male', 'shoes', 'leather_black', [0.9, 0.85, 0.8], 0.4),
      dressed('mh:clothes/learning_mma_fighting_gloves', 'gloves', 'leather_black', [1, 1, 1], 0.3),
    ],
  },
];
