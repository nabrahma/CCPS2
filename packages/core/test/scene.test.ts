import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, NEUTRAL_TINT, type GarmentSlot } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { starterStyle } from '../src/hair';
import { CharacterScene } from '../src/scene/character-scene';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

suite('CharacterScene', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('assembles body, eyes, brows and lashes with feet on the ground', async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    await scene.sync();
    const kinds = scene.parts.map((p) => p.kind);
    expect(kinds).toContain('body');
    expect(kinds).toContain('eyes');
    expect(kinds).toContain('eyebrows');
    expect(kinds).toContain('eyelashes');
    for (const p of scene.parts) {
      expect(p.positions.every(Number.isFinite), p.key).toBe(true);
      expect(p.normals.every(Number.isFinite), p.key).toBe(true);
      expect(p.indices.length % 3).toBe(0);
    }
    expect(scene.groundOffset).toBeGreaterThan(0);
  });

  it('garments with hideBody remove body triangles and count toward the budget', async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    await scene.sync();
    const before = scene.budget();
    const suit = assets.catalog.proxies.find((p) => p.id === 'mh:clothes/male_casualsuit01')!;
    engine.update('Wear suit', (d) => {
      d.garments.push({ slot: 'full', asset: suit.id, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody: true });
    });
    await scene.sync();
    const after = scene.budget();
    expect(after.garments).toBe(suit.triangles);
    expect(after.body + after.head).toBeLessThan(before.body + before.head);
    expect(after.total).toBe(after.body + after.head + after.hair + after.garments + after.eyesAndBrows);
  });

  it('refits proxies when the body changes', async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    await scene.sync();
    const brows = scene.parts.find((p) => p.kind === 'eyebrows')!;
    const y0 = brows.positions[1]!;
    engine.setValue('macrodetails-height/Height', 1);
    scene.update();
    expect(brows.positions[1]).not.toBeCloseTo(y0, 4);
  });

  it('budget states follow PRD F11', async () => {
    const engine = new CharacterEngine(assets, { ...defaultCharacter(), export: { ...defaultCharacter().export, triangleBudget: 1000 } });
    const scene = new CharacterScene(engine);
    await scene.sync();
    const b = scene.budget();
    expect(b.state).toBe('over');
    expect(b.exportBlocked).toBe(b.total > b.hardMax);
  });

  it('computed hidden faces: opaque garments hide skin, fishnets do not, and the toggle works', async () => {
    const triangles = async (asset: string | null, hideBody = true) => {
      const engine = new CharacterEngine(assets);
      const scene = new CharacterScene(engine);
      if (asset) {
        engine.update('Wear', (d) => {
          const slot = assets.proxyInfo(asset).slot as GarmentSlot['slot'];
          d.garments.push({ slot, asset, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody });
        });
      }
      await scene.sync();
      return scene.parts.find((p) => p.kind === 'body')!.triangleCount;
    };
    const bare = await triangles(null);
    const polo = 'mh:clothes/namuhekam_male_polo_shirt';
    const fishnet = 'mh:clothes/v0rt3x_armsleeves_black_fishnet_small';
    expect(assets.proxyInfo(polo).hiddenFaces).toBe('computed');
    expect(assets.proxyInfo(fishnet).hiddenFaces).toBe('none');
    // Computed coverage needs every corner covered, so it hides less on the coarse default 8k tier
    // (about 3%) than on 12k (about 9%); the garment collider keeps the cloth outside the rest.
    expect(await triangles(polo)).toBeLessThan(bare - 100);
    expect(await triangles(polo, false)).toBe(bare);
    expect(await triangles(fishnet)).toBe(bare);
  });

  it('card hair: generated, counted in the budget, skinned to head and neck, follows drags and regenerates when settled', async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    engine.update('Card hair', (d) => {
      d.hair = { ...d.hair, mode: 'cards', style: starterStyle('bob'), atlas: null };
    });
    await scene.sync();
    const part = scene.parts.find((p) => p.key === 'hair')!;
    expect(part.kind).toBe('hair');
    expect(part.material.texture).toBe(assets.catalog.hairAtlases![0]!.atlas.texture);
    expect(part.layer).toHaveLength(part.positions.length / 3);
    expect(scene.budget().hair).toBe(part.triangleCount);
    const inf = scene.influences('hair')!;
    const allowed = new Set([assets.rig.index.get('head'), assets.rig.index.get('neck_01')]);
    for (let i = 0; i < inf.joints.length; i++) if (inf.weights[i]! > 0) expect(allowed.has(inf.joints[i]!)).toBe(true);
    // Drag: the binding moves the cards; release: regenerated in place on the new body.
    const y0 = part.positions[1]!;
    engine.setValue('macrodetails-height/Height', 0.8, { mergeKey: 'drag' });
    scene.update();
    const dragged = part.positions[1]!;
    expect(dragged).not.toBeCloseTo(y0, 3);
    engine.endInteraction();
    scene.update();
    expect(part.positions[1]).toBeCloseTo(dragged, 1);
    expect(part.positions.every(Number.isFinite)).toBe(true);
    // Back to bald removes the part.
    engine.update('Bald', (d) => void (d.hair = { ...d.hair, mode: 'none' }));
    await scene.sync();
    expect(scene.parts.some((p) => p.key === 'hair')).toBe(false);
  });
});
