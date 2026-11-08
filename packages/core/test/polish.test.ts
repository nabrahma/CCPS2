/**
 * The smaller PRD requirements finished after M10: credits (9.2), user
 * presets (F1), the export-size preview (F9), the painted hairline (F5 step 2)
 * and "Fit face shape to photo" (F7 step 6).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { NEUTRAL_TINT, type GarmentSlot, defaultCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { applyPreset, BUILTIN_PRESETS, parsePresetFile, presetFromCharacter } from '../src/character/presets';
import { buildCredits, type LicenceManifest } from '../src/credits';
import { packAtlas } from '../src/export/atlas';
import { atlasCellTexels, GARMENT_ATLAS_SIZE } from '../src/export/limits';
import {
  atlasTemplate,
  decodePaint,
  encodePaint,
  HairGenerator,
  hairline,
  hairlineToPaint,
  hairStyleFile,
  hashHair,
  isPaintString,
  PAINT_COLS,
  PAINT_ROWS,
  paintAllows,
  paintStroke,
  parseHairStyleFile,
  sanitiseStyle,
  Scalp,
  STARTER_STYLES,
  starterStyle,
} from '../src/hair';
import { CharacterScene } from '../src/scene/character-scene';
import { createImage } from '../src/skin/image';
import { alignedResidual, FACE_FIT_SLIDERS, fitFaceToPhoto } from '../src/skin/photo/fit';
import { landmarkPoint, LANDMARK_COUNT, type LandmarkTable } from '../src/skin/photo/project';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;
const DEG = Math.PI / 180;

describe('credits', () => {
  const row = (file: string, licence: string, author: string, extra: Partial<LicenceManifest['files'][number]> = {}) => ({
    file, licence, author, sourceUrl: 'http://x', upstream: 'pack', asset: `a:${file}`, attributionRequired: licence === 'CC-BY-4.0', ...extra,
  });

  it('puts every file in one entry and separates what must be credited', () => {
    const c = buildCredits({
      files: [
        row('1', 'CC-BY-4.0', 'Ann'),
        row('2', 'CC-BY-4.0', 'Ann (decimated by PS2CC)'),
        row('3', 'CC0-1.0', 'Bob'),
        row('4', 'Apache-2.0', 'Google', { attributionRequired: false }),
      ],
    });
    expect(c.files).toBe(4);
    expect([...c.attribution, ...c.courtesy].reduce((n, e) => n + e.files, 0)).toBe(4);
    expect(c.attribution.map((e) => e.author)).toEqual(['Ann', 'Google']);
    expect(c.attribution[0]).toMatchObject({ files: 2, modified: true, assets: ['a:1', 'a:2'] });
    expect(c.courtesy.map((e) => e.author)).toEqual(['Bob']);
    expect(c.licences[0]).toEqual(['CC-BY-4.0', 2]);
  });
});

suite('with the shipped assets', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('credits every CC-BY asset that ships', async () => {
    const manifest = await assets.licenceManifest();
    const c = buildCredits(manifest);
    expect(c.files).toBe(manifest.files.length);
    const credited = new Set(c.attribution.flatMap((e) => e.assets));
    const required = manifest.files.filter((f) => f.licence === 'CC-BY-4.0');
    expect(required.length).toBeGreaterThan(0);
    for (const f of required) expect(credited.has(f.asset!), f.file).toBe(true);
  });

  describe('user presets', () => {
    it('round-trips a character through a file', () => {
      const doc = defaultCharacter();
      doc.macros.gender = 0.2;
      doc.macros.african = 0.6;
      doc.macros.asian = 0.3;
      doc.macros.caucasian = 0.1;
      doc.modifiers['nose/nose-scale-horiz-decr|incr'] = 0.4;
      const file = JSON.parse(JSON.stringify(presetFromCharacter(doc, 'Mine')));
      const out = applyPreset(defaultCharacter(), parsePresetFile(file));
      expect(out.macros).toEqual(doc.macros);
      expect(out.modifiers).toEqual(doc.modifiers);
      expect(out.skin.base).toBe(doc.skin.base);
    });

    it('built-in presets still leave the ethnic blend alone', () => {
      const doc = defaultCharacter();
      doc.macros.african = 0.8;
      doc.macros.asian = 0.1;
      doc.macros.caucasian = 0.1;
      expect(applyPreset(doc, BUILTIN_PRESETS[0]!).macros.african).toBe(0.8);
    });

    it('rejects other files and drops bad values', () => {
      expect(() => parsePresetFile({ format: 'ps2cc.hair/1' })).toThrow();
      expect(() => parsePresetFile({ format: 'ps2cc.preset/1', preset: { label: ' ' } })).toThrow();
      const p = parsePresetFile(
        { format: 'ps2cc.preset/1', preset: { label: 'x', macros: { gender: 3, age: 'old' }, modifiers: { good: 0.5, bad: 'a', gone: 0.1 } } },
        (id) => id !== 'gone',
      );
      expect(p.macros).toEqual({ gender: 1 });
      expect(p.modifiers).toEqual({ good: 0.5 });
      expect(p.includesEthnic).toBe(false);
    });
  });

  describe('export-size preview', () => {
    it('agrees with the cells packAtlas really makes', () => {
      for (let n = 1; n <= 10; n++) {
        const atlas = packAtlas(new Array(n).fill(createImage(4, 4)), GARMENT_ATLAS_SIZE);
        const cell = atlas.cells[0]!.uv;
        expect(Math.round((cell[2] - cell[0]) * GARMENT_ATLAS_SIZE)).toBe(atlasCellTexels(n, GARMENT_ATLAS_SIZE));
      }
    });

    it('follows the export settings and what is worn', async () => {
      const engine = new CharacterEngine(assets);
      const scene = new CharacterScene(engine);
      await scene.sync();
      const body = () => scene.parts.find((p) => p.kind === 'body')!;
      const at1024 = scene.exportTexels(body());
      expect(at1024.texels).toBe(engine.doc.export.bodyTexture);
      expect(at1024.head).toBeGreaterThan(0);
      engine.update('smaller', (d) => {
        d.export.headTexture = 512;
        d.export.bodyTexture = 512;
      });
      const at512 = scene.exportTexels(body());
      expect(at512.texels).toBe(512);
      expect(at512.head / at1024.head).toBeGreaterThan(0.45);
      expect(at512.head / at1024.head).toBeLessThan(0.5); // the 8 px gutter costs a 512 px head a little more

      const wear = (asset: string): GarmentSlot => ({ slot: 'top', asset, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody: true });
      engine.update('one', (d) => void d.garments.push(wear('mh:clothes/male_casualsuit01')));
      await scene.sync();
      const garment = () => scene.parts.find((p) => p.kind === 'garment')!;
      expect(scene.exportTexels(garment()).texels).toBe(atlasCellTexels(1, GARMENT_ATLAS_SIZE));
      engine.update('two', (d) => void d.garments.push(wear('mh:clothes/male_worksuit01')));
      await scene.sync();
      expect(scene.exportTexels(garment()).texels).toBe(atlasCellTexels(2, GARMENT_ATLAS_SIZE));
    });

    it('marks head vertices, and only those', async () => {
      const scene = new CharacterScene(new CharacterEngine(assets));
      await scene.sync();
      const body = scene.parts.find((p) => p.kind === 'body')!;
      const flags = scene.bodyHeadFlags()!;
      expect(flags).toHaveLength(body.uvs.length / 2);
      const heads = flags.reduce((n, f) => n + f, 0);
      expect(heads).toBeGreaterThan(flags.length * 0.2);
      expect(heads).toBeLessThan(flags.length * 0.8);
    });
  });

  describe('painted hairline', () => {
    const atlas = atlasTemplate('strips8');

    it('encodes without loss', () => {
      const rng = new Rng(7);
      const cells = new Uint8Array(PAINT_COLS * PAINT_ROWS).map(() => (rng.next() < 0.5 ? 1 : 0));
      const hex = encodePaint(cells);
      expect(isPaintString(hex)).toBe(true);
      expect(decodePaint(hex)).toEqual(cells);
    });

    it('a preset turned into paint keeps its hairline to within a cell or so', () => {
      const mask = hairline('full');
      const hex = hairlineToPaint(mask);
      for (let a = -175; a <= 175; a += 7) {
        const phi = a * DEG;
        const limit = Scalp.maskLimit(mask, phi);
        expect(paintAllows(hex, limit - 6 * DEG, phi), `inside at ${a}`).toBe(true);
        expect(paintAllows(hex, limit + 6 * DEG, phi), `outside at ${a}`).toBe(false);
      }
    });

    it('erasing a patch removes the hair there and nowhere else', () => {
      const engine = new CharacterEngine(assets);
      const gen = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
      const style = starterStyle(STARTER_STYLES[2]!.id);
      const painted = { ...style, hairline: { ...style.hairline, preset: 'painted' as const, painted: hairlineToPaint(style.hairline) } };
      const full = gen.generate(painted, atlas, engine.positions, engine.skeleton);
      expect(hashHair(gen.generate(painted, atlas, engine.positions, engine.skeleton))).toBe(hashHair(full));

      // A bald spot on the crown, 30 degrees in radius.
      const cells = decodePaint(painted.hairline.painted);
      paintStroke(cells, 20 * DEG, 180 * DEG, 30 * DEG, false);
      const hex = encodePaint(cells);
      expect(paintAllows(hex, 20 * DEG, 179 * DEG)).toBe(false);
      expect(paintAllows(hex, 30 * DEG, 0)).toBe(true);
      const bald = gen.generate({ ...painted, hairline: { ...painted.hairline, painted: hex } }, atlas, engine.positions, engine.skeleton);
      expect(bald.cards).toBeGreaterThan(0);
      expect(hashHair(bald)).not.toBe(hashHair(full));
    });

    it('never places a root where the mask is erased', () => {
      const scalp = (new HairGenerator(assets.base, assets.rig, assets.weights.sparse) as unknown as { scalp: Scalp; neutralFrame: { centre: [number, number, number] } });
      const cells = decodePaint(hairlineToPaint(hairline('full')));
      paintStroke(cells, 45 * DEG, -90 * DEG, 25 * DEG, false, true);
      const mask = { ...hairline('full'), preset: 'painted' as const, painted: encodePaint(cells) };
      const roots = scalp.scalp.sampleRoots(300, 11, mask, assets.base.positions, scalp.neutralFrame);
      expect(roots.length).toBeGreaterThan(100);
      for (const r of roots) expect(Scalp.allows(mask, r.theta, r.phi)).toBe(true);
    });

    it('survives a .ps2hair file, and a damaged bitmap falls back', () => {
      const style = starterStyle(STARTER_STYLES[2]!.id);
      const hex = hairlineToPaint(style.hairline);
      const painted = { ...style, hairline: { ...style.hairline, preset: 'painted' as const, painted: hex } };
      expect(parseHairStyleFile(JSON.parse(JSON.stringify(hairStyleFile(painted)))).hairline.painted).toBe(hex);
      const broken = sanitiseStyle({ ...painted, hairline: { ...painted.hairline, painted: 'zz' } });
      expect(broken.hairline.preset).toBe('custom');
      expect(broken.hairline.painted).toBeUndefined();
    });
  });

  describe('fit face shape to photo', () => {
    let table: LandmarkTable;
    beforeAll(async () => {
      table = (await assets.landmarkTable())!;
      expect(table).not.toBeNull();
    });

    /** Landmarks of a character as a camera would see them: scaled, rotated, shifted, with detector noise. */
    function photoOf(modifiers: Record<string, number>, noisePx: number) {
      const engine = new CharacterEngine(assets);
      engine.update('truth', (d) => void Object.assign(d.modifiers, modifiers));
      const [W, H] = [1000, 1200];
      const [s, c, sn] = [2800, Math.cos(3 * DEG), Math.sin(3 * DEG)];
      const rng = new Rng(5);
      const landmarks = new Array<number>(LANDMARK_COUNT * 3).fill(0);
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const p = landmarkPoint(table, i, engine.positions);
        if (!p) continue;
        const y = p[1] - 1.55;
        const px = 500 + s * (c * p[0] - sn * y) + (rng.next() - 0.5) * 2 * noisePx;
        const py = 600 + s * (sn * p[0] + c * y) + (rng.next() - 0.5) * 2 * noisePx;
        landmarks[i * 3] = px / W;
        landmarks[i * 3 + 1] = 1 - py / H;
      }
      return { landmarks, width: W, height: H };
    }

    const fit = (photo: ReturnType<typeof photoOf>) => {
      const d = defaultCharacter();
      return fitFaceToPhoto({ assets, macros: d.macros, modifiers: d.modifiers, table, ...photo });
    };

    it('ignores framing: a pure similarity has no residual', () => {
      const p = Float64Array.from([0, 0, 1, 0, 1, 2, -3, 1]);
      const [s, c, sn] = [7, Math.cos(0.4), Math.sin(0.4)];
      const q = new Float64Array(p.length);
      for (let i = 0; i < p.length; i += 2) {
        q[i] = 5 + s * (c * p[i]! - sn * p[i + 1]!);
        q[i + 1] = -2 + s * (sn * p[i]! + c * p[i + 1]!);
      }
      for (const v of alignedResidual(p, q, 1)) expect(Math.abs(v)).toBeLessThan(1e-9);
    });

    it('leaves a face that already matches where it is', () => {
      const out = fit(photoOf({}, 0));
      expect(out.errorBefore).toBeLessThan(1e-6);
      for (const v of Object.values(out.modifiers)) expect(Math.abs(v)).toBeLessThan(1e-3);
    });

    it('recovers a different face from noisy landmarks', () => {
      const truth = {
        'eyes/l-eye-trans-in|out': 0.4,
        'eyes/r-eye-trans-in|out': 0.4,
        'nose/nose-scale-horiz-decr|incr': 0.5,
        'mouth/mouth-scale-horiz-decr|incr': -0.4,
        'chin/chin-height-decr|incr': 0.4,
      };
      const out = fit(photoOf(truth, 0.75));
      expect(out.errorAfter).toBeLessThan(out.errorBefore * 0.4);
      expect(out.modifiers['eyes/l-eye-trans-in|out']!).toBeGreaterThan(0.15);
      expect(out.modifiers['eyes/r-eye-trans-in|out']).toBe(out.modifiers['eyes/l-eye-trans-in|out']);
      expect(out.modifiers['nose/nose-scale-horiz-decr|incr']!).toBeGreaterThan(0.15);
      expect(out.modifiers['mouth/mouth-scale-horiz-decr|incr']!).toBeLessThan(-0.15);
    });

    it('stays inside the safe slider ranges', () => {
      // A much wider face than any slider allows: the fit must stop at the limits.
      const photo = photoOf({}, 0);
      for (let i = 0; i < LANDMARK_COUNT; i++) photo.landmarks[i * 3] = 0.5 + (photo.landmarks[i * 3]! - 0.5) * 1.8;
      const out = fit(photo);
      for (const id of FACE_FIT_SLIDERS) {
        const s = assets.sliders.byId.get(id);
        if (!s) continue;
        expect(out.modifiers[id]!, id).toBeGreaterThanOrEqual(s.safeMin - 1e-9);
        expect(out.modifiers[id]!, id).toBeLessThanOrEqual(s.safeMax + 1e-9);
      }
    });
  });
});
