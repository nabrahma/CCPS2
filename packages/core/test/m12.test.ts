/**
 * PRD M12 (Hair v2 and Hair Studio) acceptance, the parts that run without a browser:
 *  - each groom brush: Comb moves guide points along the stroke and keeps roots
 *    fixed; Puff lifts away from the scalp; Smooth reduces curvature; undo
 *    restores exactly; and the rest of the tool set does what it says;
 *  - the scalp layer's hairline has no step larger than 10% alpha between neighbouring texels;
 *  - every Hair v2 style is deterministic and inside its profile's budget;
 *  - the atlas baker's output is deterministic;
 *  - the gradient map, .ps2hair v2, the Creator's adjustments, locks and the authored groom.
 * The coverage test (skin inside the hair silhouette, ID buffer) and parity are in e2e/m12.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, wantsScalpLayer, withScalpLayer } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import {
  adjustStyle,
  applyDab,
  bakeStrandAtlas,
  boundaryLoops,
  browRoots,
  buildSurfaceCards,
  classifyLoop,
  colourizeHair,
  furRoots,
  loopLength,
  sanitiseFur,
  curvature,
  DEFAULT_BRUSH,
  drawScalpLayer,
  falloff,
  hairStyleFile,
  HAIR_LAYER_CARD,
  HAIR_LAYER_LOCK,
  HairGenerator,
  hashHair,
  parseHairStyleFile,
  sanitiseStyle,
  segmentLengths,
  STARTER_STYLES,
  starterStyle,
  styleForBudget,
  type BrushSettings,
  type GroomContext,
  type GroomCurve,
  type ScalpRoot,
} from '../src/hair';
import { QUALITY_PROFILES } from '../src/quality/profiles';
import { assetsAvailable, loadAssets } from './helpers';

type Vec3 = [number, number, number];

/**
 * A test head: a sphere of radius 0.1 at the origin, seen by an orthographic
 * camera on +Z (1 mm = 1 px, screen y down). Curve i's root normal is stored
 * by index in the root's `a`.
 */
function sphereContext(normals: Vec3[]): GroomContext {
  const S = 1000;
  const camZ = 1;
  const rootAt = (_p: Vec3): ScalpRoot => ({ a: normals.length, b: 0, c: 0, wa: 1, wb: 0, wc: 0, theta: 0, phi: 0 });
  return {
    project: (p) => ({ x: 500 + p[0] * S, y: 500 - p[1] * S, depth: camZ - p[2] }),
    unproject: (x, y, depth) => [(x - 500) / S, (500 - y) / S, camZ - depth],
    eye: [0, 0, camZ],
    rootNormal: (root) => normals[root.a] ?? [0, 0, 1],
    pick: (x, y) => {
      const px = (x - 500) / S;
      const py = (500 - y) / S;
      const z2 = 0.01 - px * px - py * py;
      if (z2 < 0) return null;
      const p: Vec3 = [px, py, Math.sqrt(z2)];
      const n: Vec3 = [p[0] / 0.1, p[1] / 0.1, p[2] / 0.1];
      normals.push(n);
      return { root: { ...rootAt(p), a: normals.length - 1 }, point: p, normal: n };
    },
    attach: (p) => {
      const l = Math.hypot(...p);
      const q: Vec3 = [(p[0] / l) * 0.1, (p[1] / l) * 0.1, (p[2] / l) * 0.1];
      const n: Vec3 = [q[0] / 0.1, q[1] / 0.1, q[2] / 0.1];
      normals.push(n);
      return { root: { ...rootAt(q), a: normals.length - 1 }, point: q, normal: n };
    },
    mirror: (p) => [-p[0], p[1], p[2]],
  };
}

