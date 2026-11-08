/**
 * PRD M8 acceptance on the engine side, on the exported meshes of several
 * characters (all three PS2 body tiers):
 *  - every default blendshape is baked onto every mesh it moves (head, eyes
 *    atlas with brows/lashes/teeth, hair);
 *  - blink closes the eyelids fully: from 12 view directions (41 x 41 rays
 *    each), no ray reaches the eyeball before the eyelid skin, while at rest
 *    the eye is visible (blinks are calibrated per character, blink.ts);
 *  - with the eye closed, the blink has not pushed any lash into the eyeball
 *    where it could be seen (MakeHuman's lash roots already sit inside its
 *    low-poly eye shell at rest, behind the lid; those are the baseline).
 *    Lash crossings part-way through the blink are reported;
 *  - jawOpen opens the mouth without tearing: vertices that coincide at rest
 *    (UV seams, the head/body split) move together, no edge stretches like a
 *    tear, and the lower teeth follow the jaw. MakeHuman's JawDrop folds a few
 *    small triangles at the lips on its own full mesh too; folds are reported
 *    and must stay at the lips (within 12 mm of the mouth opening) and small.
 * Figures go to docs/milestones/M8/expression_report.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { DEFAULT_EXPRESSIONS, defaultCharacter, type BodyMeshId, type CharacterDoc } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { randomizeCharacter } from '../src/character/randomize';
import { buildExportScene, type ExportMesh } from '../src/export';
import { expressionNames } from '../src/expression/map';
import { TriangleBVH } from '../src/mesh/bvh';
import { eyeVisibility, eyeballOf, lashCrossings, pointVisible } from '../src/expression/blink';
import { FaceRig, skinDeltas } from '../src/expression/facerig';
import { CharacterScene, type PartShape, type ScenePart } from '../src/scene/character-scene';
import { createImage } from '../src/skin/image';
import { starterStyle } from '../src/hair';
import { REPO_ROOT, assetsAvailable, loadAssets } from './helpers';

const skin = createImage(2048, 2048, [200, 160, 140, 255]);
const loadImage = async () => createImage(64, 64, [180, 180, 180, 200]);

interface Case {
  label: string;
  doc: CharacterDoc;
}

function cases(assets: CoreAssets): Case[] {
  const tiers: BodyMeshId[] = ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k'];
  const out: Case[] = [];
  const male = defaultCharacter('Male');
  male.macros.gender = 1;
  const female = defaultCharacter('Female');
  female.macros.gender = 0;
  female.hair = { mode: 'cards', style: starterStyle('long-straight'), atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
  out.push({ label: 'male-8k', doc: male }, { label: 'female-cards-10k', doc: { ...female, bodyMesh: 'ps2_body_10k' } });
  for (let i = 0; i < 4; i++) {
    const doc = randomizeCharacter(defaultCharacter(`Random ${i}`), assets.sliders, { seed: 8800 + i, amount: 1 });
    doc.bodyMesh = tiers[i % 3]!;
    out.push({ label: `random-${i}-${doc.bodyMesh.replace('ps2_body_', '')}`, doc });
  }
  // Teeth, so the jaw test sees the lower teeth follow (the default character has none).
  for (const c of out) c.doc.teeth = { asset: 'mh:teeth/teeth_base' };
  return out;
}

async function sceneOf(assets: CoreAssets, doc: CharacterDoc): Promise<CharacterScene> {
  const scene = new CharacterScene(new CharacterEngine(assets, doc));
  await scene.sync();
  await scene.prepareExpressions();
  faceCache.set(scene, await assets.faceAssets());
  return scene;
}

function posed(part: ScenePart, shape: PartShape | undefined, w: number): Float32Array {
  const out = part.positions.slice();
  if (shape) for (let i = 0; i < out.length; i++) out[i] = out[i]! + w * shape.deltas[i]!;
  return out;
}

/**
 * Triangles of the PS2 head that jawOpen turns over (folds), how far they are
 * from the nearest mouth corner, and the same count on MakeHuman's full mesh.
 */
