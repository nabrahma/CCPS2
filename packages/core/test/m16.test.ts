/**
 * PRD Part 2 M16 (Creator experience), the checks that run in Node:
 * - outfits: saving, reading (with checks) and putting on, and the two
 *   built-in outfits are library garments;
 * - Material Studio: the converter from user images (a photo alone, or with
 *   maps), the adjustments, "make seamless", and the .ps2mat format;
 * - the library browser's search, tags and favourites.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, NEUTRAL_TINT } from '../src/character/doc';
import { applyOutfit, BUILTIN_OUTFITS, MAX_OUTFIT_GARMENTS, outfitFromCharacter, parseOutfitFile, sanitiseGarmentSlot } from '../src/character/outfit';
import {
  entryTags,
  libraryTags,
  normaliseTag,
  sanitiseFavourites,
  sanitiseUserTags,
  searchLibrary,
  toggleFavourite,
  toggleUserTag,
  type LibraryEntry,
} from '../src/library/browse';
import { createImage, type RgbaImage } from '../src/skin/image';
import { newLook } from '../src/wardrobe/look';
import { channelMean, pbrToEra } from '../src/wardrobe/material';
import {
  adjustAlbedo,
  convertMaterial,
  makeSeamless,
  materialFile,
  NEUTRAL_MATERIAL_ADJUST,
  normalFromHeight,
  parseMaterialFile,
  seamDifference,
  userMaterial,
} from '../src/wardrobe/user-material';
import { assetsAvailable, loadAssets } from './helpers';

/** A photo-like test image that does not tile: a gradient across it plus a weave. */
function photo(size: number): RgbaImage {
  const img = createImage(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const weave = ((x >> 2) + (y >> 2)) % 2 ? 30 : 0;
      const i = (y * size + x) * 4;
      img.data[i] = 60 + (x / size) * 120 + weave;
      img.data[i + 1] = 50 + (y / size) * 90 + weave;
      img.data[i + 2] = 40 + weave;
      img.data[i + 3] = 255;
    }
  return img;
}