/** A guide growing out of the sphere at polar angle `t` and azimuth `a` (radians), bending down. */
function guide(normals: Vec3[], t: number, a: number, wavy = 0): GroomCurve {
  const n: Vec3 = [Math.sin(t) * Math.sin(a), Math.cos(t), Math.sin(t) * Math.cos(a)];
  normals.push(n);
  const root: Vec3 = [n[0] * 0.1, n[1] * 0.1, n[2] * 0.1];
  const points: Vec3[] = [];
  for (let i = 0; i < 12; i++) {
    const s = i * 0.008;
    points.push([root[0] + n[0] * s * 0.3 + wavy * 0.006 * Math.sin(i * 1.7), root[1] + n[1] * s * 0.3 - s, root[2] + n[2] * s * 0.3 + 0.004]);
  }
  return { root: { a: normals.length - 1, b: 0, c: 0, wa: 1, wb: 0, wc: 0, theta: t, phi: a }, points };
}

const brush = (extra: Partial<BrushSettings> = {}): BrushSettings => ({ ...DEFAULT_BRUSH, symmetry: false, frontOnly: true, radius: 80, strength: 1, ...extra });

describe('groom brushes', () => {
  it('falloff is 1 at the centre, 0 at the radius, and smooth by default', () => {
    expect(falloff('smooth', 0, 10)).toBe(1);
    expect(falloff('smooth', 10, 10)).toBe(0);
    expect(falloff('linear', 5, 10)).toBeCloseTo(0.5);
    expect(falloff('constant', 9.9, 10)).toBe(1);
    expect(falloff('smooth', 5, 10)).toBeGreaterThan(falloff('linear', 5, 10));
  });

  it('Comb moves guide points along the stroke, keeps roots fixed and segment lengths', () => {
    const normals: Vec3[] = [];
    const ctx = sphereContext(normals);
    const c = guide(normals, 0.6, 0);
    const mid = ctx.project(c.points[6]!);
    // A stroke to the right (+x) over the middle of the curve.
    const [after] = applyDab([c], 'comb', brush(), ctx, { from: [mid.x, mid.y], to: [mid.x + 20, mid.y] });
    expect(after!.points[0]).toEqual(c.points[0]);
    const moved = after!.points.map((p, i) => p[0] - c.points[i]![0]);
    expect(Math.max(...moved)).toBeGreaterThan(0.004);
    // Along the stroke: points move right, none left.
    expect(Math.min(...moved)).toBeGreaterThanOrEqual(-1e-9);
    const before = segmentLengths(c.points);
    segmentLengths(after!.points).forEach((l, i) => expect(l).toBeCloseTo(before[i]!, 9));
  });

  it('Puff lifts the hair away from the scalp', () => {
    const normals: Vec3[] = [];
    const ctx = sphereContext(normals);
    const c = guide(normals, 0.5, 0);
    const lift = (pts: Vec3[]) => pts.reduce((s, p) => s + (Math.hypot(...p) - 0.1), 0);
    const mid = ctx.project(c.points[5]!);
    const [after] = applyDab([c], 'puff', brush(), ctx, { from: [mid.x, mid.y], to: [mid.x, mid.y] });
    expect(after!.points[0]).toEqual(c.points[0]);
    expect(lift(after!.points)).toBeGreaterThan(lift(c.points) + 0.01);
  });

  it('Smooth reduces curvature and keeps the root', () => {
    const normals: Vec3[] = [];
    const ctx = sphereContext(normals);
    const c = guide(normals, 0.5, 0, 1);
    const mid = ctx.project(c.points[6]!);
    let curves = [c];
    for (let i = 0; i < 4; i++) curves = applyDab(curves, 'smooth', brush({ radius: 200 }), ctx, { from: [mid.x, mid.y], to: [mid.x, mid.y] });
    expect(curves[0]!.points[0]).toEqual(c.points[0]);
    expect(curvature(curves[0]!.points)).toBeLessThan(curvature(c.points) * 0.7);
  });

  it('Grow and Shrink lengthen and shorten from the root; Snake Hook drags the tip', () => {
    const normals: Vec3[] = [];
    const ctx = sphereContext(normals);
    const c = guide(normals, 0.5, 0);
    const total = (pts: Vec3[]) => segmentLengths(pts).reduce((a, b) => a + b, 0);
    const at = ctx.project(c.points[6]!);
    const dab = { from: [at.x, at.y] as [number, number], to: [at.x, at.y] as [number, number] };
    const [grown] = applyDab([c], 'grow', brush(), ctx, dab);
    const [shrunk] = applyDab([c], 'shrink', brush(), ctx, dab);
    expect(total(grown!.points)).toBeGreaterThan(total(c.points) * 1.05);
    expect(total(shrunk!.points)).toBeLessThan(total(c.points) * 0.95);
    expect(grown!.points[0]).toEqual(c.points[0]);
    const tip = ctx.project(c.points[11]!);
    const [hooked] = applyDab([c], 'snakeHook', brush(), ctx, { from: [tip.x, tip.y], to: [tip.x + 30, tip.y] });
    expect(hooked!.points[11]![0] - c.points[11]![0]).toBeGreaterThan(0.02);
    expect(hooked!.points[0]).toEqual(c.points[0]);
  });

  it('Pinch draws curves together; Slide moves roots over the scalp; Delete removes; Add copies the shape around it', () => {
    const normals: Vec3[] = [];
    const ctx = sphereContext(normals);
    const a = guide(normals, 0.5, -0.25);
    const b = guide(normals, 0.5, 0.25);
    const gap = (cs: GroomCurve[]) => Math.abs(cs[0]!.points[8]![0] - cs[1]!.points[8]![0]);
    const centre = ctx.project([0, a.points[8]![1], 0.1]);
    let pinched = [a, b];
    for (let i = 0; i < 3; i++) pinched = applyDab(pinched, 'pinch', brush({ radius: 150 }), ctx, { from: [centre.x, centre.y], to: [centre.x, centre.y] });
    expect(gap(pinched)).toBeLessThan(gap([a, b]) * 0.8);

    const r = ctx.project(a.points[0]!);
    const [slid] = applyDab([a], 'slide', brush({ radius: 30 }), ctx, { from: [r.x, r.y], to: [r.x + 10, r.y] });
    expect(slid!.points[0]![0]).toBeGreaterThan(a.points[0]![0] + 0.003);
    expect(Math.hypot(...slid!.points[0]!)).toBeCloseTo(0.1, 6);

    expect(applyDab([a, b], 'delete', brush({ radius: 10 }), ctx, { from: [r.x, r.y], to: [r.x, r.y] })).toHaveLength(1);

    const added = applyDab([a, b], 'add', brush(), ctx, { from: [500, 500 - a.points[0]![1] * 1000], to: [500, 500 - a.points[0]![1] * 1000] });
    expect(added).toHaveLength(3);
    const fresh = added[2]!;
    expect(Math.hypot(...fresh.points[0]!)).toBeCloseTo(0.1, 6);
    // Its shape (offsets from its root) is the blend of its neighbours'.
    const drop = (c: GroomCurve) => c.points[11]![1] - c.points[0]![1];
    expect(drop(fresh)).toBeCloseTo((drop(a) + drop(b)) / 2, 3);
  });

  it('Selection limits other brushes; front-facing only skips curves facing away; X symmetry mirrors the dab', () => {
    const normals: Vec3[] = [];
    const ctx = sphereContext(normals);
    const a = guide(normals, 0.5, -0.4);
    const b = guide(normals, 0.5, 0.4);
    const back = guide(normals, 0.5, Math.PI);
    const ra = ctx.project(a.points[6]!);
    const sel = applyDab([a, b, back], 'select', brush({ radius: 40 }), ctx, { from: [ra.x, ra.y], to: [ra.x, ra.y] });
    expect(sel[0]!.selected).toBeGreaterThan(0);
    expect(sel[1]!.selected ?? 0).toBe(0);
    // A comb over both: only the selected one moves.
    const mid = ctx.project([0, a.points[6]![1], 0.1]);
    const combed = applyDab(sel, 'comb', brush({ radius: 400 }), ctx, { from: [mid.x, mid.y], to: [mid.x, mid.y + 20] });
    expect(combed[0]!.points[6]).not.toEqual(a.points[6]);
    expect(combed[1]!.points[6]).toEqual(b.points[6]);
    // The curve at the back faces away from the camera and is left alone.
    expect(combed[2]!.points[6]).toEqual(back.points[6]);

    // Symmetry: a comb outwards on the left also combs the right outwards, mirrored.
    const ma = ctx.project(a.points[6]!);
    const sym = applyDab([a, b], 'comb', brush({ symmetry: true, radius: 30 }), ctx, { from: [ma.x, ma.y], to: [ma.x - 15, ma.y] });
    const da = sym[0]!.points[6]![0] - a.points[6]![0];
    const db = sym[1]!.points[6]![0] - b.points[6]![0];
    expect(da).toBeLessThan(-0.002);
    expect(db).toBeCloseTo(-da, 6);
  });
});

