/**
 * Randomize (PRD F1): all sliders or one group, within the curated safe
 * ranges, respecting per-slider locks. Deterministic for a given seed.
 */
import { normaliseEthnic, type MacroValues } from '../morph/macros';
import { MACROVAR_TO_KEY } from '../morph/modifiers';
import { Rng } from '../random';
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