describe('outfits (F20)', () => {
  const g = (asset: string, slot: 'top' | 'shoes' = 'top') => ({ slot, asset, tint: { ...NEUTRAL_TINT, color: [0.5, 0.6, 0.7] as [number, number, number] }, dirt: 0.3, hideBody: true });

  it('saves what the character wears, without its paint, and reads it back', () => {
    const doc = defaultCharacter('Test');
    doc.garments = [{ ...g('mh:clothes/a'), paint: 'garment-textures/painted.png', look: newLook('ps2cc:materials/denim') }, g('mh:clothes/b', 'shoes')];
    const file = outfitFromCharacter(doc, 'Weekend');
    expect(file.format).toBe('ps2cc.outfit/1');
    expect(file.outfit.garments[0]!.paint).toBeUndefined();
    const back = parseOutfitFile(JSON.parse(JSON.stringify(file)));
    expect(back.label).toBe('Weekend');
    expect(back.garments.map((x) => x.asset)).toEqual(['mh:clothes/a', 'mh:clothes/b']);
    expect(back.garments[0]!.look?.zones[0]!.material).toBe('ps2cc:materials/denim');
    expect(back.garments[1]!.tint.color).toEqual([0.5, 0.6, 0.7]);
  });

  it('checks every garment it reads and drops unknown ones', () => {
    const raw = {
      format: 'ps2cc.outfit/1',
      outfit: {
        label: '  Odd  ',
        garments: [
          { slot: 'nonsense', asset: 'mh:clothes/a', tint: { color: [9, -1, 'x'], brightness: 99 }, dirt: 7, hideBody: 'no' },
          { slot: 'top', asset: 'mh:clothes/deleted' },
          { asset: 42 },
          null,
          ...Array.from({ length: 40 }, (_, i) => ({ slot: 'accessory', asset: `mh:clothes/x${i}` })),
        ],
      },
    };
    const o = parseOutfitFile(raw, (a) => a !== 'mh:clothes/deleted');
    expect(o.label).toBe('Odd');
    expect(o.garments.length).toBe(MAX_OUTFIT_GARMENTS);
    const first = o.garments[0]!;
    expect(first.slot).toBe('accessory');
    expect(first.tint.color).toEqual([2, 0, 1]);
    expect(first.tint.brightness).toBe(1.6);
    expect(first.dirt).toBe(1);
    expect(first.hideBody).toBe(true);
    expect(o.garments.some((x) => x.asset === 'mh:clothes/deleted')).toBe(false);
    expect(sanitiseGarmentSlot({ asset: '' })).toBeNull();
    expect(() => parseOutfitFile({ format: 'ps2cc.preset/1' })).toThrow();
    expect(() => parseOutfitFile({ format: 'ps2cc.outfit/1', outfit: { label: ' ', garments: [] } })).toThrow();
  });

  it('putting an outfit on replaces what is worn and dresses garments that have defaults', () => {
    const doc = defaultCharacter('Test');
    doc.garments = [g('mh:clothes/old')];
    const look = newLook('ps2cc:materials/canvas');
    const out = applyOutfit(doc, { id: 'o', label: 'O', garments: [g('mh:clothes/new'), { ...g('mh:clothes/own'), look: newLook('ps2cc:materials/denim') }] }, (a) => (a === 'mh:clothes/new' || a === 'mh:clothes/own' ? { look } : undefined));
    expect(out.garments.map((x) => x.asset)).toEqual(['mh:clothes/new', 'mh:clothes/own']);
    expect(out.garments[0]!.look?.zones[0]!.material).toBe('ps2cc:materials/canvas');
    // A garment's own look is kept.
    expect(out.garments[1]!.look?.zones[0]!.material).toBe('ps2cc:materials/denim');
    // The character it was put on is not changed.
    expect(doc.garments.map((x) => x.asset)).toEqual(['mh:clothes/old']);
  });

  describe.skipIf(!assetsAvailable)('built-in outfits', () => {
    let assets: CoreAssets;
    beforeAll(async () => {
      assets = await loadAssets();
    }, 120_000);
    it('are made of library garments, the benchmark vest and jacket among them', () => {
      expect(BUILTIN_OUTFITS.map((o) => o.id)).toEqual(['utility-vest', 'leather-jacket']);
      for (const o of BUILTIN_OUTFITS) for (const x of o.garments) expect(assets.hasProxy(x.asset), x.asset).toBe(true);
      const assetsOf = (id: string) => BUILTIN_OUTFITS.find((o) => o.id === id)!.garments.map((x) => x.asset);
      expect(assetsOf('utility-vest')).toContain('ps2cc:clothes/mara_utility_vest');
      expect(assetsOf('leather-jacket')).toContain('ps2cc:clothes/cole_leather_jacket');
      // Put on, the Garment Studio garments bring their looks, and the jacket its fur.
      const worn = applyOutfit(defaultCharacter('T'), BUILTIN_OUTFITS[1]!, (a) => assets.proxyInfo(a).defaults).garments;
      expect(worn.every((x) => x.look)).toBe(true);
      expect(worn.find((x) => x.asset === 'ps2cc:clothes/cole_leather_jacket')?.fur).toBeTruthy();
    });
  });
});