describe('fur trims and card brows', () => {
  /** An open tube along Y: n segments round, two rings (y 0 and y 1). */
  function tube(n: number): { positions: number[]; normals: number[]; indices: number[] } {
    const positions: number[] = [];
    const normals: number[] = [];
    for (const y of [0, 1]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        positions.push(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05);
        normals.push(Math.cos(a), 0, Math.sin(a));
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(i, j, n + j, i, n + j, n + i);
    }
    return { positions, normals, indices };
  }

  it("finds a mesh's open edge loops and names them by the nearest joint", () => {
    const t = tube(16);
    const loops = boundaryLoops(t.indices);
    expect(loops).toHaveLength(2);
    expect(loops.every((l) => l.length === 16)).toBe(true);
    const joints = { neck: [0, 1, 0] as Vec3, wrists: [[0, 0, 0] as Vec3], ankles: [] };
    const kinds = loops.map((l) => classifyLoop(t.positions, l, joints)).sort();
    expect(kinds).toEqual(['collar', 'cuffs']);
  });

  it('grows the fixed number of fur cards round a loop, out of the surface, inside any budget', () => {
    const t = tube(16);
    const loops = boundaryLoops(t.indices);
    const fur = sanitiseFur({ enabled: true, edges: ['collar'], length: 0.03, density: 160 });
    const counts = loops.map((l) => Math.round(loopLength(t.positions, l) * fur.density));
    const roots = furRoots(t.positions, t.normals, loops, counts, fur, 5);
    expect(roots).toHaveLength(counts[0]! + counts[1]!);
    // Every card grows away from the tube's axis.
    for (const r of roots) expect(r.dir[0] * r.p[0] + r.dir[2] * r.p[2]).toBeGreaterThan(0);
    const cards = buildSurfaceCards(roots, [{ x: 0, y: 0, w: 1, h: 1, tag: 'clump' }], 'clump', 2, 5);
    expect(cards.triangleCount).toBe(roots.length * 4);
    // Deterministic.
    const again = buildSurfaceCards(furRoots(t.positions, t.normals, loops, counts, fur, 5), [{ x: 0, y: 0, w: 1, h: 1, tag: 'clump' }], 'clump', 2, 5);
    expect(Array.from(again.positions)).toEqual(Array.from(cards.positions));
    // Junk settings are clamped.
    expect(sanitiseFur({ length: 9, density: -1, edges: ['collar', 'nope'] })).toMatchObject({ length: 0.12, density: 20, edges: ['collar'] });
  });

  it('card brows grow from the inner end of the brow outwards', () => {
    // A flat strip of brow, x from 0.01 to 0.05 on the character's left, facing +Z.
    const positions = [0.01, 0, 0, 0.05, 0, 0, 0.05, 0.01, 0, 0.01, 0.01, 0];
    const roots = browRoots(positions, [0, 1, 2, 0, 2, 3], 0, { count: 40, length: 0.01 }, 3);
    expect(roots).toHaveLength(40);
    for (const r of roots) expect(r.dir[0]).toBeGreaterThan(0);
  });
});

