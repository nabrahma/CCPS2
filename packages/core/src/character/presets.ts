/**
 * Built-in presets (PRD F1). All presets are adults. A preset sets macros and a
 * few modifiers on top of a default character.
 */
import { ageFromYears, DEFAULT_MACROS, type MacroValues } from '../morph/macros';
import { cloneCharacter, type CharacterDoc } from './doc';

export interface Preset {
  id: string;
  label: string;
  macros: Partial<MacroValues>;
  modifiers?: Record<string, number>;
  skin?: string;
  /** User presets store the ethnic blend too; the built-in ones leave it alone. */
  includesEthnic?: boolean;
}

export const BUILTIN_PRESETS: readonly Preset[] = [
  {
    id: 'adult-male',
    label: 'Adult male',
    macros: { gender: 1, age: ageFromYears(32), muscle: 0.55, weight: 0.5, height: 0.55 },
    skin: 'mh:skins/young_caucasian_male',
  },
  {
    id: 'adult-female',
    label: 'Adult female',
    macros: { gender: 0, age: ageFromYears(30), muscle: 0.45, weight: 0.48, height: 0.45, breastSize: 0.5 },
    skin: 'mh:skins/young_caucasian_female',
  },
  {
    id: 'older-male',
    label: 'Older male',
    macros: { gender: 1, age: ageFromYears(64), muscle: 0.4, weight: 0.6, height: 0.48 },
    modifiers: { 'head/head-age-decr|incr': 0.5, 'stomach/stomach-pregnant-decr|incr': 0.2 },
    skin: 'mh:skins/old_caucasian_male',
  },
  {
    id: 'older-female',
    label: 'Older female',
    macros: { gender: 0, age: ageFromYears(62), muscle: 0.35, weight: 0.58, height: 0.42 },
    modifiers: { 'head/head-age-decr|incr': 0.45 },
    skin: 'mh:skins/old_caucasian_female',
  },
  {
    id: 'young-adult',
    label: 'Teen-looking adult',
    // 19 years: the youngest preset; the engine never goes below 18.
    macros: { gender: 0.5, age: ageFromYears(19), muscle: 0.45, weight: 0.42, height: 0.48 },
    modifiers: { 'head/head-age-decr|incr': -0.3 },
    skin: 'mh:skins/young_caucasian_male',
  },
];

export function applyPreset(doc: CharacterDoc, preset: Preset): CharacterDoc {
  const out = cloneCharacter(doc);
  out.macros = { ...DEFAULT_MACROS, ...out.macros, ...preset.macros };
  if (!preset.includesEthnic) {
    out.macros.african = doc.macros.african;
    out.macros.asian = doc.macros.asian;
    out.macros.caucasian = doc.macros.caucasian;
  }
  out.modifiers = { ...(preset.modifiers ?? {}) };
  if (preset.skin) out.skin = { ...out.skin, base: preset.skin };
  return out;
}

/** `.ps2preset` file contents (PRD F1 user presets). */
export interface PresetFile {
  format: 'ps2cc.preset/1';
  preset: Preset;
}

/** A user preset from the current character: its body and face sliders and base skin. */
export function presetFromCharacter(doc: Readonly<CharacterDoc>, label: string): PresetFile {
  return {
    format: 'ps2cc.preset/1',
    preset: { id: `user:${label}`, label, macros: { ...doc.macros }, modifiers: { ...doc.modifiers }, skin: doc.skin.base, includesEthnic: true },
  };
}

/**
 * Read a `.ps2preset`. Anything not a finite number is dropped, and so are
 * sliders `known` does not recognise (a preset can outlive an asset update).
 */
export function parsePresetFile(raw: unknown, known: (modifier: string) => boolean = () => true): Preset {
  const file = raw as Partial<PresetFile> | null;
  if (!file || file.format !== 'ps2cc.preset/1' || typeof file.preset !== 'object' || file.preset === null) throw new Error('not a PS2CC preset');
  const p = file.preset;
  if (typeof p.label !== 'string' || !p.label.trim()) throw new Error('the preset has no name');
  const macros: Partial<MacroValues> = {};
  for (const k of Object.keys(DEFAULT_MACROS) as (keyof MacroValues)[]) {
    const v = (p.macros as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) macros[k] = Math.min(1, Math.max(0, v));
  }
  const modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.modifiers ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v) && known(k)) modifiers[k] = v;
  }
  const label = p.label.slice(0, 64);
  const hasEthnic = macros.african !== undefined && macros.asian !== undefined && macros.caucasian !== undefined;
  return { id: `user:${label}`, label, macros, modifiers, ...(typeof p.skin === 'string' && p.skin ? { skin: p.skin } : {}), includesEthnic: hasEthnic };
}
