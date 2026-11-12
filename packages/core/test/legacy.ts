/**
 * A new character with the settings PS2CC used before quality profiles
 * (LEGACY_EXPORT, 8k body): the tests written against those defaults keep
 * testing exactly what they did.
 */
import { defaultCharacter, type CharacterDoc } from '../src/character/doc';
import { LEGACY_EXPORT } from '../src/quality/profiles';

export function legacyCharacter(name?: string): CharacterDoc {
  const doc = defaultCharacter(name);
  doc.export = { ...doc.export, ...LEGACY_EXPORT };
  doc.bodyMesh = 'ps2_body_8k';
  return doc;
}
