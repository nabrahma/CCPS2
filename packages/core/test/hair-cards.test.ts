/**
 * The hair system ported from the "Hair cards from curves" Blender setup
 * (docs/hair-system.md): curve tools, one card from one curve, the groom
 * (guides and interpolated hairs) and the generated card textures.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import {
  atlasTemplate,
  blendVolumeNormals,
  cardFromCurve,
  DEFAULT_CARD_BUILD,
  DEFAULT_CARD_STRIPS,
  defaultCardTexture,
  generateCardTexture,
  HairGenerator,
  sanitiseStyle,
  starterStyle,
  type CardBuildParams,
  type HairSurface,
} from '../src/hair';
import { arcLengths, closestOnPolyline, cross, curveLength, dot, normalized, resample, shapeRange, sub, tangents, transportNormals, trim, type Vec3 } from '../src/hair/curves';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe('curve tools', () => {
  const bent: Vec3[] = [[0, 0, 0], [0.1, 0, 0], [0.1, -0.3, 0], [0.1, -0.3, 0.2]];

  it('resample spaces points evenly and keeps the ends', () => {
    const r = resample(bent, 13);
    expect(r[0]).toEqual(bent[0]);
    expect(len(sub(r[12]!, bent[3]!))).toBeLessThan(1e-12);
    const arcs = arcLengths(bent);
    const onCurve = arcLengths(r);
    // Corners are cut by the straight chords, so compare along the original instead.
    for (let i = 0; i < 13; i++) expect(closestOnPolyline(bent, r[i]!).distance).toBeLessThan(1e-9);
    expect(onCurve[12]!).toBeLessThanOrEqual(arcs[3]! + 1e-9);
  });

  it('trim keeps the first part of the length', () => {
    expect(curveLength(trim(bent, 0.5))).toBeCloseTo(0.3, 9);
    expect(curveLength(trim(bent, 1))).toBeCloseTo(0.6, 9);
    expect(trim(bent, 0.5)[0]).toEqual(bent[0]);
  });

  it('transported normals stay unit and perpendicular, and do not twist on a planar curve', () => {
    const arc: Vec3[] = Array.from({ length: 20 }, (_, i) => [Math.sin(i * 0.1), -Math.cos(i * 0.1), 0] as Vec3);
    const t = tangents(arc);
    const n = transportNormals(t, [0, 0, 1]);
    for (let i = 0; i < n.length; i++) {
      expect(len(n[i]!)).toBeCloseTo(1, 9);
      expect(Math.abs(dot(n[i]!, t[i]!))).toBeLessThan(1e-9);
      expect(n[i]![2]).toBeCloseTo(1, 9); // the plane's normal is carried unchanged
    }
  });

  it('shapeRange matches the node group at its landmarks', () => {
    for (const x of [0, 0.3, 1]) expect(shapeRange(x, 0)).toBe(1);
    for (const x of [0, 0.25, 0.7, 1]) expect(shapeRange(x, 0.5)).toBeCloseTo(x, 6);
    // Small shapes take hold early, large ones only near the tip; both are 0 at the root and 1 at the tip.
    expect(shapeRange(0.3, 0.14)).toBeGreaterThan(0.7);
    expect(shapeRange(0.7, 0.9)).toBeLessThan(0.2);
    for (const s of [0.14, 0.5, 0.9]) {
      expect(shapeRange(0, s)).toBeCloseTo(0, 6);
      expect(shapeRange(1, s)).toBeCloseTo(1, 6);
      let prev = 0;
      for (let x = 0; x <= 1.0001; x += 0.05) {
        expect(shapeRange(x, s)).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = shapeRange(x, s);
      }
    }
    // Negative shapes mirror the profile from the root.
    expect(shapeRange(0.2, -0.3)).toBeCloseTo(shapeRange(0.8, 0.3), 6);
  });
});

describe('one card from one curve', () => {
  const R = 0.1;
  const sphere: HairSurface = {
    closest: (p) => {
      const n = normalized(p);
      return { point: [n[0] * R, n[1] * R, n[2] * R], normal: n, distance: Math.abs(len(p) - R) };
    },
  };
  /** From the side of the sphere, out a little, then down. */
  const curve: Vec3[] = resample([[R, 0, 0], [R + 0.02, -0.01, 0], [R + 0.03, -0.08, 0], [R + 0.03, -0.3, 0]], 12);
  const plain: CardBuildParams = { ...DEFAULT_CARD_BUILD, tipTwist: 0, rootSnap: 0, snapIfInside: 0 };
  const build = (over: Partial<CardBuildParams> = {}, random = 0.5, parting: Vec3[] | null = null) =>
    cardFromCurve({ curve, segments: 6, width: 0.04, taper: 0, random, surface: sphere, parting }, { ...plain, ...over });
  const sideAt = (c: ReturnType<typeof build>, section: number) => normalized(sub(c.positions[section * 2 + 1]!, c.positions[section * 2]!));

  it('is a strip of the asked width, a little shorter than its curve', () => {
    const c = build();
    expect(c.positions).toHaveLength(14);
    expect(c.along[0]).toBe(0);
    expect(c.along[6]).toBe(1);
    for (let j = 0; j <= 6; j++) expect(len(sub(c.positions[j * 2 + 1]!, c.positions[j * 2]!))).toBeCloseTo(0.04, 6);
    const centre = Array.from({ length: 7 }, (_, j) => [0, 1, 2].map((k) => (c.positions[j * 2]![k]! + c.positions[j * 2 + 1]![k]!) / 2) as Vec3);
    const total = curveLength(curve);
    expect(curveLength(centre)).toBeGreaterThan(total * plain.downscale * 0.97);
    expect(curveLength(centre)).toBeLessThanOrEqual(total * plain.downscale + 1e-9);
    expect(curveLength(Array.from({ length: 7 }, (_, j) => build({ lengthFactor: 0.5 }).positions[j * 2]!))).toBeLessThan(total * 0.55);
  });

  it('lies on the head: its width is tangent to the surface at the root, and stays so without twist', () => {
    const c = build();
    const n0 = sphere.closest(curve[0]!)!.normal;
    expect(Math.abs(dot(sideAt(c, 0), n0))).toBeLessThan(1e-6);
    // The curve is planar (z = 0) and the surface normal lies in that plane, so the width keeps pointing along z.
    for (let j = 0; j <= 6; j++) expect(Math.abs(sideAt(c, j)[2])).toBeCloseTo(1, 6);
  });

  it('align to world keeps the curve\'s own horizontal normal instead', () => {
    const world = build({ alignToSurface: 0 });
    const tan = tangents(curve)[0]!;
    // World normal is horizontal and perpendicular to the tangent; the width is perpendicular to both.
    const expected = normalized(cross(tan, [tan[2] / Math.hypot(tan[0], tan[2]), 0, -tan[0] / Math.hypot(tan[0], tan[2])]));
    // (The card resamples its curve, so the tangent at the root is only nearly the same.)
    expect(Math.abs(dot(sideAt(world, 0), expected))).toBeGreaterThan(0.99);
  });

  it('random tip twist grows from the root to the tip, and offset tilt turns the whole card', () => {
    const twisted = build({ tipTwist: 0.5 }, 1); // +90 degrees at the tip
    expect(Math.abs(dot(sideAt(twisted, 0), sideAt(build(), 0)))).toBeGreaterThan(0.99);
    expect(Math.abs(dot(sideAt(twisted, 6), sideAt(build(), 6)))).toBeLessThan(0.1);
    expect(Math.abs(dot(sideAt(build({ tipTwist: 0.5 }, 0.5), 6), sideAt(build(), 6)))).toBeCloseTo(1, 6);
    const turned = build({ offsetTilt: 90 });
    for (let j = 0; j <= 6; j++) expect(Math.abs(dot(sideAt(turned, j), sideAt(build(), j)))).toBeLessThan(1e-6);
  });

  it('snaps roots onto the skin and pushes out what is inside', () => {
    const c = build({ rootSnap: 0.026, surfaceOffset: 0.001, snapIfInside: 0.022 });
    for (const v of [0, 1]) expect(len(c.positions[v]!)).toBeCloseTo(R + 0.001, 4);
    for (const p of c.positions) expect(len(p)).toBeGreaterThan(R - 1e-6);
    // Without the snap the root corners float where the flat strip happens to start.
    const raw = build();
    expect(Math.min(...raw.positions.slice(0, 2).map(len))).toBeGreaterThan(R + 0.003);
  });

  it('roots near the parting line meet on it, and hair beside it is lifted', () => {
    const parting: Vec3[] = [[R, 0, -0.05], [R, 0, 0.05]];
    const c = build({ partSnap: 0.03, partLiftHeight: 0.006, partLiftDistance: 0.1 }, 0.5, parting);
    for (const v of [0, 1]) expect(closestOnPolyline(parting, c.positions[v]!).distance).toBeLessThan(1e-9);
    const flat = build({ partSnap: 0.03, partLiftHeight: 0, partLiftDistance: 0.1 }, 0.5, parting);
    const lifted = len(sub(c.positions[2]!, flat.positions[2]!));
    expect(lifted).toBeGreaterThan(0.001);
    expect(lifted).toBeLessThanOrEqual(0.006 + 1e-9);
    // Far down the hair nothing is lifted.
    expect(len(sub(c.positions[12]!, flat.positions[12]!))).toBeLessThan(1e-9);
  });

  it('volume normals point out of the hair, whichever way the card faces', () => {
    const positions = Float32Array.from([0.1, 1.7, 0, 0, 1.2, 0.12, -0.1, 1.0, 0]);
    const own = Float32Array.from([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const untouched = own.slice();
    blendVolumeNormals(positions, untouched, [0, 1.6, 0], 0.6, 0);
    expect(untouched).toEqual(own);
    const n = own.slice();
    blendVolumeNormals(positions, n, [0, 1.6, 0], 0.6, 1);
    // Above the axis top: away from it. Below: straight out sideways.
    expect(n[0]).toBeGreaterThan(0.6);
    expect(n[1]).toBeGreaterThan(0.6);
    expect(Array.from(n.subarray(3, 6))).toEqual([0, 0, 1]);
    expect(Array.from(n.subarray(6, 9))).toEqual([-1, 0, 0]);
    const half = own.slice();
    blendVolumeNormals(positions, half, [0, 1.6, 0], 0.6, 0.5);
    // The first card faced inwards: its own normal is turned to face out before blending.
    expect(half[0]).toBeGreaterThan(0.9);
  });
});