describe('hair colour and atlas', () => {
  it('the atlas baker is deterministic, and a different seed gives a different atlas', () => {
    const a = bakeStrandAtlas('wavy', 256);
    const b = bakeStrandAtlas('wavy', 256);
    expect(Buffer.from(a.value.data).equals(Buffer.from(b.value.data))).toBe(true);
    expect(Buffer.from(a.flow.data).equals(Buffer.from(b.flow.data))).toBe(true);
    expect(a.regions).toEqual(b.regions);
    const c = bakeStrandAtlas('wavy', 256, 7);
    expect(Buffer.from(a.value.data).equals(Buffer.from(c.value.data))).toBe(false);
    // Locks are mostly opaque; flyaways mostly not.
    const cover = (tag: string) => {
      const r = a.regions.find((x) => x.tag === tag)!;
      let on = 0;
      let all = 0;
      for (let y = 0; y < 128; y++) for (let x = Math.ceil(r.x * 256); x < (r.x + r.w) * 256; x++, all++) if (a.value.data[(y * 256 + x) * 4 + 3]! > 128) on++;
      return on / all;
    };
    expect(cover('lock')).toBeGreaterThan(0.75);
    expect(cover('flyaway')).toBeLessThan(0.6);
  });

  it('one atlas serves every colour: value 0.5 is the colour itself, darker and lighter around it', () => {
    const grey = { width: 3, height: 1, data: new Uint8ClampedArray([64, 64, 64, 255, 128, 128, 128, 255, 230, 230, 230, 255]) };
    const regions = [{ x: 0, y: 0, w: 1, h: 1, tag: 'clump' as const }];
    const colour = { base: [0.6, 0.3, 0.1] as Vec3, rootDarken: 0, tipLighten: 0, streaks: 0, streakColour: [1, 1, 1] as Vec3, grey: 0 };
    const out = colourizeHair(grey, regions, colour).data;
    expect(out[4]).toBeCloseTo(153, -1);
    expect(out[5]).toBeCloseTo(77, -1);
    expect(out[0]!).toBeLessThan(out[4]!);
    expect(out[8]!).toBeGreaterThan(out[4]!);
    expect(out[3]).toBe(255);
  });
});

