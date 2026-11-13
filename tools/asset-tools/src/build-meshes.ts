/**
 * Build-time mesh generation: `pnpm build:meshes`.
 * Writes assets/core/bodymesh/*, updates catalog.json and LICENSES.json, and
 * renders wireframe review images to docs/milestones/M3/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaSampler, SLOT_BUDGET, BaseMesh, buildRenderTopology, computeCoveredVertices, computeQuadNormals, detectRegions, gather3, ProxyAsset, type AtlasSpec, type AtlasTag } from '@ps2cc/core';
import { NodeAssetSource } from '@ps2cc/core/node';
import { ContainerWriter } from './container-writer';
import { decimateGarment } from './garments';
import { buildHairAtlases } from './hair-atlases';
import { registerDerivedFiles } from './licenses';
import { Canvas, decodePng } from './png';
import { buildPs2Body, type Ps2BodyResult } from './ps2body';
import { REGIONS } from './regions';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../..');
const ASSETS = join(REPO, 'assets', 'core');

/**
 * Body tiers (PRD F2). From Part 2 F13: 12k and up keep the lower face (lips, chin, mouth
 * interior), 16k and up the whole head at full density. 0 triangles: no reduction.
 */
export const BODY_TARGETS: readonly { id: string; triangles: number; fullHead?: boolean; lockLowerFace?: boolean }[] = [
  { id: 'ps2_body_8k', triangles: 8000 },
  { id: 'ps2_body_10k', triangles: 10000 },
  { id: 'ps2_body_12k', triangles: 12000, lockLowerFace: true },
  { id: 'ps2_body_16k', triangles: 16000, fullHead: true, lockLowerFace: true },
  { id: 'ps2_body_20k', triangles: 20000, fullHead: true, lockLowerFace: true },
  { id: 'ps2_body_full', triangles: 0, fullHead: true },
];

function wireframe(base: BaseMesh, r: Ps2BodyResult, view: 'front' | 'side', size = 1024): Uint8Array {
  const c = new Canvas(size, size);
  const P = base.positions;
  const axis = view === 'front' ? 0 : 2;
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const v of r.sourceVertex) {
    const x = P[v * 3 + axis]!;
    const y = P[v * 3 + 1]!;
    lo = [Math.min(lo[0]!, x), Math.min(lo[1]!, y)];
    hi = [Math.max(hi[0]!, x), Math.max(hi[1]!, y)];
  }
  const scale = (size * 0.94) / Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!);
  const cx = (lo[0]! + hi[0]!) / 2;
  const cy = (lo[1]! + hi[1]!) / 2;
  const proj = (v: number): [number, number] => [
    size / 2 + (P[v * 3 + axis]! - cx) * scale,
    size / 2 - (P[v * 3 + 1]! - cy) * scale,
  ];
  const regionColour: [number, number, number][] = [
    [120, 170, 220], [200, 200, 120], [240, 140, 110], [150, 220, 150], [255, 80, 80], [200, 120, 220],
  ];
  for (let t = 0; t < r.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i = r.indices[t + e]!;
      const j = r.indices[t + ((e + 1) % 3)]!;
      const a = proj(r.sourceVertex[i]!);
      const b = proj(r.sourceVertex[j]!);
      c.line(a[0], a[1], b[0], b[1], regionColour[r.vertexRegion[i]!]!, 0.55);
    }
  }
  return c.toPng();
}

/** Front and back views of the body with the computed hidden vertices in red (review image). */
function coverageImage(base: BaseMesh, bodyQuads: number[], covered: Uint32Array, size = 512): Uint8Array {
  const c = new Canvas(size * 2, size);
  const P = base.positions;
  const hidden = new Set(covered);
  const scale = (size * 0.92) / 2.0;
  const proj = (v: number, back: boolean): [number, number] => [
    (back ? size * 1.5 - P[v * 3]! * scale : size * 0.5 + P[v * 3]! * scale),
    size * 0.5 - (P[v * 3 + 1]! - 0.05) * scale,
  ];
  for (const back of [false, true]) {
    for (let q = 0; q < bodyQuads.length; q += 4) {
      // Only faces turned towards the viewer.
      const z = (P[bodyQuads[q]! * 3 + 2]! + P[bodyQuads[q + 2]! * 3 + 2]!) / 2;
      if (back ? z > 0.02 : z < -0.02) continue;
      for (let k = 0; k < 4; k++) {
        const a = bodyQuads[q + k]!;
        const b = bodyQuads[q + ((k + 1) % 4)]!;
        const pa = proj(a, back);
        const pb = proj(b, back);
        const red = hidden.has(a) && hidden.has(b);
        c.line(pa[0], pa[1], pb[0], pb[1], red ? [240, 70, 60] : [120, 130, 140], red ? 0.8 : 0.25);
      }
    }
  }
  return c.toPng();
}

