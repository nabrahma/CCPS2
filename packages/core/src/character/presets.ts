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
  // Ethnic blend stays as it was.
  out.macros.african = doc.macros.african;
  out.macros.asian = doc.macros.asian;
  out.macros.caucasian = doc.macros.caucasian;
  out.modifiers = { ...(preset.modifiers ?? {}) };
  if (preset.skin) out.skin = { ...out.skin, base: preset.skin };
  return out;
}
