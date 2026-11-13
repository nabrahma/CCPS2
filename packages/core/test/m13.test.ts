/**
 * PRD M13 (Texture Studio through Material Painter, D-115), the parts that run
 * without Material Painter:
 *  - what comes back is exactly what was painted: the painted layer holds the
 *    texels that differ from the reference, and composited over the reference
 *    by the reference compositor it gives Material Painter's texture back;
 *  - paint survives morphing: 20 random slider changes leave the mesh's UVs
 *    and the painted layer's input to the compositor unchanged;
 *  - the meshes sent are valid OBJ with one UV per corner;
 *  - bringing paint back is one document edit (one undo step).
 * The round trip with the real Material Painter is in the Go tests (TestLive)
 * and e2e/tools/material-painter.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { defaultCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { applyPaint, meshObj, opaque, paintedLayer, paintedSkinLayer, paintSize, PAINTED_LAYER_PREFIX, skinObj, withAlphaOf } from '../src/paint/material-painter';
import { compositeReference } from '../src/skin/blend';
import { createImage, type RgbaImage } from '../src/skin/image';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets } from './helpers';

function noise(size: number, seed: number): RgbaImage {
  const img = createImage(size, size);
  const rng = new Rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.floor(rng.next() * 256);
    img.data[i + 1] = Math.floor(rng.next() * 256);
    img.data[i + 2] = Math.floor(rng.next() * 256);
    img.data[i + 3] = 255;
  }
  return img;
}

describe('paint coming back from Material Painter', () => {
  it('keeps exactly the painted texels, and composites back to the painted texture', () => {
    const reference = noise(64, 1);
    const painted = { ...reference, data: new Uint8ClampedArray(reference.data) };
    // A stroke: a soft disc (partly transparent paint already mixed in, as Material Painter exports it).
    let strokes = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - 20, y - 30);
        if (d > 12) continue;
        const a = 1 - d / 12;
        const i = (y * 64 + x) * 4;
        const before = [painted.data[i]!, painted.data[i + 1]!, painted.data[i + 2]!];
        painted.data[i] = Math.round(painted.data[i]! * (1 - a) + 200 * a);
        painted.data[i + 1] = Math.round(painted.data[i + 1]! * (1 - a) + 30 * a);
        painted.data[i + 2] = Math.round(painted.data[i + 2]! * (1 - a) + 40 * a);
        if (before[0] !== painted.data[i] || before[1] !== painted.data[i + 1] || before[2] !== painted.data[i + 2]) strokes++;
      }
    }
    const { image, texels } = paintedLayer(reference, painted);
    expect(texels).toBe(strokes);
    expect(texels).toBeGreaterThan(300);
    // Untouched texels are transparent; painted ones are opaque and exact.
    expect(image.data[(5 * 64 + 60) * 4 + 3]).toBe(0);
    expect(image.data[(30 * 64 + 20) * 4 + 3]).toBe(255);
    // The reference compositor: the layer over the reference gives Material Painter's texture texel for texel.
    const out = compositeReference(reference, [{ source: { kind: 'pixels', image }, blend: 'normal', opacity: 1, mask: 'none' }], null, 64);
    let worst = 0;
    for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out.data[i + c]! - painted.data[i + c]!));
    expect(worst).toBe(0);
    // Nothing painted: an empty layer.
    expect(paintedLayer(reference, reference).texels).toBe(0);
  });

  it("garments keep their own alpha; references go out opaque at a size Material Painter takes", () => {
    const own = noise(8, 2);
    for (let i = 3; i < own.data.length; i += 8) own.data[i] = 0;
    const painted = opaque(noise(8, 3));
    const back = withAlphaOf(painted, own);
    for (let i = 3; i < own.data.length; i += 4) expect(back.data[i]).toBe(own.data[i]);
    expect(opaque(own).data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
    expect([paintSize(2048, 2048), paintSize(1000, 600), paintSize(300, 300), paintSize(8192, 8192)]).toEqual([2048, 1024, 512, 4096]);
  });

  it('meshes go out as OBJ with a UV per corner', () => {
    const obj = meshObj('top', [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1], [0, 1, 2]);
    const lines = obj.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('v ')).length).toBe(3);
    expect(lines.filter((l) => l.startsWith('vt ')).length).toBe(3);
    expect(lines).toContain('f 1/1 2/2 3/3');
    expect(lines).toContain('usemtl top');
  });

  it('bringing paint back is one edit: a painted layer on top the first time, the same layer after', () => {
    const doc = defaultCharacter('Paint');
    const before = doc.skin.layers.length;
    applyPaint(doc, 'skin', '/library/overlays/a.png');
    expect(doc.skin.layers).toHaveLength(before + 1);
    const layer = paintedSkinLayer(doc)!;
    expect(layer.id.startsWith(PAINTED_LAYER_PREFIX)).toBe(true);
    expect(doc.skin.layers[doc.skin.layers.length - 1]).toBe(layer);
    applyPaint(doc, 'skin', '/library/overlays/b.png');
    expect(doc.skin.layers).toHaveLength(before + 1);
    expect(paintedSkinLayer(doc)!.image).toBe('/library/overlays/b.png');
    expect(() => applyPaint(doc, 'garment:top', '/x.png')).toThrow();
  });
});

const suite = assetsAvailable ? describe : describe.skip;

suite('paint survives morphing (needs assets)', () => {
  it('20 random slider changes leave the UVs and the painted layer as they were; one undo step per import', async () => {
    const assets = await loadAssets();
    const doc = defaultCharacter('Paint');
    applyPaint(doc, 'skin', '/library/overlays/paint.png');
    const engine = new CharacterEngine(assets, doc);
    const texture = (ref: string) => ref;
    const resolve = () => assets.skinComposer.resolve(engine.doc.skin, texture, null).layers.find((l) => l.layerId === paintedSkinLayer(engine.doc)!.id);
    const uvsOf = (obj: string) => obj.split('\n').filter((l) => l.startsWith('vt ') || l.startsWith('f ')).join('\n');
    const layerBefore = JSON.stringify(resolve());
    const objBefore = skinObj(assets.base, engine.positions);
    const rng = new Rng(13);
    const sliders = assets.modifiers.list.filter((m) => !m.fullName.includes('macro'));
    for (let i = 0; i < 20; i++) {
      const m = sliders[Math.floor(rng.next() * sliders.length)]!;
      engine.setValue(m.fullName, m.min + (m.max - m.min) * rng.next());
    }
    const objAfter = skinObj(assets.base, engine.positions);
    expect(objAfter).not.toBe(objBefore);
    expect(uvsOf(objAfter)).toBe(uvsOf(objBefore));
    expect(JSON.stringify(resolve())).toBe(layerBefore);

    // Bringing paint back again is one undo step.
    const saved = JSON.stringify(engine.doc);
    engine.update('Paint the skin in Material Painter', (d) => applyPaint(d, 'skin', '/library/overlays/paint2.png'));
    engine.undo();
    expect(JSON.stringify(engine.doc)).toBe(saved);
  });
});