async function main(): Promise<void> {
  const base = await BaseMesh.load(new NodeAssetSource(ASSETS));
  const catalogPath = join(ASSETS, 'catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
  const bodyMeshes = [];
  const files: { file: string; asset: string; from?: string }[] = [];
  const report: Record<string, unknown>[] = [];
  const shotsDir = join(REPO, 'docs', 'milestones', 'M3');
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(join(REPO, 'docs', 'milestones', 'M4'), { recursive: true });

  // PS2CC_PROXIES_ONLY=teeth,tongue rebuilds only those proxy categories (the body tiers and the rest stay as they are).
  const only = process.env.PS2CC_PROXIES_ONLY ? new Set(process.env.PS2CC_PROXIES_ONLY.split(',')) : null;
  for (const t of only ? [] : BODY_TARGETS) {
    const r = await buildPs2Body(base, t.id, t.triangles || Number.MAX_SAFE_INTEGER, { fullHead: t.fullHead, lockLowerFace: t.lockLowerFace });
    const tris = r.indices.length / 3;
    const target = t.triangles || tris;
    const w = new ContainerWriter();
    w.add('sourceVertex', r.sourceVertex, 'u32');
    w.add('uvs', r.uvs, 'f32');
    w.add('indices', r.indices, 'u32');
    w.add('vertexRegion', r.vertexRegion, 'u8');
    w.write(join(ASSETS, 'bodymesh', t.id), {
      format: 'ps2cc.ps2body/1',
      id: t.id,
      targetTriangles: target,
      triangleCount: tris,
      vertexCount: r.sourceVertex.length,
      regions: REGIONS,
      faceRetention: r.faceRetention,
      stages: r.stagesUsed,
      simplifierError: r.error,
      flippedTriangles: r.flippedTriangles,
      seed: 'meshoptimizer@1.3.0 simplifyWithAttributes, deterministic',
    });
    for (const ext of ['json', 'bin']) files.push({ file: `bodymesh/${t.id}.${ext}`, asset: `ps2cc:bodymesh/${t.id}` });
    bodyMeshes.push({ id: t.id, triangles: tris, vertices: r.sourceVertex.length, file: `bodymesh/${t.id}.json` });
    writeFileSync(join(shotsDir, `${t.id}_wire_front.png`), wireframe(base, r, 'front'));
    writeFileSync(join(shotsDir, `${t.id}_wire_side.png`), wireframe(base, r, 'side'));
    const row = {
      id: t.id,
      triangles: tris,
      target,
      deviation: `${(((tris - target) / target) * 100).toFixed(2)}%`,
      vertices: r.sourceVertex.length,
      faceRetention: `${(r.faceRetention * 100).toFixed(1)}%`,
      flipped: r.flippedTriangles,
      stages: r.stagesUsed.join(','),
    };
    report.push(row);
    console.info(JSON.stringify(row));
  }
  if (!only) catalog.bodyMeshes = bodyMeshes;
  // PS2CC_BODIES_ONLY=1 rebuilds only the body tiers (garments and hair do not depend on them).
  if (process.env.PS2CC_BODIES_ONLY === '1') {
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');
    registerDerivedFiles(ASSETS, files);
    writeFileSync(join(shotsDir, 'bodymesh_report.json'), JSON.stringify(report, null, 2) + '\n');
    return;
  }

  // Garments (PRD F4): decimate to the PS2 budget; keep the full-resolution file for golden tests.
  // Garments without MakeHuman delete_verts get computed hidden faces (coverage.ts).
  const source = new NodeAssetSource(ASSETS);
  const bodyFaces = base.facesWhere((g) => g === 'body');
  const bodyQuads = bodyFaces.flatMap((f) => [0, 1, 2, 3].map((k) => base.faceVerts[f * 4 + k]!));
  const bodyNormals = computeQuadNormals(base.positions, base.faceVerts, base.vertexCount);
  const coverageDir = join(REPO, 'docs', 'milestones', 'M4', 'hidden_faces');
  mkdirSync(coverageDir, { recursive: true });
  const garmentReport: Record<string, unknown>[] = [];
  const proxies = catalog.proxies as { id: string; category: string; file: string; fullFile?: string; slot?: string;
    triangles: number; originalTriangles?: number }[];
  for (const entry of proxies) {
    // Teeth and tongue (Part 2 F19): at most 600 triangles together.
    const isMouth = entry.category === 'teeth' || entry.category === 'tongue';
    if (entry.category !== 'clothes' && entry.category !== 'hair' && !isMouth) continue;
    if (only && !only.has(entry.category)) continue;
    const isHair = entry.category === 'hair';
    const full = entry.fullFile ?? entry.file;
    const proxy = await ProxyAsset.load(source, full);
    const outRel = full.replace(/\.json$/, '.ps2');
    let covered: Uint32Array | undefined;
    if (!isHair && !isMouth && proxy.deleteVerts.length === 0) {
      covered = garmentCoverage(proxy, base, bodyQuads, bodyNormals);
      writeFileSync(join(coverageDir, `${entry.id.split('/').pop()}.png`), coverageImage(base, bodyQuads, covered));
    }
    const r = await decimateGarment(proxy, isMouth ? entry.category : isHair ? 'hair' : (entry.slot ?? 'accessory'), join(ASSETS, outRel), covered);
    if (!isHair && !isMouth) (entry as Record<string, unknown>).hiddenFaces = proxy.deleteVerts.length ? 'makehuman' : covered?.length ? 'computed' : 'none';
    entry.fullFile = full;
    entry.file = `${outRel}.json`;
    entry.originalTriangles = r.originalTriangles;
    entry.triangles = r.triangles;
    (entry as Record<string, unknown>).overBudget = r.triangles > (isMouth ? SLOT_BUDGET[entry.category]! : isHair ? 3500 : 2500);
    for (const ext of ['json', 'bin']) {
      files.push({ file: `${outRel}.${ext}`, asset: entry.id, from: full.replace(/\.json$/, `.${ext}`) });
    }
    garmentReport.push({ id: entry.id, slot: entry.slot, from: r.originalTriangles, to: r.triangles, flipped: r.flipped,
      hiddenFaces: (entry as Record<string, unknown>).hiddenFaces, coveredVertices: covered?.length });
  }
  const over = garmentReport.filter((g) => (g.flipped as number) > 0);
  console.info(`garments and hair: ${garmentReport.length} decimated, ${over.length} with remaining flips`);

  if (only) {
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 1)}\n`);
    registerDerivedFiles(ASSETS, files);
    console.info(JSON.stringify(garmentReport));
    return;
  }
  // Built-in hair card atlas (PRD F5): MakeHuman's CC0 long01 texture has vertical strand strips.
  // The generated card atlases come first (the first is the default); the long01 strips stay available.
  catalog.hairAtlases = [...buildHairAtlases(ASSETS), builtInAtlas('textures/hair/long01.png')];
  writeFileSync(join(shotsDir, '..', 'M4', 'garment_report.json'), JSON.stringify(garmentReport, null, 2) + '\n');

  writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');
  registerDerivedFiles(ASSETS, files);
  writeFileSync(join(shotsDir, 'bodymesh_report.json'), JSON.stringify(report, null, 2) + '\n');
}

/** A card atlas from a texture by alpha-coverage detection (the same detector the atlas editor uses). */
function builtInAtlas(texture: string): { id: string; name: string; atlas: AtlasSpec; licence: string } {
  const img = decodePng(readFileSync(join(ASSETS, texture)));
  const detected = detectRegions(img.rgba, img.width, img.height);
  if (detected.length !== 2) throw new Error(`expected 2 opaque areas in ${texture}, found ${detected.length}`);
  // long01's opaque left half (and its smaller right half) each hold two mirrored strips; alpha alone cannot
  // separate them, so split each at its midline, as a user would in the atlas editor (DECISIONS D-030).
  const tags: AtlasTag[][] = [['clump', 'base'], ['fringe', 'flyaway']];
  const regions = detected.flatMap((r, i) => [
    { ...r, w: r.w / 2, tag: tags[i]![0]! },
    { ...r, x: r.x + r.w / 2, w: r.w / 2, tag: tags[i]![1]! },
  ]);
  console.info(`hair atlas ${texture}: ${regions.length} regions (${regions.map((r) => r.tag).join(', ')})`);
  return { id: 'ps2cc:atlas/long01', name: 'Long hair strips (MakeHuman long01)', atlas: { format: 'ps2cc.atlas/1', texture, regions }, licence: 'CC0-1.0' };
}

/** Computed hidden faces for one garment on the neutral body; empty for see-through materials. */
function garmentCoverage(proxy: ProxyAsset, base: BaseMesh, bodyQuads: number[], bodyNormals: Float32Array): Uint32Array {
  const m = proxy.meta.material;
  // MakeHuman's opacity is only meaningful together with the transparent flag.
  if (m?.transparent && m.opacity > 0 && m.opacity < 0.9) return new Uint32Array(0);
  let alphaAt: ((u: number, v: number) => number) | undefined;
  if (m?.diffuseTexture?.endsWith('.png')) {
    const img = decodePng(readFileSync(join(ASSETS, m.diffuseTexture)));
    alphaAt = alphaSampler(img.width, img.height, img.rgba);
  }
  const topo = buildRenderTopology(proxy.faceVerts, proxy.faceUvs, proxy.uvs);
  const fitted = proxy.fit(base.positions);
  return computeCoveredVertices({
    bodyPositions: base.positions,
    bodyNormals,
    bodyQuads,
    garmentPositions: gather3(fitted, topo.sourceVertex, new Float32Array(topo.sourceVertex.length * 3)),
    garmentIndices: topo.indices,
    garmentUvs: topo.uvs,
    alphaAt,
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