describe('generated card textures', () => {
  const small = { ...defaultCardTexture('brown', 256) };
  const made = generateCardTexture(small);

  it('is deterministic for a seed, and different for another', () => {
    expect(generateCardTexture(small).image.data).toEqual(made.image.data);
    expect(generateCardTexture({ ...small, seed: small.seed + 1 }).image.data).not.toEqual(made.image.data);
  });

  it('gives one full-height region per strip, side by side, with the tags a style asks for', () => {
    expect(made.regions.map((r) => r.tag)).toEqual(DEFAULT_CARD_STRIPS.map((s) => s.tag));
    let x = 0;
    for (const r of made.regions) {
      expect(r.x).toBeCloseTo(x, 9);
      expect([r.y, r.h]).toEqual([0, 1]);
      x += r.w;
    }
    expect(x).toBeCloseTo(1, 9);
    for (const tag of ['clump', 'strand', 'base', 'fringe', 'flyaway']) expect(made.regions.some((r) => r.tag === tag), tag).toBe(true);
  });

  /** Mean alpha (0..1) of a strip between two heights. */
  const coverage = (index: number, v0: number, v1: number) => {
    const { width, height, data } = made.image;
    const r = made.regions[index]!;
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(v0 * height); y < Math.floor(v1 * height); y++) {
      for (let x = Math.ceil((r.x + r.w * 0.15) * width); x < (r.x + r.w * 0.85) * width; x++) {
        sum += data[(y * width + x) * 4 + 3]! / 255;
        n++;
      }
    }
    return sum / n;
  };

  it('strips have the coverage their job needs', () => {
    const at = (tag: string) => made.regions.findIndex((r) => r.tag === tag);
    // The scalp layer hides the skin, then fades out where a hairline falls.
    expect(coverage(at('base'), 0.05, 0.7)).toBeGreaterThan(0.97);
    expect(coverage(at('base'), 0.97, 1)).toBeLessThan(0.2);
    // Locks thin out to ragged tips; loose hairs are mostly air.
    expect(coverage(at('clump'), 0.05, 0.3)).toBeGreaterThan(coverage(at('clump'), 0.85, 1) + 0.15);
    expect(coverage(at('flyaway'), 0, 1)).toBeLessThan(0.3);
    expect(coverage(at('fringe'), 0.05, 0.5)).toBeGreaterThan(0.6);
  });

  it('never leaves dark colour under transparent texels', () => {
    const { data } = made.image;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) {
        expect(data[i]).toBe(Math.round(small.mid[0] * 0.8));
        expect(data[i + 2]).toBe(Math.round(small.mid[2] * 0.8));
      }
    }
  });
});

