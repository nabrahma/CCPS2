/**
 * D-151: Garment Studio edits kept in the character. An edited garment, bound
 * to the reference body by the import pipeline, is stored in the document,
 * registered by the engine, worn and fitted like a library garment, shared
 * (not copied) by undo snapshots, dropped when no garment wears it, and saved
 * and loaded with the character.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { cloneCharacter, defaultCharacter, NEUTRAL_TINT, parseCharacter, serializeCharacter, type CharacterDoc } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { outfitFromCharacter } from '../src/character/outfit';
import { importGarment, referenceBody } from '../src/proxy/garment-import';
import { garmentEditFrom, proxyFromEdit } from '../src/proxy/garment-edit';
import { CharacterScene } from '../src/scene/character-scene';
import { bodySurface, editMeshFromProxy, editMeshToRaw, inflateAll } from '../src/wardrobe/studio';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;
const BASE = 'mh:clothes/male_worksuit01';

suite('Garment Studio edits kept in the character (D-151)', () => {
  let assets: CoreAssets;
  let edited: CharacterDoc;
  const id = 'edit:test';
  beforeAll(async () => {
    assets = await loadAssets();
    const body = referenceBody(assets);
    const mesh = editMeshFromProxy(await assets.proxy(BASE), body);
    inflateAll(mesh, 0.004, bodySurface(body));
    const garment = await importGarment(editMeshToRaw(mesh), { name: 'Worksuit', slot: 'full', body });
    const doc = defaultCharacter('Edited');
    doc.garments = [{ slot: 'full', asset: id, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody: true }];
    doc.garmentEdits = { [id]: garmentEditFrom(id, BASE, garment, 'Worksuit') };
    edited = doc;
  }, 120_000);

  it('the stored edit decodes to the garment that was bound', () => {
    const proxy = proxyFromEdit(edited.garmentEdits![id]!);
    expect(proxy.id).toBe(id);
    expect(proxy.vertexCount).toBeGreaterThan(100);
    expect(proxy.refVerts.length).toBe(proxy.vertexCount * 3);
  });

  it('is registered, worn and fitted like a library garment, with the base garment name and licence', async () => {
    const engine = new CharacterEngine(assets);
    engine.load(edited);
    expect(assets.hasProxy(id)).toBe(true);
    const info = assets.proxyInfo(id);
    expect(info.base).toBe(BASE);
    expect(info.licence).toBe(assets.proxyInfo(BASE).licence);
    const scene = new CharacterScene(engine);
    await scene.sync();
    scene.update();
    const part = scene.parts.find((p) => p.kind === 'garment')!;
    expect(part.assetId).toBe(id);
    expect(part.triangleCount).toBeGreaterThan(100);
    expect(part.positions.every(Number.isFinite)).toBe(true);
  });

  it('undo snapshots share the edit instead of copying it', () => {
    const copy = cloneCharacter(edited);
    expect(copy.garmentEdits![id]).toBe(edited.garmentEdits![id]);
    expect(copy.garmentEdits).not.toBe(edited.garmentEdits);
  });

  it('is dropped when no garment wears it, and comes back with undo', () => {
    const engine = new CharacterEngine(assets);
    engine.load(edited);
    engine.update('Take it off', (d) => void (d.garments = []));
    expect(engine.doc.garmentEdits).toBeUndefined();
    engine.undo();
    expect(Object.keys(engine.doc.garmentEdits ?? {})).toEqual([id]);
  });

  it('is saved and loaded with the character', () => {
    const back = parseCharacter(JSON.parse(serializeCharacter(edited)));
    expect(back.garments[0]!.asset).toBe(id);
    expect(back.garmentEdits![id]!.bin).toBe(edited.garmentEdits![id]!.bin);
    // A file whose edit no garment wears does not keep it.
    const orphan = parseCharacter(JSON.parse(serializeCharacter({ ...edited, garments: [] })));
    expect(orphan.garmentEdits).toBeUndefined();
  });

  it('an outfit saved from the character wears the library garment the edit came from', () => {
    expect(outfitFromCharacter(edited, 'Work').outfit.garments[0]!.asset).toBe(BASE);
  });
});
