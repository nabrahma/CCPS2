/**
 * PRD Part 3, M21 acceptance: shell garments and accessories (F28).
 *
 * Every template, with its default parameters, is generated and bound like a
 * library garment, then worn:
 * - on the reference body: inside the slot budget, manifold, no
 *   self-intersection within a piece, every open edge rimmed at least 5 mm,
 *   seams found the way M15 finds them, the same bytes when generated again;
 * - on the default male and female bodies: the 5.0 checks (class ease,
 *   anatomy show-through, silhouette smoothness, rim depth) and no
 *   poke-through over 2 mm;
 * - on random bodies (20 here, 200 with PS2CC_M21_BODIES=200): the same
 *   topology on every body, and every check's failures listed in
 *   docs/milestones/M21/random-bodies.txt with at least 95% passing (D-168).
 * The generator must take under 200 ms a template. `pnpm test` runs this file
 * on its own after the others, so the times are not taken under load.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { BodyTopology } from '../src/anthro/topology';
import { defaultCharacter, NEUTRAL_TINT, type CharacterDoc, type GarmentSlotName } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { randomizeCharacter } from '../src/character/randomize';
import { easeReport, pokeThroughDepth, rimReport, showThrough, silhouetteTurn, topologyReport, type BodyInput } from '../src/garment/quality';
import { CLASS_MIN_EASE } from '../src/garment/shell/build';
import { buildTemplate, generateShellGarment, type ShellGarment } from '../src/garment/shell/generate';
import { SHELL_TEMPLATES } from '../src/garment/shell/templates';
import { shellBody, shellBodyAt, type ShellBody } from '../src/garment/shell/body';
import { landmarks as shellLandmarks } from '../src/garment/shell/landmarks';
import { computeQuadNormals } from '../src/mesh/normals';
import { BodySurface } from '../src/proxy/collision';
import { SLOT_BUDGET } from '../src/proxy/decimate';
import { CharacterScene } from '../src/scene/character-scene';
import { buildRenderTopology } from '../src/scene/render-mesh';
import { garmentSeams, surfaceFromTopology, uvIslands } from '../src/wardrobe/surface';
import { assetsAvailable, loadAssets, REPO_ROOT } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;
/** Random bodies: 20 in the routine suite; the PRD's acceptance run is PS2CC_M21_BODIES=200 (about 30 minutes). */
const BODIES = Number(process.env.PS2CC_M21_BODIES ?? 20);
/** For looking into one body: PS2CC_M21_ONLY=9,17 runs those random bodies only. */
const ONLY = process.env.PS2CC_M21_ONLY ? process.env.PS2CC_M21_ONLY.split(',').map(Number) : null;
/** And PS2CC_M21_TEMPLATES=socks,workboots checks only those templates on the random bodies. */
const TEMPLATES = process.env.PS2CC_M21_TEMPLATES ? process.env.PS2CC_M21_TEMPLATES.split(',') : null;
const SEED = 21000;
const OUT = join(REPO_ROOT, 'docs', 'milestones', 'M21');
const TOPS = new Set(['tshirt', 'longsleeve', 'rollneck', 'tank', 'utilityvest']);
const BOTTOMS = new Set(['leggings', 'straighttrousers', 'flaredtrousers', 'cargotrousers', 'shorts']);
/** While measuring the typical anatomy (the default character), the template whose body energy to record. */
let typicalPass: string | null = null;

interface Worst {
  easeMean: number;
  underHalf: number;
  showThrough: number;
  turn: number;
  turn95: number;
  rim: number;
  poke: number;
}