function mouthFolds(
  scene: CharacterScene,
  assets: CoreAssets,
  regions: { names: string[]; ids: Uint8Array },
): { count: number; area: number; farthest: number; makehuman: number; stretch: number; stretchAll: number } {
  const body = scene.parts.find((p) => p.kind === 'body')!;
  const d = scene.expressionShapes('jawOpen')!.get('body')!.deltas;
  const P = body.positions;
  // The mouth opening rim: PS2 region 'opening' below the eyes.
  const opening = regions.names.indexOf('opening');
  const eyesY = scene.parts.find((p) => p.kind === 'eyes')!.positions[1]!;
  const rim: number[][] = [];
  for (let v = 0; v < P.length / 3; v++) {
    if (regions.ids[v] === opening && P[v * 3 + 1]! < eyesY - 0.04) rim.push([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!]);
  }
  const cross = (a: number[], b: number[], c: number[]) => {
    const u = [0, 1, 2].map((k) => b[k]! - a[k]!);
    const w = [0, 1, 2].map((k) => c[k]! - a[k]!);
    return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
  };
  const flips = (pos: ArrayLike<number>, delta: ArrayLike<number>, tris: number[][]) => {
    const out: { area: number; centre: number[] }[] = [];
    for (const t of tris) {
      const r = t.map((v) => [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!]);
      const q = t.map((v) => [pos[v * 3]! + delta[v * 3]!, pos[v * 3 + 1]! + delta[v * 3 + 1]!, pos[v * 3 + 2]! + delta[v * 3 + 2]!]);
      const a = cross(r[0]!, r[1]!, r[2]!);
      const b = cross(q[0]!, q[1]!, q[2]!);
      if (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! < 0) {
        out.push({ area: Math.hypot(...a) / 2, centre: [0, 1, 2].map((k) => (r[0]![k]! + r[1]![k]! + r[2]![k]!) / 3) });
      }
    }
    return out;
  };
  const tris: number[][] = [];
  for (let t = 0; t < body.indices.length; t += 3) tris.push([body.indices[t]!, body.indices[t + 1]!, body.indices[t + 2]!]);
  const ours = flips(P, d, tris);
  let farthest = 0;
  for (const f of ours) farthest = Math.max(farthest, Math.min(...rim.map((c) => Math.hypot(...[0, 1, 2].map((k) => f.centre[k]! - c[k]!)))));
  // MakeHuman's own full-density mesh with its own JawDrop pose.
  const engine = scene.engine;
  const base = engine.positions;
  const b = assets.base;
  const hm: number[][] = [];
  for (const f of b.facesWhere((g) => g === 'body')) {
    const q = [b.faceVerts[f * 4]!, b.faceVerts[f * 4 + 1]!, b.faceVerts[f * 4 + 2]!, b.faceVerts[f * 4 + 3]!];
    hm.push([q[0]!, q[1]!, q[2]!]);
    if (q[3] !== q[2]) hm.push([q[0]!, q[2]!, q[3]!]);
  }
  // Edge stretch: edges with both ends on the mouth opening rim span the parting lips (that is the
  // mouth opening, not a tear); edges under 1 mm at rest are the closed lip corners.
  let stretch = 0;
  let stretchAll = 0;
  for (let t = 0; t < body.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = body.indices[t + e]!;
      const c = body.indices[t + ((e + 1) % 3)]!;
      const lr = Math.hypot(P[a * 3]! - P[c * 3]!, P[a * 3 + 1]! - P[c * 3 + 1]!, P[a * 3 + 2]! - P[c * 3 + 2]!);
      if (lr < 1e-3) continue;
      const lp = Math.hypot(...[0, 1, 2].map((k) => P[a * 3 + k]! + d[a * 3 + k]! - P[c * 3 + k]! - d[c * 3 + k]!));
      stretchAll = Math.max(stretchAll, lp / lr);
      if (!(regions.ids[a] === opening && regions.ids[c] === opening)) stretch = Math.max(stretch, lp / lr);
    }
  }
  return { count: ours.length, area: ours.reduce((s, f) => s + f.area, 0), farthest, makehuman: flips(base, jawDropDelta(scene, base), hm).length, stretch, stretchAll };
}

function jawDropDelta(scene: CharacterScene, base: Float32Array): Float32Array {
  const face = faceCache.get(scene)!;
  const skin = face.rig.skinMatrices(face.rig.heads(base), face.units.blend([['JawDrop', 1]]));
  return skinDeltas(base, face.rig.weights, skin, FaceRig.moving(skin));
}

const faceCache = new Map<CharacterScene, Awaited<ReturnType<CoreAssets['faceAssets']>>>();

function denseShape(m: ExportMesh, name: string): Float32Array | null {
  const s = m.shapes.find((x) => x.name === name);
  if (!s) return null;
  const out = new Float32Array(m.positions.length);
  s.indices.forEach((v, i) => out.set(s.deltas.subarray(i * 3, i * 3 + 3), v * 3));
  return out;
}

