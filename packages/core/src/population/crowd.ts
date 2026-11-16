/**
 * Crowd generator (PRD Part 3, F23): N characters from one seed, for NPCs.
 * Each character has its own seed, derived by hashing, so character 7 of a
 * crowd is the same whether 10 or 100 are made. Hair and outfits are picked
 * from the pools the caller gives.
 */
import type { Anthropometer } from '../anthro/measure';
import type { BodySource } from '../anthro/evaluator';
import { cloneCharacter, defaultCharacter, type CharacterDoc, type HairSpec } from '../character/doc';
import { applyOutfit, type Outfit } from '../character/outfit';
import { randomizeRealistic } from '../character/randomize';
import type { SliderCatalog } from '../character/sliders';
import type { GarmentDefaults } from '../proxy/proxy';
import { hashSeed, Rng } from '../random';
import type { PopulationCalibration, SampledPerson } from './sampler';

export interface CrowdOptions {
  seed: number;
  count: number;
  /** Names are "<prefix> 001" and so on. */
  namePrefix?: string;
  /** The character every member starts from (skin layers, export settings, hair if no pool is given). */
  template?: CharacterDoc;
  /** Hairstyles to pick from; empty or missing keeps the template's hair. */
  hair?: readonly HairSpec[];
  /** Outfits to pick from; empty or missing keeps the template's clothes. */
  outfits?: readonly Outfit[];
  /** Skins the library has (ids); a matching MakeHuman skin is chosen by age, ethnic blend and sex. */
  skins?: readonly string[];
  garmentDefaults?: (asset: string) => GarmentDefaults | undefined;
  variation?: number;
  asymmetry?: number;
}

export interface CrowdMember {
  index: number;
  seed: number;
  doc: CharacterDoc;
  person: SampledPerson;
}

export const MAX_CROWD = 500;

/** The seed of member `index` of the crowd with seed `seed`. */
export function crowdMemberSeed(seed: number, index: number): number {
  return hashSeed(`ps2cc-crowd:${seed >>> 0}:${index}`);
}

/** MakeHuman's stock skin for an age, ethnic blend and sex, if the library has it. */
export function stockSkinFor(person: SampledPerson, skins: readonly string[]): string | null {
  const m = person.macros;
  const ethnic = m.african >= m.asian && m.african >= m.caucasian ? 'african' : m.asian >= m.caucasian ? 'asian' : 'caucasian';
  const age = person.years < 40 ? 'young' : person.years < 60 ? 'middleage' : 'old';
  const id = `mh:skins/${age}_${ethnic}_${person.sex}`;
  return skins.includes(id) ? id : null;
}

export function generateCrowd(
  catalog: SliderCatalog,
  source: BodySource,
  anthro: Anthropometer,
  calibration: PopulationCalibration,
  opts: CrowdOptions,
): CrowdMember[] {
  const count = Math.min(MAX_CROWD, Math.max(0, Math.floor(opts.count)));
  const prefix = opts.namePrefix?.trim() || 'Person';
  const out: CrowdMember[] = [];
  for (let index = 0; index < count; index++) {
    const seed = crowdMemberSeed(opts.seed, index);
    const base = opts.template ? cloneCharacter(opts.template) : defaultCharacter();
    base.name = `${prefix} ${String(index + 1).padStart(3, '0')}`;
    // A stable id, so the same seed gives the same files.
    base.id = `crowd-${(opts.seed >>> 0).toString(16)}-${String(index + 1).padStart(3, '0')}`;
    base.skin.layers.forEach((layer, k) => (layer.id = `${layer.kind}-${k + 1}`));
    const r = randomizeRealistic(base, catalog, source, anthro, calibration, { seed, variation: opts.variation, asymmetry: opts.asymmetry });
    let doc = r.doc;
    const person = r.person!;
    // Looks are picked from a second stream, so changing a pool never changes the bodies.
    const rng = new Rng(hashSeed(`ps2cc-crowd-look:${seed}`));
    const hairPick = rng.next();
    const outfitPick = rng.next();
    if (opts.hair && opts.hair.length > 0) doc.hair = structuredClone(opts.hair[Math.floor(hairPick * opts.hair.length)]!) as HairSpec;
    if (opts.outfits && opts.outfits.length > 0) doc = applyOutfit(doc, opts.outfits[Math.floor(outfitPick * opts.outfits.length)]!, opts.garmentDefaults);
    const skin = opts.skins ? stockSkinFor(person, opts.skins) : null;
    if (skin) doc.skin = { ...doc.skin, base: skin };
    out.push({ index, seed, doc, person });
  }
  return out;
}
