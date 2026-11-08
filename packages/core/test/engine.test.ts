import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, parseCharacter, serializeCharacter } from '../src/character/doc';
import { starterStyle } from '../src/hair';
import { newLayer } from '../src/skin';
import { CharacterEngine } from '../src/character/engine';
import { BUILTIN_PRESETS, applyPreset } from '../src/character/presets';
import { randomizeCharacter } from '../src/character/randomize';
import { ADULT_MIN_AGE } from '../src/character/sliders';
import { Morpher } from '../src/morph/morpher';
import { assetsAvailable, loadAssets, maxAbsDiff } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

suite('modifier set', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('loads every MakeHuman modifier with resolvable targets', () => {
    expect(assets.modifiers.list.length).toBe(291);
    for (const m of assets.modifiers.list) {
      expect(m.targets.length, m.fullName).toBeGreaterThan(0);
    }
  });

  it('universal modifiers expose MakeHuman names and ranges', () => {
    const m = assets.modifiers.get('nose/nose-trans-down|up');
    expect(m.min).toBe(-1);
    expect(m.clamp(2)).toBe(1);
    expect(m.clamp(-3)).toBe(-1);
    expect(assets.modifiers.get('head/head-oval').min).toBe(0);
  });

  it('symmetric pairs are detected', () => {
    const m = assets.modifiers.get('eyes/l-eye-scale-decr|incr');
    expect(m.symmetricOpposite).toBe('eyes/r-eye-scale-decr|incr');
  });

  it('curated slider view has about 40 sliders, all valid', () => {
    expect(assets.sliders.curated.length).toBeGreaterThanOrEqual(38);
    expect(assets.sliders.curated.length).toBeLessThanOrEqual(55);
    for (const s of assets.sliders.curated) expect(s.safeMin).toBeLessThan(s.safeMax);
    expect(assets.sliders.all.some((s) => s.id.startsWith('genitals/'))).toBe(false);
  });
});