describe('Hair v2 styles and files', () => {
  it('.ps2hair v2 round-trips locks, the scalp layer, strands, a drawn parting and an authored groom; v1 files still load', () => {
    const s = sanitiseStyle({
      name: 'T',
      locks: { enabled: true, count: 40, width: 0.09 },
      scalpLayer: { enabled: true, softness: 0.3 },
      strands: 'curly',
      part: { side: 'center', position: 0, reach: 100, line: [0, 0.8, 0.1, 0, 0.84, 0, 0, 0.8, -0.1] },
      groom: { curves: [{ root: [1, 2, 3, 0.2, 0.3, 0.5], points: [0, 0, 0, 0, -0.01, 0.01, 0, -0.03, 0.01], lockWidth: 1.5 }] },
    });
    const back = parseHairStyleFile(JSON.parse(JSON.stringify(hairStyleFile(s))));
    expect(back).toEqual(s);
    expect(back.locks).toMatchObject({ enabled: true, count: 40, width: 0.09 });
    expect(back.groom.curves).toHaveLength(1);
    expect(back.part.reach).toBe(100);
    expect(hairStyleFile(s).format).toBe('ps2cc.hair/2');
    // A v1 file: no locks, no scalp layer, as it always looked.
    const v1 = parseHairStyleFile({ format: 'ps2cc.hair/1', style: { name: 'Old' } });
    expect(v1.locks.enabled).toBe(false);
    expect(v1.scalpLayer.enabled).toBe(false);
    // Junk guides are dropped, not trusted.
    expect(sanitiseStyle({ groom: { curves: [{ root: [1, 2], points: [0] }, { root: [0, 0, 0, 1, 0, 0], points: [0, 0, 0, NaN, 0, 0] }] } }).groom.curves).toBeUndefined();
  });

  it('the Creator adjustments scale length, volume and fringe on top of the style, and leave it alone at 1', () => {
    const s = starterStyle('bob');
    expect(adjustStyle(s, { length: 1, volume: 1, fringe: 1 })).toBe(s);
    const a = adjustStyle(s, { length: 1.5, volume: 2, fringe: 0.5 });
    expect(a.length.back).toBeCloseTo(s.length.back * 1.5);
    expect(a.length.front).toBeCloseTo(s.length.front * 0.75);
    expect(a.volume).toBeCloseTo(s.volume * 2);
    expect(s.length.back).toBe(starterStyle('bob').length.back);
  });

  it('the scalp layer is in the skin stack exactly when the hair wants one', () => {
    const doc = defaultCharacter('T');
    expect(wantsScalpLayer(doc)).toBe(false);
    withScalpLayer(doc);
    expect(doc.skin.layers.some((l) => l.kind === 'scalpHair')).toBe(false);
    doc.hair = { mode: 'cards', style: starterStyle('mara-bob'), atlas: null, colour: { base: [0.7, 0.6, 0.4], rootDarken: 0.3, tipLighten: 0.3, streaks: 0, streakColour: [1, 1, 1], grey: 0 }, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
    withScalpLayer(doc);
    expect(doc.skin.layers[0]!.kind).toBe('scalpHair');
    withScalpLayer(doc);
    expect(doc.skin.layers.filter((l) => l.kind === 'scalpHair')).toHaveLength(1);
    doc.hair.mode = 'none';
    withScalpLayer(doc);
    expect(doc.skin.layers.some((l) => l.kind === 'scalpHair')).toBe(false);
  });
});

const V2_STYLES = STARTER_STYLES.filter((s) => s.style.locks.enabled);

const suite = assetsAvailable ? describe : describe.skip;

suite('Hair v2 generation (needs assets)', () => {
  let assets: CoreAssets;
  let gen: HairGenerator;
  const ready = (async () => {
    assets = await loadAssets();
    gen = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
  })();

  it('ships Mara, Cole and six restyled presets as Hair v2 styles', async () => {
    await ready;
    expect(V2_STYLES.map((s) => s.id).sort()).toEqual(['bob', 'cole-curtain', 'long-straight', 'mara-bob', 'ponytail', 'short-messy', 'shoulder-straight', 'side-part']);
    for (const { id, style } of V2_STYLES) {
      expect(style.scalpLayer.enabled, id).toBe(true);
      // A cap over the crown only; the hairline is the scalp layer's.
      expect(style.shell.reach ?? 1, id).toBeLessThan(1);
    }
  });

  it('every Hair v2 style is deterministic and inside each profile budget, with locks under the cards', async () => {
    await ready;
    const engine = new CharacterEngine(assets);
    const regions = [
      { x: 0, y: 0, w: 0.3, h: 1, tag: 'lock' as const },
      { x: 0.3, y: 0, w: 0.3, h: 1, tag: 'clump' as const },
      { x: 0.6, y: 0, w: 0.2, h: 1, tag: 'strand' as const },
      { x: 0.8, y: 0, w: 0.2, h: 1, tag: 'fringe' as const },
    ];
    for (const { id, style } of V2_STYLES) {
      for (const profile of Object.values(QUALITY_PROFILES)) {
        const s = styleForBudget(style, profile.hairBudget);
        const a = gen.generate(s, regions, engine.positions, engine.skeleton);
        expect(a.triangleCount, `${id} ${profile.id}`).toBeLessThanOrEqual(profile.hairBudget);
        expect(a.triangleCount, `${id} ${profile.id}`).toBeGreaterThanOrEqual(s.budget[0]);
        expect(a.locks, `${id} ${profile.id}`).toBeGreaterThan(20);
        if (profile.id === 'enhanced') {
          const fresh = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
          expect(hashHair(fresh.generate(s, regions, engine.positions, engine.skeleton)), id).toBe(hashHair(a));
          // Locks are drawn before the cards (inner first), and every vertex says which layer it is in.
          const first = a.hairLayer.indexOf(HAIR_LAYER_CARD);
          expect(a.hairLayer.lastIndexOf(HAIR_LAYER_LOCK), id).toBeLessThan(first);
        }
      }
    }
  });

  it("the scalp layer's hairline has no step larger than 10% alpha between neighbouring texels", async () => {
    await ready;
    const map = assets.skinComposer.surface;
    const colour = { base: [0.4, 0.3, 0.2] as Vec3, rootDarken: 0.3, tipLighten: 0.2, streaks: 0, streakColour: [1, 1, 1] as Vec3, grey: 0 };
    for (const { id, style } of V2_STYLES) {
      const img = drawScalpLayer(map, gen.scalpField(style), style.scalpLayer, colour, style.seed);
      const N = map.size;
      let worst = 0;
      let painted = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = y * N + x;
          if (!map.coverage[t]) continue;
          const a = img.data[t * 4 + 3]! / 255;
          if (a > 0.5) painted++;
          // Neighbours on the same UV island (across an island's border the texels are not neighbours on the head).
          for (const u of [t + 1, t + N]) {
            if (x === N - 1 && u === t + 1) continue;
            if (u >= N * N || !map.coverage[u] || map.island[u] !== map.island[t]) continue;
            worst = Math.max(worst, Math.abs(img.data[u * 4 + 3]! / 255 - a));
          }
        }
      }
      expect(painted, id).toBeGreaterThan(2000);
      expect(worst, id).toBeLessThanOrEqual(0.1);
    }
  });

  it('an authored groom round-trips through the neutral head and drives generation', async () => {
    await ready;
    const engine = new CharacterEngine(assets);
    const style = starterStyle('cole-curtain');
    const regions = [{ x: 0, y: 0, w: 1, h: 1, tag: 'lock' as const }];
    const hair = gen.generate(style, regions, engine.positions, engine.skeleton);
    const curves = hair.guideRoots.map((root, i) => gen.authoredGuide(root, hair.guideCurves[i]!, engine.positions));
    const authored = { ...style, groom: { ...style.groom, curves } };
    const again = gen.generate(authored, regions, engine.positions, engine.skeleton);
    expect(again.guideCurves).toHaveLength(hair.guideCurves.length);
    // The same guides come back on the same body, to within 2.5 mm (points are pushed out of the head again).
    let worst = 0;
    again.guideCurves.forEach((g, i) => g.forEach((p, k) => (worst = Math.max(worst, Math.hypot(p[0] - hair.guideCurves[i]![k]![0], p[1] - hair.guideCurves[i]![k]![1], p[2] - hair.guideCurves[i]![k]![2])))));
    expect(worst).toBeLessThan(0.0025);
    expect(again.triangleCount).toBe(hair.triangleCount);
  });

  it('undo restores a groom stroke exactly', async () => {
    await ready;
    const doc = defaultCharacter('Groom');
    doc.hair = { mode: 'cards', style: starterStyle('mara-bob'), atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
    const engine = new CharacterEngine(assets, doc);
    const before = JSON.stringify(engine.doc);
    const style = engine.doc.hair.style!;
    const hair = gen.generate(style, [{ x: 0, y: 0, w: 1, h: 1, tag: 'lock' }], engine.positions, engine.skeleton);
    const curves = hair.guideRoots.map((root, i) => gen.authoredGuide(root, hair.guideCurves[i]!.map((p) => [p[0] + 0.01, p[1], p[2]]), engine.positions));
    engine.update('Comb', (d) => void (d.hair.style = { ...d.hair.style!, groom: { ...d.hair.style!.groom, curves } }));
    expect(JSON.stringify(engine.doc)).not.toBe(before);
    engine.undo();
    expect(JSON.stringify(engine.doc)).toBe(before);
  });
});
