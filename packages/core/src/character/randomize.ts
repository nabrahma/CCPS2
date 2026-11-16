/**
 * Randomize (PRD F1): all sliders or one group, within the curated safe
 * ranges, respecting per-slider locks. Deterministic for a given seed.
 */
import { normaliseEthnic, type MacroValues } from '../morph/macros';
import { MACROVAR_TO_KEY } from '../morph/modifiers';
import { Rng } from '../random';
import type { BodySource } from '../anthro/evaluator';
import type { Anthropometer } from '../anthro/measure';
import { truncatedNormal } from '../math/distributions';
import { samplePerson, type PopulationCalibration, type SampledPerson } from '../population/sampler';
import { cloneCharacter, type CharacterDoc } from './doc';
import type { SliderCatalog, SliderDef } from './sliders';

export interface RandomizeOptions {
  seed: number;
  /** Restrict to sliders in this tab/group; undefined = everything curated. */
  tab?: 'body' | 'face';
  group?: string;
  locked?: ReadonlySet<string>;
  /** 0..1: how far from the default values may go within the safe range. */
  amount?: number;
  /** Include non-curated sliders (small amounts only). */
  includeAll?: boolean;
}

export function randomizeCharacter(doc: CharacterDoc, catalog: SliderCatalog, opts: RandomizeOptions): CharacterDoc {
  const rng = new Rng(opts.seed);
  const amount = Math.min(1, Math.max(0, opts.amount ?? 0.8));
  const out = cloneCharacter(doc);
  const pool = (opts.includeAll ? catalog.all : catalog.curated).filter(
    (s) =>
      (!opts.tab || s.tab === opts.tab) &&
      (!opts.group || s.group === opts.group) &&
      !opts.locked?.has(s.id),
  );
  let ethnicTouched = false;
  for (const s of pool) {
    const v = sample(s, rng, amount, opts.includeAll && !s.curated ? 0.35 : 1);
    if (s.macro) {
      const key = MACROVAR_TO_KEY[s.id.split('/')[1]!] as keyof MacroValues;
      out.macros[key] = v;
      if (key === 'african' || key === 'asian' || key === 'caucasian') ethnicTouched = true;
    } else {
      setModifierValue(out, s, v);
      if (s.symmetricOpposite) {
        const opp = catalog.byId.get(s.symmetricOpposite);
        if (opp && !opts.locked?.has(opp.id)) setModifierValue(out, opp, v);
      }
    }
  }
  if (ethnicTouched) normaliseEthnic(out.macros);
  return out;
}

function sample(s: SliderDef, rng: Rng, amount: number, extraScale: number): number {
  const lo = s.defaultValue + (s.safeMin - s.defaultValue) * amount * extraScale;
  const hi = s.defaultValue + (s.safeMax - s.defaultValue) * amount * extraScale;
  return Math.min(s.max, Math.max(s.min, rng.range(lo, hi)));
}

function setModifierValue(doc: CharacterDoc, s: SliderDef, v: number): void {
  if (Math.abs(v - s.defaultValue) < 1e-6) delete doc.modifiers[s.id];
  else doc.modifiers[s.id] = v;
}

export interface RealisticOptions {
  seed: number;
  /** 'body', 'face', or both when left out. */
  tab?: 'body' | 'face';
  /** Slider ids that keep their value. */
  locked?: ReadonlySet<string>;
  /** 0..1: how much the detail sliders (everything but the main body values) vary. Default 0.5. */
  variation?: number;
  /** 0..1: how much left and right differ. Default 0.35; real faces are never mirror images. */
  asymmetry?: number;
}

export interface RealisticResult {
  doc: CharacterDoc;
  /** The person drawn from the population (null when only the face was randomised). */
  person: SampledPerson | null;
}

/**
 * "Realistic random" (PRD Part 3, F23): the body's main values come from the
 * population sampler, so heights, builds and ages are spread as they are in
 * people; the detail sliders vary a little around their defaults (a bell
 * curve, not the flat spread of Randomize), and the face gets a small
 * left/right asymmetry. Sliders of the chosen tab that are not locked are
 * replaced, so a seed and a set of locks always give the same character.
 */
export function randomizeRealistic(
  doc: CharacterDoc,
  catalog: SliderCatalog,
  source: BodySource,
  anthro: Anthropometer,
  calibration: PopulationCalibration,
  opts: RealisticOptions,
): RealisticResult {
  const rng = new Rng(opts.seed);
  const variation = Math.min(1, Math.max(0, opts.variation ?? 0.5));
  const asymmetry = Math.min(1, Math.max(0, opts.asymmetry ?? 0.35));
  const locked = opts.locked ?? new Set<string>();
  const out = cloneCharacter(doc);
  const inTab = (s: SliderDef) => !opts.tab || s.tab === opts.tab;
  const done = new Set<string>();
  for (const s of catalog.all) {
    if (s.macro || !inTab(s) || done.has(s.id)) continue;
    const isAsym = s.id.startsWith('asym/');
    // One draw per slider, locked or not, so a lock never changes the others.
    const z = truncatedNormal(rng, 2) / 2;
    if (locked.has(s.id)) continue;
    let v = s.defaultValue;
    if (isAsym) v = z * 0.5 * asymmetry;
    else if (s.curated) v = s.defaultValue + (z >= 0 ? s.safeMax - s.defaultValue : s.defaultValue - s.safeMin) * z * variation;
    v = Math.min(s.max, Math.max(s.min, v));
    setModifierValue(out, s, v);
    done.add(s.id);
    if (s.symmetricOpposite && !isAsym) {
      const opp = catalog.byId.get(s.symmetricOpposite);
      if (opp && !locked.has(opp.id)) {
        setModifierValue(out, opp, v);
        done.add(opp.id);
      }
    }
  }
  let person: SampledPerson | null = null;
  if (opts.tab !== 'face') {
    const lockedMacros = new Set<keyof MacroValues>();
    for (const s of catalog.all) {
      if (s.macro && locked.has(s.id)) lockedMacros.add(MACROVAR_TO_KEY[s.id.split('/')[1]!] as keyof MacroValues);
    }
    person = samplePerson(source, anthro, calibration, rng, out.macros, { locked: lockedMacros, modifiers: out.modifiers });
    out.macros = person.macros;
  }
  return { doc: out, person };
}