suite('CharacterEngine', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('incremental morph equals a full rebuild', () => {
    const engine = new CharacterEngine(assets);
    const ids = ['macrodetails/Gender', 'nose/nose-scale-horiz-decr|incr', 'macrodetails-universal/Weight', 'head/head-fat-decr|incr'];
    for (let i = 0; i < 40; i++) {
      engine.setValue(ids[i % ids.length]!, Math.sin(i) * 0.9 + (ids[i % ids.length]!.startsWith('macro') ? 0.5 : 0), {
        mergeKey: 'drag',
      });
    }
    const incremental = Float32Array.from(engine.positions);
    const fresh = new Morpher(assets.base, assets.targets);
    fresh.rebuild(assets.modifiers.computeWeights(engine.doc.macros, engine.doc.modifiers));
    expect(maxAbsDiff(incremental, fresh.positions).max).toBeLessThan(1e-6);
  });

  it('slider drags merge into one undo step; undo/redo restore exact state', () => {
    const engine = new CharacterEngine(assets);
    const start = engine.positions.slice();
    for (let i = 1; i <= 20; i++) engine.setValue('macrodetails/Gender', i / 20, { mergeKey: 'gender-drag' });
    engine.endInteraction();
    engine.setValue('nose/nose-hump-decr|incr', 0.7);
    expect(engine.undo()).toBe(true);
    expect(engine.value('nose/nose-hump-decr|incr')).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(engine.value('macrodetails/Gender')).toBe(0.5);
    expect(engine.undo()).toBe(false);
    engine.endInteraction();
    expect(maxAbsDiff(engine.positions, start).max).toBeLessThan(1e-6);
    expect(engine.redo()).toBe(true);
    expect(engine.value('macrodetails/Gender')).toBe(1);
  });

  it('keeps at least 200 undo steps', () => {
    const engine = new CharacterEngine(assets);
    for (let i = 0; i < 250; i++) engine.setValue('head/head-fat-decr|incr', (i % 10) / 10 - 0.5);
    let n = 0;
    while (engine.undo()) n++;
    expect(n).toBeGreaterThanOrEqual(200);
  });

  it('symmetry mirrors paired modifiers, and can be switched off', () => {
    const engine = new CharacterEngine(assets);
    engine.setValue('eyes/l-eye-scale-decr|incr', 0.4);
    expect(engine.value('eyes/r-eye-scale-decr|incr')).toBe(0.4);
    engine.setValue('eyes/l-eye-scale-decr|incr', -0.2, { symmetry: false });
    expect(engine.value('eyes/r-eye-scale-decr|incr')).toBe(0.4);
  });

  it('ethnic macros always sum to 1', () => {
    const engine = new CharacterEngine(assets);
    engine.setValue('macrodetails/African', 0.8);
    const m = engine.doc.macros;
    expect(m.african + m.asian + m.caucasian).toBeCloseTo(1, 9);
  });

  it('never goes below adult age', () => {
    const engine = new CharacterEngine(assets);
    engine.setValue('macrodetails/Age', 0);
    expect(engine.doc.macros.age).toBe(ADULT_MIN_AGE);
    const doc = defaultCharacter();
    doc.macros.age = 0.1;
    engine.load(doc);
    expect(engine.doc.macros.age).toBe(ADULT_MIN_AGE);
  });

  it('presets produce plausible adults', () => {
    const engine = new CharacterEngine(assets);
    for (const p of BUILTIN_PRESETS) {
      engine.load(applyPreset(defaultCharacter(), p));
      const h = engine.heightMetres();
      expect(h, p.id).toBeGreaterThan(1.45);
      expect(h, p.id).toBeLessThan(2.05);
    }
  });

  it('randomize is deterministic per seed and respects locks', () => {
    const base = defaultCharacter();
    const a = randomizeCharacter(base, assets.sliders, { seed: 7 });
    const b = randomizeCharacter(base, assets.sliders, { seed: 7 });
    expect(a.macros).toEqual(b.macros);
    expect(a.modifiers).toEqual(b.modifiers);
    const locked = randomizeCharacter(base, assets.sliders, { seed: 9, locked: new Set(['macrodetails/Gender']) });
    expect(locked.macros.gender).toBe(base.macros.gender);
    const faceOnly = randomizeCharacter(base, assets.sliders, { seed: 3, tab: 'face' });
    expect(faceOnly.macros).toEqual(base.macros);
  });

  it('documents survive serialize/parse', () => {
    const doc = randomizeCharacter(defaultCharacter('Mara'), assets.sliders, { seed: 11 });
    const back = parseCharacter(JSON.parse(serializeCharacter(doc)));
    expect(back.name).toBe('Mara');
    expect(back.modifiers).toEqual(doc.modifiers);
    expect(back.macros.gender).toBeCloseTo(doc.macros.gender, 12);
  });

  // PRD M9: save -> load -> save writes the same bytes, whatever the editor did to the document.
  it('saving is idempotent across load (200 random characters with hair, garments and layers)', () => {
    const styles = ['crew', 'bob', 'ponytail', 'buzz'];
    for (let i = 0; i < 200; i++) {
      const doc = randomizeCharacter(defaultCharacter(`Char ${i}`), assets.sliders, { seed: 5000 + i, amount: 1 });
      // Fields in the order the editor builds them, which differs from the defaults' order.
      if (i % 3 === 0) doc.hair = { mode: 'cards', style: starterStyle(styles[i % styles.length]!), atlas: null, tint: { color: [0.3, 0.2, 0.1], brightness: 1 }, alphaThreshold: 0.5 };
      if (i % 3 === 1) doc.hair = { asset: 'mh:hair/bob02', mode: 'mesh', alphaThreshold: 0.4, tint: { brightness: 0.9, color: [1, 1, 1] } } as typeof doc.hair;
      if (i % 2 === 0) doc.garments = [{ hideBody: true, dirt: 0.2, tint: { color: [1, 0, 0], brightness: 1 }, asset: 'mh:clothes/male_worksuit01', slot: 'full' }];
      if (i % 4 === 0) doc.skin.layers = [newLayer('stubble'), newLayer('freckles')];
      const first = serializeCharacter(doc);
      const second = serializeCharacter(parseCharacter(JSON.parse(first)));
      expect(second, `character ${i}`).toBe(first);
    }
  });
});