describe('Material Studio (F20)', () => {
  it('makes an image tile: the edges meet, the middle is the image', () => {
    const img = photo(128);
    const before = seamDifference(img);
    const tiled = makeSeamless(img, 0.25);
    expect(before).toBeGreaterThan(0.08);
    expect(seamDifference(tiled)).toBeLessThan(before / 10);
    const mid = (64 * 128 + 64) * 4;
    expect(Array.from(tiled.data.subarray(mid, mid + 3))).toEqual(Array.from(img.data.subarray(mid, mid + 3)));
    expect(makeSeamless(img, 0)).toBe(img);
  });

  it('adjusts colour: neutral changes nothing, brightness scales, hue turns red to green', () => {
    const img = photo(16);
    expect(Array.from(adjustAlbedo(img, NEUTRAL_MATERIAL_ADJUST).data)).toEqual(Array.from(img.data));
    const bright = adjustAlbedo(img, { ...NEUTRAL_MATERIAL_ADJUST, brightness: 0.5 });
    expect(channelMean(bright, 1)).toBeCloseTo(channelMean(img, 1) * 0.5, 2);
    const red = createImage(4, 4, [200, 20, 20, 255]);
    const turned = adjustAlbedo(red, { ...NEUTRAL_MATERIAL_ADJUST, hue: 120 });
    expect(turned.data[1]).toBeGreaterThan(150);
    expect(turned.data[0]).toBeLessThan(50);
  });

  it('a flat height map gives a flat normal map, a slope tilts it', () => {
    const flat = normalFromHeight(createImage(8, 8, [128, 128, 128, 255]));
    expect([flat.data[0], flat.data[1], flat.data[2]]).toEqual([128, 128, 255]);
    const slope = createImage(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) slope.data.set([x * 20, x * 20, x * 20, 255], (y * 8 + x) * 4);
    const n = normalFromHeight(slope);
    // Rising to the right: the normal leans left (red below the middle) in the interior.
    expect(n.data[(3 * 8 + 3) * 4]!).toBeLessThan(120);
  });

  it('converts a single photo: relief from its brightness, tileable once seamless, the same as the library converter on flat maps', () => {
    const img = photo(64);
    const out = convertMaterial({ albedo: img }, { ...NEUTRAL_MATERIAL_ADJUST, seamless: 0.25 }, 64);
    expect(out.diffuse.width).toBe(64);
    expect(seamDifference(out.diffuse)).toBeLessThan(0.05);
    expect(out.gloss).toBeGreaterThan(0);
    expect(out.swatch.every((c) => c > 0 && c < 1)).toBe(true);
    // With a flat normal map and no relief, the conversion is pbrToEra's.
    const flat = createImage(64, 64, [128, 128, 255, 255]);
    const noRelief = convertMaterial({ albedo: img, normal: flat }, NEUTRAL_MATERIAL_ADJUST, 64);
    const arm = createImage(64, 64, [255, 204, 0, 255]);
    const ref = pbrToEra({ albedo: img, normal: flat, arm });
    let worst = 0;
    for (let i = 0; i < ref.data.length; i++) worst = Math.max(worst, Math.abs(ref.data[i]! - noRelief.diffuse.data[i]!));
    expect(worst).toBeLessThanOrEqual(1);
    // Relief darkens the cavities: the photo-only diffuse differs from the flat one.
    expect(Math.abs(channelMean(out.diffuse, 0) - channelMean(noRelief.diffuse, 0))).toBeGreaterThan(0);
  });

  it('resizes sources to the material size and reads its roughness', () => {
    const rough = createImage(32, 32, [51, 51, 51, 255]);
    const out = convertMaterial({ albedo: photo(100), roughness: rough }, NEUTRAL_MATERIAL_ADJUST, 32);
    expect(out.diffuse.width).toBe(32);
    expect(out.roughness).toBeCloseTo(0.2, 2);
    expect(out.gloss).toBeGreaterThan(0.4);
  });

  it('the .ps2mat file: written, read back with checks, and made a library entry', () => {
    const converted = convertMaterial({ albedo: photo(32) }, NEUTRAL_MATERIAL_ADJUST, 32);
    const file = materialFile('My denim', 'denim', 0.12, converted, 'My denim_diffuse.png', 'ps2cc:materials/denim', { ...NEUTRAL_MATERIAL_ADJUST, hue: 10 });
    const doc = parseMaterialFile(JSON.parse(JSON.stringify(file)));
    expect(doc).toMatchObject({ name: 'My denim', kind: 'denim', tileMetres: 0.12, diffuseSize: 32, from: 'ps2cc:materials/denim' });
    expect(doc.adjust.hue).toBe(10);
    const m = userMaterial(doc, 'user:materials/My denim', '/library/materials/My%20denim_diffuse.png');
    expect(m.source.site).toBe('user');
    expect(m.diffuse).toBe('/library/materials/My%20denim_diffuse.png');
    expect(m.gloss).toBe(converted.gloss);
    // Bad values are clamped or replaced; a file that is not a material, or points outside its folder, is refused.
    const odd = parseMaterialFile({ format: 'ps2cc.material/1', material: { name: 'x', kind: 'plastic', tileMetres: 99, diffuse: 'x.png', adjust: { hue: 999, relief: -3 } } });
    expect(odd.kind).toBe('cotton');
    expect(odd.tileMetres).toBe(4);
    expect(odd.adjust.hue).toBe(180);
    expect(odd.adjust.relief).toBe(0);
    expect(() => parseMaterialFile({ format: 'ps2cc.material/1', material: { name: 'x', diffuse: '../../secret.png' } })).toThrow();
    expect(() => parseMaterialFile({ format: 'ps2cc.hair/2' })).toThrow();
  });
});

