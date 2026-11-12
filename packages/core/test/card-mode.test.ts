/**
 * Hair Studio's card mode (D-114): one curve is one card, as in the "Hair
 * cards from curves" workflow where the artist places every curve.
 *  - the hair on screen converts to hand-placed cards and comes back the same;
 *  - moving one card's curve moves that card and nothing else;
 *  - generation stays deterministic and inside the profile's budget;
 *  - hand-placed cards survive files, sanitising and the Creator's adjustments.
 */
import { describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import {
  adjustStyle,
  drawnCurve,
  HairGenerator,
  hairStyleFile,
  hashHair,
  nearestCard,
  parseHairStyleFile,
  sanitiseStyle,
  starterStyle,
  styleForBudget,
  type AtlasRegion,
  type AuthoredCard,
  type GroomCurve,
  type HairStyleParams,
  type ScalpRoot,
} from '../src/hair';
import { CharacterEngine } from '../src/character/engine';
import { assetsAvailable, loadAssets } from './helpers';

type Vec3 = [number, number, number];

const REGIONS: AtlasRegion[] = [
  { x: 0, y: 0, w: 0.25, h: 1, tag: 'lock' },
  { x: 0.25, y: 0, w: 0.25, h: 1, tag: 'clump' },
  { x: 0.5, y: 0, w: 0.25, h: 1, tag: 'strand' },
  { x: 0.75, y: 0, w: 0.25, h: 1, tag: 'fringe' },
];

const root = { a: 0, b: 1, c: 2, wa: 1, wb: 0, wc: 0, theta: 0, phi: 0 } as ScalpRoot;

describe('card mode: data and brushes', () => {
  const card: AuthoredCard = { root: [10, 11, 12, 0.2, 0.3, 0.5], points: [0, 0, 0, 0, -0.01, 0.002, 0, -0.03, 0.004], kind: 'lock', width: 0.06, tag: 'lock', region: 2, layer: 0.2, twist: 0.4, flip: true, random: 0.3 };

  it('hand-placed cards survive a .ps2hair file and are sanitised', () => {
    const style = { ...starterStyle('mara-bob') };
    style.groom = { ...style.groom, cards: [card] };
    const back = parseHairStyleFile(JSON.parse(JSON.stringify(hairStyleFile(style))));
    expect(back.groom.cards).toEqual([card]);
    const bad = sanitiseStyle({
      ...style,
      groom: { ...style.groom, cards: [{ ...card, width: 9, twist: -5, tag: 'nonsense', kind: 'blob' }, { root: [1, 2], points: [0] }, 'x'] },
    } as unknown);
    expect(bad.groom.cards).toHaveLength(1);
    expect(bad.groom.cards![0]).toMatchObject({ width: 0.2, twist: -1, tag: 'clump', kind: 'card' });
  });

  it("the Creator's length scales hand-placed cards from their roots", () => {
    const style = { ...starterStyle('mara-bob') };
    style.groom = { ...style.groom, cards: [card] };
    const longer = adjustStyle(style, { length: 1.5, volume: 1, fringe: 1 });
    expect(longer.groom.cards![0]!.points[7]).toBeCloseTo(-0.045, 9);
    expect(style.groom.cards![0]!.points[7]).toBe(-0.03);
  });

  it('a drawn path becomes an evenly spaced curve; a click is not a card', () => {
    const path: Vec3[] = Array.from({ length: 30 }, (_, i) => [0, -0.002 * i, 0.0005 * i * i * 0.05]);
    const c = drawnCurve(path)!;
    expect(c).toHaveLength(12);
    expect(c[0]).toEqual(path[0]);
    const seg = c.slice(1).map((p, i) => Math.hypot(p[0] - c[i]![0], p[1] - c[i]![1], p[2] - c[i]![2]));
    expect(Math.max(...seg) / Math.min(...seg)).toBeLessThan(1.15);
    expect(drawnCurve([[0, 0, 0], [0, 0.001, 0]])).toBeNull();
  });

  it('a new card takes the settings of the nearest card', () => {
    const settings = (kind: 'lock' | 'card', width: number) => ({ kind, width, tag: kind === 'lock' ? 'lock' : 'fringe', region: 1, flip: false, twist: 0, layer: 0.5, random: 0.5 }) as const;
    const curves: GroomCurve[] = [
      { root, points: [[0, 0, 0], [0, -0.01, 0]], card: settings('lock', 0.07) },
      { root, points: [[0.05, 0, 0], [0.05, -0.01, 0]], card: settings('card', 0.02) },
    ];
    expect(nearestCard(curves, [0.04, 0, 0])).toMatchObject({ kind: 'card', width: 0.02, tag: 'fringe' });
    expect(nearestCard(curves, [0.01, 0, 0])).toMatchObject({ kind: 'lock', width: 0.07 });
    expect(nearestCard([{ root, points: [[0, 0, 0]] }], [0, 0, 0])).toBeUndefined();
  });
});

const suite = assetsAvailable ? describe : describe.skip;

suite('card mode: generation (needs assets)', () => {
  let assets: CoreAssets;
  let gen: HairGenerator;
  const ready = (async () => {
    assets = await loadAssets();
    gen = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
  })();

  /** A style's hair turned into hand-placed cards, as Hair Studio's "Edit cards directly" does. */
  const toCards = (style: HairStyleParams, engine: CharacterEngine) => {
    const hair = gen.generate(style, REGIONS, engine.positions, engine.skeleton);
    const cards = hair.cardCurves.map(({ culled: _c, ...c }) => gen.authoredCard(c, engine.positions));
    return { hair, placed: { ...style, groom: { ...style.groom, cards } } as HairStyleParams };
  };

  const vertex = (P: Float32Array, v: number): Vec3 => [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
  const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('the hair on screen becomes hand-placed cards, and the cards build the same hair', async () => {
    await ready;
    const engine = new CharacterEngine(assets);
    for (const id of ['cole-curtain', 'mara-bob', 'long-straight']) {
      const { hair, placed } = toCards(starterStyle(id), engine);
      expect(placed.groom.cards!.length, id).toBe(hair.locks + hair.cards);
      const again = gen.generate(placed, REGIONS, engine.positions, engine.skeleton);
      expect(again.locks, id).toBe(hair.locks);
      expect(again.cards, id).toBe(hair.cards);
      expect(again.cardCurves.some((c) => c.culled), id).toBe(false);
      // Card for card: root corners within 5 mm (a wide lock's corner swings a little when its segments follow its own
      // length), triangles within 10%.
      expect(again.roots.length, id).toBe(hair.roots.length);
      let worst = 0;
      for (let i = 0; i < hair.roots.length; i++) worst = Math.max(worst, gap(vertex(hair.positions, hair.roots[i]!), vertex(again.positions, again.roots[i]!)));
      expect(worst, id).toBeLessThan(0.005);
      expect(Math.abs(again.triangleCount - hair.triangleCount) / hair.triangleCount, id).toBeLessThan(0.1);
      // The settings each card came with go back out unchanged.
      again.cardCurves.forEach((c, i) => {
        const was = hair.cardCurves[i]!;
        expect([c.kind, c.tag, c.region, c.flip], id).toEqual([was.kind, was.tag, was.region, was.flip]);
        expect(c.width, id).toBeCloseTo(was.width, 5);
      });
    }
  });

  it('one curve is one card: moving a card moves it and nothing else', async () => {
    await ready;
    const engine = new CharacterEngine(assets);
    const { placed } = toCards(starterStyle('cole-curtain'), engine);
    const before = gen.generate(placed, REGIONS, engine.positions, engine.skeleton);
    const k = placed.groom.cards!.findIndex((c) => c.kind === 'card');
    const cards = placed.groom.cards!.map((c, i) => (i === k ? { ...c, points: c.points.map((v, j) => (j >= 3 && j % 3 === 0 ? v + 0.02 * (j / c.points.length) : v)) } : c));
    const after = gen.generate({ ...placed, groom: { ...placed.groom, cards } }, REGIONS, engine.positions, engine.skeleton);
    expect(after.positions.length).toBe(before.positions.length);
    // The moved card's vertices: from its first root vertex to the next card's.
    const order = before.roots.length / 2;
    const index = before.locks + placed.groom.cards!.slice(0, k).filter((c) => c.kind === 'card').length;
    expect(index).toBeLessThan(order);
    const first = before.roots[index * 2]!;
    const end = index + 1 < order ? before.roots[(index + 1) * 2]! : before.positions.length / 3;
    let moved = 0;
    for (let v = 0; v < before.positions.length / 3; v++) {
      const d = gap(vertex(before.positions, v), vertex(after.positions, v));
      if (v >= first && v < end) moved = Math.max(moved, d);
      else expect(d).toBe(0);
    }
    expect(moved).toBeGreaterThan(0.005);
  });

  it('card mode is deterministic and fits every profile budget', async () => {
    await ready;
    const engine = new CharacterEngine(assets);
    // Converted on the Hero profile, the most cards there are; then seen on every profile.
    const { placed } = toCards(styleForBudget(starterStyle('mara-bob'), 9000), engine);
    const own = { ...placed, budget: starterStyle('mara-bob').budget } as HairStyleParams;
    for (const budget of [3500, 6000, 9000]) {
      const style = styleForBudget(own, budget);
      const a = gen.generate(style, REGIONS, engine.positions, engine.skeleton);
      const b = gen.generate(style, REGIONS, engine.positions, engine.skeleton);
      expect(hashHair(a)).toBe(hashHair(b));
      expect(a.triangleCount, `budget ${budget}`).toBeLessThanOrEqual(style.budget[1]);
      // Every card stays editable, the ones left out of this profile's mesh too.
      expect(a.cardCurves).toHaveLength(own.groom.cards!.length);
      expect(a.cardCurves.filter((c) => !c.culled).length).toBe(a.locks + a.cards);
      if (budget === 3500) expect(a.cardCurves.some((c) => c.culled)).toBe(true);
    }
  });
});
