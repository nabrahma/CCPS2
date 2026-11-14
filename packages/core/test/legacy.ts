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
  // Before D-146 brows and lashes were MakeHuman's meshes, not painted on the skin.
  doc.eyebrows = { ...doc.eyebrows, asset: 'mh:eyebrows/eyebrow001' };
  doc.eyelashes = { ...doc.eyelashes, asset: 'mh:eyelashes/eyelashes01' };
  doc.skin = { ...doc.skin, layers: doc.skin.layers.filter((l) => l.kind !== 'brows' && l.kind !== 'lashes') };
  return doc;
}

/** A new character (current defaults) wearing MakeHuman's brow and lash meshes, to test the mesh path. */
export function withMeshBrows(doc: CharacterDoc): CharacterDoc {
  doc.eyebrows = { ...doc.eyebrows, asset: 'mh:eyebrows/eyebrow001' };
  doc.eyelashes = { ...doc.eyelashes, asset: 'mh:eyelashes/eyelashes01' };
  return doc;
}
