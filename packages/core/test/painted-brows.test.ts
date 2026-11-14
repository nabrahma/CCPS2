/**
 * Painted eyebrows and eyelashes (D-146): drawn on the skin at the
 * composite's size around the eyes, where MakeHuman's brow and lash meshes
 * sat; new characters have no brow or lash geometry.
 *  - the brow sits in the band the eyebrow001 mesh covered (about 1.0 to 1.9
 *    eye half-widths above the eye centre), on both sides, and nowhere below
 *    the eyes;
 *  - the lashes hug the eye rim: strongest within a millimetre or two of it,
 *    the upper lid darker than the lower, none far from the eye;
 *  - the layers are full composite size, so they go through every compositor
 *    as before.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter } from '../src/character/doc';
import { SKIN_COMPOSITE_SIZE } from '../src/skin/compose';
import { LAYER_PRESETS, newLayer, presetParams, sanitiseLayer } from '../src/skin/layers';
import {
  BROW_PAINT_LENGTH,
  browCentre,
  browCoverage,
  browShape,
  browStrokes,
  decodeBrowPaint,
  encodeBrowPaint,
  paintBrowDab,
} from '../src/skin/painted-hair';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

suite('painted brows and lashes', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('new characters have painted brows and lashes and no brow or lash mesh', () => {
    const doc = defaultCharacter();
    expect(doc.eyebrows.asset).toBeNull();
    expect(doc.eyelashes.asset).toBeNull();
    const kinds = doc.skin.layers.filter((l) => l.enabled).map((l) => l.kind);
    expect(kinds).toContain('brows');
    expect(kinds).toContain('lashes');
  });

  /** Covered texels of a layer with their positions relative to the nearer eye (x outwards, in eye half-widths). */
  const sample = (kind: 'brows' | 'lashes') => {
    const composer = assets.skinComposer;
    const img = composer.layerImage(newLayer(kind));
    expect(img.width).toBe(SKIN_COMPOSITE_SIZE);
    const map = composer.eyeSurface;
    const win = map.window!;
    const out: { s: number; h: number; d: number; a: number; side: number }[] = [];
    for (let y = 0; y < win.height; y++) {
      for (let x = 0; x < win.width; x++) {
        const t = y * win.width + x;
        if (!map.coverage[t]) continue;
        const a = img.data[((win.y0 + y) * img.width + win.x0 + x) * 4 + 3]! / 255;
        const px = map.position[t * 3]!;
        const py = map.position[t * 3 + 1]!;
        const e = px > 0 ? composer.features.eyes[0] : composer.features.eyes[1];
        const side = Math.sign(e.centre[0]);
        const W = e.halfWidth;
        out.push({ s: ((px - e.centre[0]) / W) * side, h: (py - e.centre[1]) / W, d: Math.hypot(px - e.centre[0], py - e.centre[1]), a, side });
      }
    }
    return out;
  };

  it('the brows sit where the eyebrow mesh did, on both sides', () => {
    const texels = sample('brows');
    const inked = texels.filter((t) => t.a > 0.25);
    expect(inked.length).toBeGreaterThan(200);
    for (const side of [1, -1]) {
      const own = inked.filter((t) => t.side === side);
      expect(own.length, `side ${side}`).toBeGreaterThan(100);
      const meanH = own.reduce((acc, t) => acc + t.h, 0) / own.length;
      expect(meanH, `side ${side}: mean height`).toBeGreaterThan(1.1);
      expect(meanH, `side ${side}: mean height`).toBeLessThan(1.8);
      expect(Math.min(...own.map((t) => t.s)), `side ${side}: inner end`).toBeLessThan(-1.5);
      expect(Math.max(...own.map((t) => t.s)), `side ${side}: tail`).toBeGreaterThan(1.6);
    }
    // Nothing on or below the eyes.
    expect(texels.filter((t) => t.h < 0.6 && t.a > 0.02)).toHaveLength(0);
  });

  it('the lashes hug the eye rim, darker on the upper lid', () => {
    const texels = sample('lashes');
    const hw = assets.skinComposer.features.eyes[0].halfWidth;
    const inked = texels.filter((t) => t.a > 0.2);
    expect(inked.length).toBeGreaterThan(50);
    // Within the eye's own reach: nothing past about one and a half half-widths from its centre.
    expect(texels.filter((t) => t.d > 1.7 * hw && t.a > 0.02)).toHaveLength(0);
    const upper = texels.filter((t) => t.h > 0.1);
    const lower = texels.filter((t) => t.h < -0.1);
    const max = (xs: typeof texels) => Math.max(0, ...xs.map((t) => t.a));
    expect(max(upper)).toBeGreaterThan(0.7);
    expect(max(lower)).toBeLessThan(max(upper));
    expect(max(lower)).toBeGreaterThan(0.05);
  });

  it('brow hairs grow the way real brows do', () => {
    const layer = newLayer('brows');
    const b = browShape(layer);
    const eye = assets.skinComposer.features.eyes[0];
    const W = eye.halfWidth;
    const hairs = browStrokes(layer, b, eye, 0, assets.skinComposer.features.eyeSpacing / 0.0648);
    expect(hairs.length).toBeGreaterThan(250);
    const angle = (h: (typeof hairs)[number]) => Math.atan2(h.y1 - h.y0, h.x1 - h.x0);
    const at = (h: (typeof hairs)[number]) => {
      const s = (h.x0 + (h.x1 - h.x0) * 0.6) / W;
      return { s, u: (h.y0 + (h.y1 - h.y0) * 0.6) / W - browCentre(b, s) };
    };
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    // The inner end: near upright.
    const head = hairs.filter((h) => at(h).s < b.headS + 0.4);
    expect(head.length).toBeGreaterThan(10);
    expect(mean(head.map(angle))).toBeGreaterThan(0.9);
    // The body: the lower rows lean up and out, the upper rows lie down and out.
    const body = hairs.filter((h) => at(h).s > -1 && at(h).s < b.peak);
    const lowerRows = body.filter((h) => at(h).u < -0.12);
    const upperRows = body.filter((h) => at(h).u > 0.12);
    expect(mean(lowerRows.map(angle))).toBeGreaterThan(mean(upperRows.map(angle)) + 0.3);
    expect(mean(lowerRows.map(angle))).toBeGreaterThan(0.2);
    // The tail: they lie along the brow, which runs down and out there.
    const tail = hairs.filter((h) => at(h).s > b.peak + 0.9);
    expect(Math.abs(mean(tail.map(angle)))).toBeLessThan(0.45);
    // The same seed gives the same hairs; another seed different ones.
    expect(browStrokes(layer, b, eye, 0, 1)).toEqual(browStrokes(layer, b, eye, 0, 1));
    const other = { ...layer, params: { ...layer.params, seed: 2 } };
    expect(browStrokes(other, browShape(other), eye, 0, 1)[0]).not.toEqual(browStrokes(layer, b, eye, 0, 1)[0]);
  });

  it('the brow brush adds and takes away brow, per side or both, and survives a save', () => {
    const layer = newLayer('brows');
    const plain = browShape(layer);
    const values = decodeBrowPaint(undefined);
    // Grow brow well above the shape on the left only; erase the middle of both.
    paintBrowDab(values, 0, 0, 2.6, 0.3, 1);
    paintBrowDab(values, 'both', -0.5, browCentre(plain, -0.5), 0.25, -1);
    paintBrowDab(values, 'both', -0.5, browCentre(plain, -0.5), 0.25, -1);
    const hex = encodeBrowPaint(values);
    expect(hex).toHaveLength(BROW_PAINT_LENGTH);
    const painted = { ...layer, paint: hex };
    const b = browShape(painted);
    expect(browCoverage(plain, 0, 0, 2.6)).toBe(0);
    expect(browCoverage(b, 0, 0, 2.6)).toBeGreaterThan(0.8);
    expect(browCoverage(b, 1, 0, 2.6)).toBe(0);
    expect(browCoverage(plain, 0, -0.5, browCentre(plain, -0.5))).toBeGreaterThan(0.6);
    expect(browCoverage(b, 0, -0.5, browCentre(plain, -0.5))).toBe(0);
    expect(browCoverage(b, 1, -0.5, browCentre(plain, -0.5))).toBe(0);
    // It is kept when a document is read, and a damaged one is dropped.
    expect(sanitiseLayer(painted)?.paint).toBe(hex);
    expect(sanitiseLayer({ ...painted, paint: 'zz' })?.paint).toBeUndefined();
    // The texture follows it.
    const composer = assets.skinComposer;
    const map = composer.eyeSurface;
    const a = composer.layerImage(layer);
    const c = composer.layerImage(painted);
    let changed = 0;
    for (let i = 3; i < a.data.length; i += 4) if (Math.abs(a.data[i]! - c.data[i]!) > 40) changed++;
    expect(changed).toBeGreaterThan(100);
    expect(map.window).toBeDefined();
  });

  it('presets set the shape and keep the colour and seed', () => {
    const layer = newLayer('brows', { params: { ...newLayer('brows').params, color: '#101010', seed: 77, fill: 0.1 } });
    const soft = LAYER_PRESETS.brows!.find((p) => p.id === 'soft')!;
    const params = presetParams(layer, soft);
    expect(params.color).toBe('#101010');
    expect(params.seed).toBe(77);
    expect(params.fill).toBe(soft.params.fill);
    // Settings the preset leaves out go back to their defaults.
    const natural = presetParams({ ...layer, params }, LAYER_PRESETS.brows!.find((p) => p.id === 'natural')!);
    expect(natural.fill).toBe(newLayer('brows').params.fill);
    for (const kind of ['brows', 'lashes'] as const) {
      const keys = new Set(Object.keys(newLayer(kind).params));
      for (const p of LAYER_PRESETS[kind]!) for (const key of Object.keys(p.params)) expect(keys.has(key), `${kind} ${p.id} ${key}`).toBe(true);
    }
  });
});