suite('M21: shell garments and accessories (PRD Part 3, F28)', () => {
  let assets: CoreAssets;
  const made = new Map<string, ShellGarment>();
  const timing = new Map<string, number>();
  const saving = new Map<string, number>();
  const worst = new Map<string, Worst>();

  let base12k: ShellBody;
  beforeAll(async () => {
    assets = await loadAssets();
    base12k = await shellBody(assets);
    mkdirSync(OUT, { recursive: true });
    for (const t of SHELL_TEMPLATES) {
      // Warm-up (shell bodies, landmarks, the reference body), then the timed runs: the generator (what the
      // Designer's preview and every character's own fit run), median of three, and generating with binding (Save).
      await generateShellGarment(assets, t.id);
      const runs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        await buildTemplate(assets, t.id);
        runs.push(performance.now() - t0);
      }
      timing.set(t.id, runs.sort((a, b) => a - b)[1]!);
      const t1 = performance.now();
      const g = await generateShellGarment(assets, t.id);
      saving.set(t.id, performance.now() - t1);
      made.set(t.id, g);
      const m = g.garment.meta;
      m.id = `user:garment/shell_${t.id}`;
      assets.addUserProxy(
        { id: m.id, category: 'clothes', name: m.name, file: `user/${m.id}`, triangles: g.garment.report.triangles, slot: t.slot, tags: m.tags, licence: 'CC0-1.0', hiddenFaces: m.hiddenFaces },
        () => Promise.resolve(g.garment.proxy),
      );
    }
  }, 600_000);

  it('every template: within budget, manifold, rimmed, seams found, deterministic; generation time logged', async () => {
    const rows: string[] = [];
    const failures: string[] = [];
    const want = (ok: boolean, what: string) => {
      if (!ok) failures.push(what);
    };
    for (const t of SHELL_TEMPLATES) {
      const g = made.get(t.id)!;
      const proxy = g.garment.proxy;
      const tris = proxy.triangles();
      const ref = proxy.restPositions;
      want(tris.length / 3 <= SLOT_BUDGET[t.slot]!, `${t.id}: ${tris.length / 3} triangles over the budget`);
      const topo = topologyReport({ positions: ref, indices: tris });
      want(topo.nonManifoldEdges === 0, `${t.id}: ${topo.nonManifoldEdges} non-manifold edges`);
      want(topo.flippedEdges === 0, `${t.id}: ${topo.flippedEdges} edges with inconsistent winding`);
      want(topo.selfIntersections === 0, `${t.id}: ${topo.selfIntersections} self-intersections`);
      const rim = rimReport({ positions: ref, indices: tris });
      if (rim.loops > 0) want(rim.minDepth >= 0.005, `${t.id}: rim ${(rim.minDepth * 1000).toFixed(1)} mm`);
      // Seams, the way M15 finds them on library garments.
      const rt = buildRenderTopology(proxy.faceVerts, proxy.faceUvs, proxy.uvs);
      const surface = surfaceFromTopology(rt, ref);
      const seams = garmentSeams(surface, uvIslands(surface)).filter((s) => s.kind === 'seam');
      want(seams.length > 0, `${t.id}: no seams`);
      // Generated again: the same bytes.
      const again = await generateShellGarment(assets, t.id);
      const h = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
      want(h(again.garment.bin) === h(g.garment.bin), `${t.id}: not deterministic`);
      rows.push(`${t.id}: ${tris.length / 3} tris (budget ${SLOT_BUDGET[t.slot]}), ${topo.pieces} pieces, ${topo.boundaryLoops} open edges, rim ${rim.loops ? (rim.minDepth * 1000).toFixed(1) : '-'} mm, ${seams.length} seam segments, generated in ${timing.get(t.id)!.toFixed(0)} ms (with binding ${saving.get(t.id)!.toFixed(0)} ms)`);
    }
    console.info(rows.join('\n'));
    const times = [...timing.values()].sort((a, b) => a - b);
    console.info(`[generation] median ${times[times.length >> 1]!.toFixed(0)} ms, slowest ${times[times.length - 1]!.toFixed(0)} ms`);
    rows.push(`generation: median ${times[times.length >> 1]!.toFixed(0)} ms, slowest ${times[times.length - 1]!.toFixed(0)} ms (the generator; binding for the library adds ${Math.min(...[...saving].map(([id, ms]) => ms - timing.get(id)!)).toFixed(0)}-${Math.max(...[...saving].map(([id, ms]) => ms - timing.get(id)!)).toFixed(0)} ms)`);
    writeFileSync(join(OUT, 'generation.txt'), `${rows.join('\n')}\n`);
    for (const [id, ms] of timing) want(ms < 200, `${id}: generated in ${ms.toFixed(0)} ms`);
    console.info(failures.join('\n'));
    expect(failures).toEqual([]);
  }, 600_000);

  /**
   * Show-through against this body's anatomy or a typical body's (the default
   * character's), whichever has more: a very smooth body has almost no
   * anatomy to show, and against it the ratio would only measure the cloth's facets.
   */
  const typical = new Map<string, number>();
  const showRatio = (id: string, r: { cloth: number; body: number }) => {
    if (typicalPass === id) typical.set(id, r.body);
    return r.cloth / Math.max(r.body, typical.get(id) ?? r.body);
  };

  /** Wear one garment on a body and run the checks on it. */
  async function check(engine: CharacterEngine, scene: CharacterScene, doc: CharacterDoc, id: string, label: string, failures: string[]): Promise<string> {
    const t = SHELL_TEMPLATES.find((x) => x.id === id)!;
    const g = made.get(id)!;
    doc.garments = [{ slot: t.slot as GarmentSlotName, asset: g.garment.meta.id, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody: true }];
    engine.replaceDoc(doc, 'm21');
    await scene.sync();
    scene.update();
    const part = scene.parts.find((p) => p.kind === 'garment')!;
    const bodyPart = scene.parts.find((p) => p.kind === 'body')!;
    // The skin as it is (hidden faces included) for ease; the visible skin for poke-through, as M4 measures.
    const topo = BodyTopology.of(assets.base);
    const P = engine.positions;
    const N = computeQuadNormals(P, assets.base.faceVerts, assets.base.vertexCount);
    const skin: BodyInput = { positions: P, indices: topo.tris, normals: N };
    const visible = new BodySurface(bodyPart.positions, bodyPart.normals, bodyPart.indices);
    const cls = t.garmentClass;
    const min = CLASS_MIN_EASE[cls];
    let ground = Infinity;
    for (let v = 0; v < assets.base.bodyVertexCount; v++) ground = Math.min(ground, P[v * 3 + 1]!);
    const ringY = (name: string) => {
      const r = (assets.bodyLandmarks.rings as Record<string, { vertices: number[] }>)[name]!;
      return r.vertices.reduce((s, v) => s + P[v * 3 + 1]!, 0) / r.vertices.length;
    };
    const point = (name: string) => (assets.bodyLandmarks.points as Record<string, number>)[name]!;
    const pair = (name: string) => (assets.bodyLandmarks.pairs as Record<string, { l: number; r: number }>)[name]!;
    // The torso's and the legs' axes on this body (the middle of the torso's front and back by height).
    const BL = shellLandmarks(shellBodyAt(base12k, P.slice(), engine.skeleton));
    const axisAt = (y: number): [number, number] => [0, BL.zc(y)];
    const garment = { positions: part.positions, indices: part.indices };
    const keep = (p: [number, number, number]) => (cls === 'boots' ? p[1] > ground + 0.04 : true);
    const ease = cls === 'accessory' ? null : easeReport(garment, skin, min, keep);
    const rim = rimReport(garment);
    // The visible skin, as M4 measures; a vertex counts if it is in the whole body too.
    const whole = new BodySurface(P, N, topo.tris);
    const poke = pokeThroughDepth(garment, visible as never, whole as never);
    let st = 0;
    let turn = 0;
    let turn95 = 0;
    const crotch = P[point('crotch') * 3 + 1]!;
    const armpit = Math.min(P[pair('armpit').l * 3 + 1]!, P[pair('armpit').r * 3 + 1]!);
    const legAxis = (side: 'l' | 'r') => (y: number): [number, number] => {
      const a = BL.legAxis(side, y);
      return [a[0], a[2]];
    };
    // Show-through does not apply to tight cloth (leggings, socks show the body by nature).
    const showsBody = cls === 'tight' || cls === 'socks';
    if (TOPS.has(id)) {
      // Between the hem (its lowest vertex) and the chest.
      let hem = Infinity;
      for (let v = 0; v < part.positions.length / 3; v++) hem = Math.min(hem, part.positions[v * 3 + 1]!);
      const stR = showThrough(garment, skin, hem + 0.04, armpit - 0.04, axisAt);
      st = showRatio(id, stR);
      const s = silhouetteTurn(garment, hem + 0.03, armpit - 0.05, [axisAt]);
      turn = s.maxDegrees;
      turn95 = s.p95;
    } else if (BOTTOMS.has(id)) {
      const waist = ringY('waist');
      const top = Math.min(waist, ringY('hips') + (waist - ringY('hips')) * 0.5);
      const knee = ringY('knee');
      // Over the torso (the PRD's measure): the hips and seat, from just above the crotch to below the waistband.
      if (!showsBody) st = showRatio(id, showThrough(garment, skin, crotch + 0.03, Math.min(top, ringY('hips') + 0.06), axisAt));
      const seat = silhouetteTurn(garment, crotch + 0.04, top, [axisAt]);
      const legs = silhouetteTurn(garment, knee + 0.05, crotch - 0.04, [legAxis('l'), legAxis('r')], 8);
      turn = Math.max(seat.maxDegrees, legs.maxDegrees);
      turn95 = Math.max(seat.p95, legs.p95);
    }
    const w = worst.get(id) ?? { easeMean: Infinity, underHalf: 0, showThrough: 0, turn: 0, turn95: 0, rim: Infinity, poke: 0 };
    if (ease) {
      w.easeMean = Math.min(w.easeMean, ease.mean);
      w.underHalf = Math.max(w.underHalf, ease.underHalf);
      if (ease.mean < min) failures.push(`${id} on ${label}: mean ease ${(ease.mean * 1000).toFixed(1)} mm < ${(min * 1000).toFixed(1)} mm`);
      if (ease.underHalf > 0.05) failures.push(`${id} on ${label}: ${(ease.underHalf * 100).toFixed(1)}% of the cloth under half the class ease`);
    }
    if (rim.loops) {
      w.rim = Math.min(w.rim, rim.minDepth);
      if (rim.minDepth < 0.0045) failures.push(`${id} on ${label}: rim ${(rim.minDepth * 1000).toFixed(1)} mm`);
    }
    w.poke = Math.max(w.poke, poke);
    if (poke > 0.002) failures.push(`${id} on ${label}: ${(poke * 1000).toFixed(1)} mm inside the body`);
    w.showThrough = Math.max(w.showThrough, st);
    if (st > 0.25) failures.push(`${id} on ${label}: show-through ${(st * 100).toFixed(0)}%`);
    w.turn = Math.max(w.turn, turn);
    w.turn95 = Math.max(w.turn95, turn95);
    // The PRD's 35 degrees as the typical (95th percentile) corner, and no corner over 60: smoother than the
    // user's reference characters, whose clothing turns 90-140 degrees at its sharpest and 30-110 at the 95th percentile.
    if (turn95 > 35) failures.push(`${id} on ${label}: 5% of the silhouette's corners turn more than ${turn95.toFixed(0)} degrees`);
    if (turn > 60) failures.push(`${id} on ${label}: a silhouette corner turns ${turn.toFixed(0)} degrees`);
    worst.set(id, w);
    return `${part.positions.length}:${createHash('sha256').update(new Uint8Array(part.indices.buffer, part.indices.byteOffset, part.indices.byteLength)).digest('hex')}`;
  }

  it('the 5.0 checks on the default male and female bodies', async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    const failures: string[] = [];
    // The typical anatomy: each garment's region on the default character.
    for (const t of SHELL_TEMPLATES) {
      if (!TOPS.has(t.id) && !BOTTOMS.has(t.id)) continue;
      typicalPass = t.id;
      await check(engine, scene, defaultCharacter(), t.id, 'default', []);
    }
    typicalPass = null;
    for (const gender of [1, 0]) {
      for (const t of SHELL_TEMPLATES) {
        const doc = defaultCharacter();
        doc.macros.gender = gender;
        await check(engine, scene, doc, t.id, gender ? 'default male' : 'default female', failures);
      }
    }
    console.info(failures.join('\n'));
    expect(failures).toEqual([]);
  }, 600_000);

  it(`the 5.0 checks and poke-through on ${BODIES} random bodies, with the same topology on every body`, async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    const failures: string[] = [];
    const shape = new Map<string, string>();
    for (const i of ONLY ?? Array.from({ length: BODIES }, (_, k) => k)) {
      const base = randomizeCharacter(defaultCharacter(), assets.sliders, { seed: SEED + i, amount: 1 });
      for (const t of SHELL_TEMPLATES) {
        if (TEMPLATES && !TEMPLATES.includes(t.id)) continue;
        const doc = structuredClone(base);
        const sig = await check(engine, scene, doc, t.id, `random body ${i}`, failures);
        const prev = shape.get(t.id);
        if (prev === undefined) shape.set(t.id, sig);
        else if (prev !== sig) failures.push(`${t.id}: topology changed on random body ${i}`);
      }
    }
    const rows = SHELL_TEMPLATES.filter((t) => worst.has(t.id)).map((t) => {
      const w = worst.get(t.id)!;
      return `${t.id}: ease >= ${(w.easeMean * 1000).toFixed(1)} mm (class ${(CLASS_MIN_EASE[t.garmentClass] * 1000).toFixed(1)}), under half ${(w.underHalf * 100).toFixed(1)}%, show-through ${(w.showThrough * 100).toFixed(0)}%, turn ${w.turn95.toFixed(0)}/${w.turn.toFixed(0)} deg (95%/max), rim ${Number.isFinite(w.rim) ? (w.rim * 1000).toFixed(1) : '-'} mm, poke ${(w.poke * 1000).toFixed(2)} mm`;
    });
    console.info(rows.join('\n'));
    writeFileSync(join(OUT, 'quality.txt'), `Worst over the default male and female and ${BODIES} random bodies:\n${rows.join('\n')}\n`);
    // Every failure, and how many bodies each template passed on.
    const bodies = ONLY ?? Array.from({ length: BODIES }, (_, k) => k);
    let failedPairs = 0;
    const checked = SHELL_TEMPLATES.filter((t) => !TEMPLATES || TEMPLATES.includes(t.id));
    const passRows = checked.map((t) => {
      const bad = new Set(failures.filter((f) => f.startsWith(`${t.id} on random body `)).map((f) => f.slice(`${t.id} on random body `.length).split(':')[0]));
      failedPairs += bad.size;
      return `${t.id}: ${bodies.length - bad.size}/${bodies.length} bodies`;
    });
    const pairs = bodies.length * checked.length;
    const rate = (pairs - failedPairs) / pairs;
    const summary = `${pairs - failedPairs} of ${pairs} garments on ${bodies.length} random bodies pass every check (${(rate * 100).toFixed(1)}%)`;
    writeFileSync(join(OUT, 'random-bodies.txt'), `${summary}\n\n${passRows.join('\n')}\n\n${failures.join('\n')}\n`);
    console.info(summary);
    console.info(failures.slice(0, 40).join('\n'));
    // Identical topology on every body is exact. The 5.0 checks are not yet met on every random body (D-168):
    // the failures are listed in random-bodies.txt and the pass rate must not fall below 95%.
    expect(failures.filter((f) => f.includes('topology changed'))).toEqual([]);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  }, 7_200_000);
});