suite('the groom on the real head', () => {
  let assets: CoreAssets;
  let gen: HairGenerator;
  const atlas = atlasTemplate('strips8');
  beforeAll(async () => {
    assets = await loadAssets();
    gen = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
  });

  it('ships the generated atlases (Hair v2 strand atlases first, then Part 1 card atlases), each with every kind of strip', () => {
    const atlases = assets.catalog.hairAtlases ?? [];
    expect(atlases.filter((a) => a.strands).map((a) => a.id)).toEqual(['straightFine', 'straightCoarse', 'wavy', 'curly', 'stubble'].map((p) => `ps2cc:atlas/strands_${p}`));
    expect(atlases[0]!.atlas.greyscale).toBe(true);
    for (const a of atlases.filter((x) => x.strands)) expect(a.atlas.regions.some((r) => r.tag === 'lock'), a.id).toBe(true);
    expect(atlases.some((a) => a.id === 'ps2cc:atlas/cards_brown')).toBe(true);
    const generated = atlases.filter((a) => a.id.startsWith('ps2cc:atlas/cards_'));
    expect(generated.length).toBeGreaterThanOrEqual(5);
    for (const a of generated) for (const tag of ['clump', 'strand', 'base', 'fringe', 'flyaway']) expect(a.atlas.regions.some((r) => r.tag === tag), `${a.id} ${tag}`).toBe(true);
  });

  it('a style from before the groom existed loads with the defaults and still generates', () => {
    const old = starterStyle('bob') as unknown as Record<string, unknown>;
    delete old.groom;
    delete old.build;
    const style = sanitiseStyle(old);
    expect(style.build).toEqual(DEFAULT_CARD_BUILD);
    expect(style.groom.guides).toBeGreaterThan(0);
    const engine = new CharacterEngine(assets);
    expect(gen.generate(style, atlas, engine.positions, engine.skeleton).cards).toBeGreaterThan(50);
  });

  it('the engine completes a card style that lacks the newer settings', () => {
    const doc = defaultCharacter();
    const partial = starterStyle('bob') as unknown as Record<string, unknown>;
    delete partial.groom;
    partial.build = { tipTwist: 0.3 };
    doc.hair = { ...doc.hair, mode: 'cards', style: partial as never, atlas: null };
    const engine = new CharacterEngine(assets, doc);
    expect(engine.doc.hair.style!.build).toEqual({ ...DEFAULT_CARD_BUILD, tipTwist: 0.3 });
    expect(engine.doc.hair.style!.groom.guides).toBeGreaterThan(0);
    // A complete style is left alone (the same object: no churn on every edit).
    const complete = engine.doc.hair.style!;
    engine.update('rename', (d) => void (d.name = 'x'));
    expect(engine.doc.hair.style).toEqual(complete);
  });

  it('makes the asked number of guides, and a parting line on the scalp when the style has one', () => {
    const engine = new CharacterEngine(assets);
    const style = starterStyle('long-centre-part');
    const hair = gen.generate(style, atlas, engine.positions, engine.skeleton);
    expect(hair.guideCurves).toHaveLength(style.groom.guides);
    for (const g of hair.guideCurves) expect(g).toHaveLength(12);
    const parting = hair.parting!;
    expect(parting.length).toBeGreaterThan(8);
    // A centre parting runs front to back in the middle of the head.
    for (const p of parting) expect(Math.abs(p[0] - hair.volumeAxis.top[0])).toBeLessThan(0.002);
    expect(parting[0]![2]).toBeGreaterThan(parting[parting.length - 1]![2] + 0.08);
    expect(gen.generate(starterStyle('short-messy'), atlas, engine.positions, engine.skeleton).parting).toBeNull();
  });

  it('hairs fall away from the parting on their own side, and clumping pulls them together', () => {
    const engine = new CharacterEngine(assets);
    const style = starterStyle('long-centre-part');
    const tips = (s: typeof style) => {
      const hair = gen.generate(s, atlas, engine.positions, engine.skeleton);
      const out: { root: Vec3; tip: Vec3 }[] = [];
      for (let k = 0; k < hair.roots.length; k += 2) {
        const first = hair.roots[k]!;
        const next = k + 2 < hair.roots.length ? hair.roots[k + 2]! : hair.positions.length / 3;
        const at = (v: number): Vec3 => [hair.positions[v * 3]!, hair.positions[v * 3 + 1]!, hair.positions[v * 3 + 2]!];
        // The middle of the card's tip edge, not one of its corners.
        const [a, b] = [at(next - 2), at(next - 1)];
        out.push({ root: at(first), tip: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
      }
      return { hair, out };
    };
    const { hair, out } = tips(style);
    const x0 = hair.volumeAxis.top[0];
    let wrongSide = 0;
    for (const c of out) if (Math.abs(c.root[0] - x0) > 0.02 && Math.sign(c.root[0] - x0) !== Math.sign(c.tip[0] - x0)) wrongSide++;
    expect(wrongSide / out.length).toBeLessThan(0.03);

    // Mean distance from each card's tip to the nearest guide curve, with and without clumping:
    // the same roots, but tighter locks.
    const spread = (clump: number) => {
      const t = tips({ ...style, groom: { ...style.groom, clump, frizz: 0 }, cards: { ...style.cards, flyaway: 0 } }).out.map((c) => c.tip);
      return t.reduce((sum, p) => sum + Math.min(...hair.guideCurves.map((g) => closestOnPolyline(g, p).distance)), 0) / t.length;
    };
    expect(spread(0.9)).toBeLessThan(spread(0) * 0.6);
  });

  it('a hair that follows a guide from further round the head still hangs outside it', () => {
    // The bob once bulged at the back: hairs at the side took the shape of guides from behind and went through the neck.
    const engine = new CharacterEngine(assets);
    const hair = gen.generate({ ...starterStyle('bob-fringe'), groom: { ...starterStyle('bob-fringe').groom, guides: 8, interpolate: 1 } }, atlas, engine.positions, engine.skeleton);
    const axis = hair.volumeAxis.top;
    let worst = 0;
    for (let v = 0; v < hair.positions.length / 3; v++) {
      const y = hair.positions[v * 3 + 1]!;
      if (y > axis[1] - 0.05) continue;
      worst = Math.max(worst, Math.hypot(hair.positions[v * 3]! - axis[0], hair.positions[v * 3 + 2]! - axis[2]));
    }
    // Nothing below the skull stands further out than a head's radius plus a few centimetres.
    expect(worst).toBeLessThan(0.17);
  });
});