describe('library browser (F20)', () => {
  const e = (id: string, name: string, tags: string[], user = false): LibraryEntry => ({ id, category: 'garments', name, tags, user });
  const entries = [e('g:1', 'Cargo trousers', ['bottom']), e('g:2', 'Leather jacket', ['outer', 'dressed']), e('g:3', 'My vest', ['outer', 'user'], true), e('g:4', 'Wool hat', ['hat'])];

  it('searches names and tags, every word, ignoring case and punctuation', () => {
    expect(searchLibrary(entries, { text: 'JACKET' }, new Set()).map((x) => x.id)).toEqual(['g:2']);
    expect(searchLibrary(entries, { text: 'outer leather' }, new Set()).map((x) => x.id)).toEqual(['g:2']);
    expect(searchLibrary(entries, { text: 'cargo-trousers!' }, new Set()).map((x) => x.id)).toEqual(['g:1']);
    expect(searchLibrary(entries, { tag: 'outer' }, new Set()).map((x) => x.id)).toEqual(['g:3', 'g:2']);
  });

  it('puts favourites first, then the user’s own, then by name; can show favourites only', () => {
    const fav = new Set(['g:4']);
    expect(searchLibrary(entries, {}, fav).map((x) => x.id)).toEqual(['g:4', 'g:3', 'g:1', 'g:2']);
    expect(searchLibrary(entries, { favouritesOnly: true }, fav).map((x) => x.id)).toEqual(['g:4']);
  });

  it('user tags are searched like the asset’s own, and counted', () => {
    let tags = toggleUserTag({}, 'g:1', '  Mara ');
    tags = toggleUserTag(tags, 'g:2', 'mara');
    expect(tags).toEqual({ 'g:1': ['mara'], 'g:2': ['mara'] });
    expect(searchLibrary(entries, { tag: 'mara' }, new Set(), tags).map((x) => x.id)).toEqual(['g:1', 'g:2']);
    expect(entryTags(entries[0]!, tags)).toEqual(['bottom', 'mara']);
    expect(libraryTags(entries, tags)[0]).toEqual({ tag: 'mara', count: 2 });
    // Toggling again removes it, and an entry with no tags left is dropped.
    expect(toggleUserTag(tags, 'g:1', 'MARA')).toEqual({ 'g:2': ['mara'] });
    expect(toggleUserTag(tags, 'g:1', '!!!')).toBe(tags);
  });

  it('favourites toggle, and settings are checked when read', () => {
    expect(toggleFavourite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b']);
    expect(sanitiseFavourites(['a', 'a', 3, '', 'b'])).toEqual(['a', 'b']);
    expect(sanitiseFavourites('nope')).toEqual([]);
    expect(sanitiseUserTags({ x: ['Hat', 'hat', 5, ''], y: [], z: 'no' })).toEqual({ x: ['hat'] });
    expect(normaliseTag('  Hero / Mara!! ')).toBe('hero mara');
  });
});