describe.skipIf(!assetsAvailable)('expression blendshapes (M8 acceptance)', () => {
  let assets: CoreAssets;
  const report: Record<string, unknown>[] = [];
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('bakes the default set onto every mesh each blendshape moves', async () => {
    const { doc } = cases(assets)[1]!;
    const scene = await sceneOf(assets, doc);
    const ex = await buildExportScene(scene, { loadImage, skin, appVersion: 'test' });
    const byRole = (r: string) => ex.meshes.find((m) => m.role === r)!;
    const head = byRole('head');
    const eyes = byRole('eyes');
    for (const n of DEFAULT_EXPRESSIONS) expect(head.shapes.map((s) => s.name), `head ${n}`).toContain(n);
    for (const n of ['blink_L', 'blink_R', 'browsUp', 'browsDown', 'jawOpen']) expect(eyes.shapes.map((s) => s.name), `eyes ${n}`).toContain(n);
    // Every listed shape really moves its mesh, and indices are sorted and in range.
    for (const m of ex.meshes) {
      for (const s of m.shapes) {
        expect(s.indices.length, `${m.name}/${s.name}`).toBeGreaterThan(0);
        for (let i = 1; i < s.indices.length; i++) expect(s.indices[i]!).toBeGreaterThan(s.indices[i - 1]!);
        expect(s.indices[s.indices.length - 1]!).toBeLessThan(m.positions.length / 3);
      }
    }
    expect(ex.sidecar.blendshapes).toEqual(DEFAULT_EXPRESSIONS.filter((n) => expressionNames().includes(n)));
    // The neutral export is untouched by a viewport preview.
    await scene.setExpressionPreview({ jawOpen: 1 });
    const again = await buildExportScene(scene, { loadImage, skin, appVersion: 'test' });
    expect(Array.from(again.meshes[0]!.positions)).toEqual(Array.from(head.positions));
  });

  it('blink closes the eyelids fully, and lashes stay out of the eyeball', async () => {
    for (const { label, doc } of cases(assets)) {
      const scene = await sceneOf(assets, doc);
      const body = scene.parts.find((p) => p.kind === 'body')!;
      const eyes = scene.parts.find((p) => p.kind === 'eyes')!;

      const lashes = scene.parts.find((p) => p.kind === 'eyelashes')!;
      const row: Record<string, unknown> = { character: label };
      for (const [name, side] of [['blink_L', 1], ['blink_R', -1]] as const) {
        const shapes = scene.expressionShapes(name)!;
        const ball = eyeballOf(eyes.positions, eyes.indices, side)!;
        const other = eyeballOf(eyes.positions, eyes.indices, -side)!;
        const closedBody = posed(body, shapes.get('body'), 1);
        const eyePos = posed(eyes, shapes.get('eyes'), 1);
        const rest = eyeVisibility(body.positions, body.indices, eyes.positions, ball);
        const closed = eyeVisibility(closedBody, body.indices, eyePos, ball);
        const otherOpen = eyeVisibility(closedBody, body.indices, eyePos, other);
        // Lash crossings the blink adds (rest crossings are MakeHuman's own), and the visible ones.
        const restCross = lashCrossings(lashes.positions, lashes.indices, eyes.positions, ball);
        const added: Record<string, { added: number; visible: number }> = {};
        for (const w of [0.25, 0.5, 0.75, 1]) {
          const skinW = posed(body, shapes.get('body'), w);
          const eyeW = posed(eyes, shapes.get('eyes'), w);
          const cross = lashCrossings(posed(lashes, shapes.get('eyelashes'), w), lashes.indices, eyeW, ball);
          let n = 0;
          let visible = 0;
          const skinBvh = new TriangleBVH(skinW, body.indices);
          const eyeBvh = new TriangleBVH(eyeW, ball.triangles);
          for (const [key, point] of cross) {
            if (restCross.has(key)) continue;
            n++;
            if (pointVisible(point, skinBvh, eyeBvh)) visible++;
          }
          added[String(w)] = { added: n, visible };
        }
        const cal = scene.expressionCalibration(name);
        row[name] = {
          upperLidWeight: cal?.weight,
          restVisibleRays: rest.visible,
          closedVisibleRays: closed.visible,
          otherEyeVisibleRays: otherOpen.visible,
          raysOnEyeball: closed.onEyeball,
          lashCrossingsAtRest: restCross.size,
          lashCrossingsAddedByWeight: added,
        };
        expect(rest.visible, `${label} ${name}: eye visible at rest`).toBeGreaterThan(100);
        expect(otherOpen.visible, `${label} ${name}: other eye stays open`).toBeGreaterThan(100);
        expect(closed.visible, `${label} ${name}: eyeball seen through the closed lids (upper lid weight ${cal?.weight}, calibration saw ${cal?.visibleRays})`).toBe(0);
        expect(added['1']!.visible, `${label} ${name}: lashes visibly inside the eyeball when closed`).toBe(0);
      }
      report.push(row);
    }
  });

  it('jawOpen opens the mouth without tearing', async () => {
    for (const { label, doc } of cases(assets)) {
      const scene = await sceneOf(assets, doc);
      const ex = await buildExportScene(scene, { loadImage, skin, appVersion: 'test' });
      const head = ex.meshes.find((m) => m.role === 'head')!;
      const bodyMesh = ex.meshes.find((m) => m.role === 'body')!;
      const dh = denseShape(head, 'jawOpen')!;
      const db = denseShape(bodyMesh, 'jawOpen') ?? new Float32Array(bodyMesh.positions.length);
      // Vertices that coincide at rest move together (UV seams, head/body split).
      const at = new Map<string, number[]>();
      let seam = 0;
      const key = (p: Float32Array, i: number) => `${p[i * 3]!.toFixed(6)},${p[i * 3 + 1]!.toFixed(6)},${p[i * 3 + 2]!.toFixed(6)}`;
      for (const [m, d] of [[head, dh], [bodyMesh, db]] as const) {
        for (let i = 0; i < m.positions.length / 3; i++) {
          const k = key(m.positions, i);
          const prev = at.get(k);
          const mine = [d[i * 3]!, d[i * 3 + 1]!, d[i * 3 + 2]!];
          if (prev) seam = Math.max(seam, Math.hypot(prev[0]! - mine[0]!, prev[1]! - mine[1]!, prev[2]! - mine[2]!));
          else at.set(k, mine);
        }
      }
      const mesh = (await assets.bodyMesh(doc.bodyMesh))!;
      const folds = mouthFolds(scene, assets, { names: mesh.meta.regions, ids: mesh.vertexRegion });
      const worstStretch = folds.stretch;
      // The chin drops and the lower teeth come with it.
      let chinDrop = 0;
      for (let i = 1; i < dh.length; i += 3) chinDrop = Math.max(chinDrop, -dh[i]!);
      const eyesMesh = ex.meshes.find((m) => m.role === 'eyes')!;
      const de = denseShape(eyesMesh, 'jawOpen');
      let teethDrop = 0;
      if (de) for (let i = 1; i < de.length; i += 3) teethDrop = Math.max(teethDrop, -de[i]!);
      report.push({
        character: label,
        jawOpen: {
          seamMismatchMm: +(seam * 1000).toFixed(6),
          worstEdgeStretch: +worstStretch.toFixed(3),
          worstEdgeStretchAcrossLipCorners: +folds.stretchAll.toFixed(3),
          foldedTriangles: folds.count,
          foldedAreaMm2: +(folds.area * 1e6).toFixed(2),
          farthestFoldFromMouthRimMm: +(folds.farthest * 1000).toFixed(2),
          makehumanFullMeshFolds: folds.makehuman,
          chinDropMm: +(chinDrop * 1000).toFixed(2),
          lowerTeethDropMm: +(teethDrop * 1000).toFixed(2),
        },
      });
      expect(seam, `${label}: seam`).toBeLessThan(1e-6);
      expect(folds.farthest, `${label}: folds only at the lips (within 12 mm of the mouth opening)`).toBeLessThan(0.012);
      expect(folds.area, `${label}: folded area`).toBeLessThan(1e-4);
      expect(worstStretch, `${label}: edge stretch`).toBeLessThan(4);
      expect(chinDrop, `${label}: chin drop`).toBeGreaterThan(0.01);
      expect(teethDrop, `${label}: teeth follow the jaw`).toBeGreaterThan(0.005);
    }
    const dir = join(REPO_ROOT, 'docs', 'milestones', 'M8');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'expression_report.json'), JSON.stringify({ generated: 'packages/core/test/expression-scene.test.ts', results: report }, null, 1) + '\n');
  });
});
