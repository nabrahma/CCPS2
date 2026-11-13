/**
 * Build step (PRD Part 2 F18, M15): the benchmark outfits, made with Garment
 * Studio's own tools (`packages/core/src/wardrobe/studio.ts`, the code behind
 * the app's Garment Studio) from MakeHuman's CC0 garments, and saved through
 * the custom-garment import (M10) as library garments with their looks:
 *
 * - rollneck_sweater: the fisherman sweater with a roll neck (Mara and Cole).
 * - mara_utility_vest: the same sweater with the sleeves cropped off,
 *   loosened to sit over the roll-neck, a stand-up neck band and two chest
 *   pockets; canvas, zip, pocket flaps.
 * - cole_leather_jacket: the same sweater cropped at the waist, loosened, with
 *   a folded collar; worn leather, shearling collar, fur trim on collar and
 *   cuffs, zip and chest pocket flaps.
 * - wristbands: the medium gloves cropped to a band at the wrist.
 * - cargo_trousers: the cargo pants with a patch pocket on each thigh.
 *
 * Writes `assets/core/proxies/clothes/ps2cc_<name>.json/.bin` and a plain
 * texture, catalog entries (with the looks as defaults) and licence rows
 * (CC0, derived from the MakeHuman garment). Run with `pnpm build:outfits`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addPatch,
  betweenShoulders,
  bodySurface,
  buildRenderTopology,
  CharacterEngine,
  cropAtPlane,
  CoreAssets,
  DEFAULT_FUR,
  defaultCharacter,
  editMeshFromProxy,
  editMeshToRaw,
  extrudeLoop,
  foldFrames,
  importGarment,
  inflateAll,
  loopCentre,
  newLook,
  openLoops,
  prepareGarment,
  referenceBody,
  surfaceFromTopology,
  uvIslands,
  type Decal,
  type EditMesh,
  type GarmentDefaults,
  type GarmentLook,
  type ImportSlot,
  type ProxyAsset,
} from '@ps2cc/core';
import { NodeAssetSource } from '../../../packages/core/src/io/node';
import { Canvas } from './png';

type Vec3 = [number, number, number];
const here = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(here, '../../..');
const ASSETS = join(REPO, 'assets', 'core');

const assets = await CoreAssets.load(new NodeAssetSource(ASSETS));
const ref = referenceBody(assets);
const body = bodySurface(ref);
const sk = new CharacterEngine(assets, defaultCharacter()).skeleton;
const joint = (name: string): Vec3 => {
  const i = sk.rig.index.get(name)!;
  return [sk.heads[i * 3]!, sk.heads[i * 3 + 1]!, sk.heads[i * 3 + 2]!];
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const M = (id: string) => `ps2cc:materials/${id}`;

async function start(id: string): Promise<{ m: EditMesh; proxy: ProxyAsset }> {
  const proxy = await assets.proxy(id);
  return { m: editMeshFromProxy(proxy, ref), proxy };
}

/** The open loop nearest a point. */
function loopNear(m: EditMesh, p: Vec3): number[] {
  let best: number[] = [];
  let bd = Infinity;
  for (const l of openLoops(m)) {
    const c = loopCentre(m, l);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d < bd) [bd, best] = [d, l];
  }
  return best;
}

/** The outermost garment vertex near the line through `p` along `dir` (front: dir +z). */
function onGarment(m: EditMesh, p: Vec3, dir: Vec3, reach = 0.05): Vec3 {
  const d = norm(dir);
  const P = m.positions;
  let best: Vec3 | null = null;
  let bs = -Infinity;
  for (let v = 0; v < P.length / 3; v++) {
    const q: Vec3 = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
    const w = sub(q, p);
    const t = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
    const off = Math.hypot(w[0] - d[0] * t, w[1] - d[1] * t, w[2] - d[2] * t);
    if (off > reach || t < -0.05) continue;
    if (t > bs) [bs, best] = [t, q];
  }
  if (!best) throw new Error(`no garment near ${p.map((x) => x.toFixed(3)).join(', ')}`);
  return best;
}

const neck = joint('neck_01');
// spine_03's head is at the bottom of the rib cage: the chest is between it and the neck.
const chest = lerp(joint('spine_03'), joint('neck_01'), 0.42);
const waist = joint('spine_01');
const pelvis = joint('pelvis');

interface Built {
  name: string;
  label: string;
  slot: ImportSlot;
  from: string;
  m: EditMesh;
  look: (place: Placer) => GarmentLook;
  fur?: GarmentDefaults['fur'];
  tint?: [number, number, number];
}

/** Places decals and zones on the imported garment by body position. */
interface Placer {
  /** Islands whose UV centre lies in a studio part's rectangle. */
  partIslands(name: string): number[];
  /** UV of the garment surface nearest a body point, and the UV rotation (degrees) that points a decal's +y up the body. */
  uvAt(p: Vec3): { uv: [number, number]; rotation: number; island: number };
}

const outfits: Built[] = [];

// Roll-neck sweater.
{
  const { m } = await start('mh:clothes/toigo_fisherman_sweater');
  extrudeLoop(m, loopNear(m, neck), { height: 0.075, out: 0.016, profile: 'roll', name: 'rollneck' }, body);
  outfits.push({
    name: 'rollneck_sweater',
    label: 'Roll-neck sweater',
    slot: 'top',
    from: 'mh:clothes/toigo_fisherman_sweater',
    m,
    look: (pl) => {
      const l = newLook(M('knit'));
      // The knit's own colour; a character's garment tint makes it darker or greener.
      l.zones.push({ id: 'z2', name: 'Roll neck', islands: pl.partIslands('rollneck'), material: M('knit'), tint: [1, 1, 1], scale: 0.8, rotation: 90, wear: 0 });
      l.seams.stitches = 0.35;
      return l;
    },
  });
}

// Mara's utility vest.
{
  const { m } = await start('mh:clothes/toigo_fisherman_sweater');
  for (const s of ['l', 'r'] as const) {
    const sh = joint(`upperarm_${s}`);
    const axis = norm(sub(joint(`lowerarm_${s}`), sh));
    // Only on this arm's side of the shoulder.
    cropAtPlane(m, { point: [sh[0] + axis[0] * 0.015, sh[1] + axis[1] * 0.015, sh[2] + axis[2] * 0.015], normal: axis }, { point: [sh[0] * 0.75, 0, 0], normal: [Math.sign(sh[0]), 0, 0] });
  }
  cropAtPlane(m, { point: [0, pelvis[1] - 0.02, 0], normal: [0, -1, 0] }, betweenShoulders(joint('upperarm_l')[0]));
  inflateAll(m, 0.009, body);
  extrudeLoop(m, loopNear(m, neck), { height: 0.03, out: 0.006, profile: 'band', name: 'neckband' }, body);
  const py = chest[1] - 0.03;
  for (const x of [-0.085, 0.085]) addPatch(m, onGarment(m, [x, py, 0], [0, 0, 1]), [0, 1, 0], 0.11, 0.13, body, x < 0 ? 'pocketR' : 'pocketL');
  outfits.push({
    name: 'mara_utility_vest',
    label: 'Utility vest',
    slot: 'outer',
    from: 'mh:clothes/toigo_fisherman_sweater',
    m,
    look: (pl) => {
      const l = newLook(M('canvas'));
      const khaki: [number, number, number] = [0.62, 0.6, 0.46];
      l.zones[0]!.tint = khaki;
      l.zones[0]!.wear = 0.4;
      l.zones.push({ id: 'z2', name: 'Pockets', islands: [...pl.partIslands('pocketL'), ...pl.partIslands('pocketR')], material: M('canvas'), tint: [0.56, 0.54, 0.41], scale: 1, rotation: 0, wear: 0.5 });
      l.zones.push({ id: 'z3', name: 'Neck band', islands: pl.partIslands('neckband'), material: M('nylon_ripstop'), tint: [0.45, 0.44, 0.36], scale: 1, rotation: 0, wear: 0.2 });
      const top = pl.uvAt(onGarment(m, [0, neck[1] - 0.06, 0], [0, 0, 1], 0.05));
      const bottom = pl.uvAt(onGarment(m, [0, pelvis[1] + 0.04, 0], [0, 0, 1], 0.05));
      l.decals.push({ id: 'zip', kind: 'zip', uv: top.uv, uv2: bottom.uv, sizeMm: 10, rotation: 0, colour: [0.55, 0.53, 0.5] });
      for (const [i, x] of [-0.085, 0.085].entries()) {
        const at = pl.uvAt(onGarment(m, [x, py + 0.045, 0], [0, 0, 1]));
        l.decals.push({ id: `flap${i}`, kind: 'pocketFlap', uv: at.uv, sizeMm: 118, heightMm: 46, rotation: at.rotation, colour: [0.3, 0.27, 0.2] });
      }
      l.folds.strength = 0.7;
      return l;
    },
  });
}

// Cole's cropped leather jacket.
{
  const { m } = await start('mh:clothes/toigo_fisherman_sweater');
  cropAtPlane(m, { point: [0, waist[1] + 0.02, 0], normal: [0, -1, 0] }, betweenShoulders(joint('upperarm_l')[0]));
  inflateAll(m, 0.01, body);
  extrudeLoop(m, loopNear(m, neck), { height: 0.13, out: 0.03, profile: 'collar', name: 'collar' }, body);
  const py = chest[1] - 0.04;
  outfits.push({
    name: 'cole_leather_jacket',
    label: 'Cropped leather jacket',
    slot: 'outer',
    from: 'mh:clothes/toigo_fisherman_sweater',
    m,
    fur: { ...DEFAULT_FUR, enabled: true, edges: ['collar', 'cuffs'], length: 0.022, density: 190, lift: 0.55 },
    look: (pl) => {
      const l = newLook(M('leather_worn'));
      l.zones[0]!.tint = [0.62, 0.5, 0.42];
      l.zones[0]!.wear = 0.45;
      l.zones.push({ id: 'z2', name: 'Shearling collar', islands: pl.partIslands('collar'), material: M('shearling'), tint: [1, 0.96, 0.9], scale: 0.7, rotation: 0, wear: 0 });
      const top = pl.uvAt(onGarment(m, [0, neck[1] - 0.07, 0], [0, 0, 1], 0.05));
      const bottom = pl.uvAt(onGarment(m, [0, waist[1] + 0.035, 0], [0, 0, 1], 0.05));
      l.decals.push({ id: 'zip', kind: 'zip', uv: top.uv, uv2: bottom.uv, sizeMm: 11, rotation: 0, colour: [0.62, 0.6, 0.56] });
      for (const [i, x] of [-0.09, 0.09].entries()) {
        const at = pl.uvAt(onGarment(m, [x, py, 0], [0, 0, 1]));
        l.decals.push({ id: `flap${i}`, kind: 'pocketFlap', uv: at.uv, sizeMm: 110, heightMm: 42, rotation: at.rotation, colour: [0.6, 0.58, 0.54] } satisfies Decal);
      }
      l.seams.stitches = 0.7;
      l.seams.shadow = 0.75;
      l.folds.strength = 1;
      return l;
    },
  });
}

// Wristbands.
{
  const { m } = await start('mh:clothes/toigo_gloves_medium');
  for (const s of ['l', 'r'] as const) {
    const hand = joint(`hand_${s}`);
    const axis = norm(sub(hand, joint(`lowerarm_${s}`)));
    const thisSide = { point: [0, 0, 0] as Vec3, normal: [Math.sign(hand[0]), 0, 0] as Vec3 };
    cropAtPlane(m, { point: [hand[0] - axis[0] * 0.005, hand[1] - axis[1] * 0.005, hand[2] - axis[2] * 0.005], normal: axis }, thisSide);
    cropAtPlane(m, { point: [hand[0] - axis[0] * 0.07, hand[1] - axis[1] * 0.07, hand[2] - axis[2] * 0.07], normal: [-axis[0], -axis[1], -axis[2]] }, thisSide);
  }
  inflateAll(m, 0.002, body);
  outfits.push({
    name: 'wristbands',
    label: 'Wristbands',
    slot: 'gloves',
    from: 'mh:clothes/toigo_gloves_medium',
    m,
    look: () => {
      const l = newLook(M('knit'));
      l.zones[0]!.tint = [0.3, 0.29, 0.28];
      l.zones[0]!.rotation = 90;
      l.folds.strength = 0;
      return l;
    },
  });
}

// Cargo trousers.
{
  const { m } = await start('mh:clothes/cortu_cargo_pants');
  for (const s of ['l', 'r'] as const) {
    const hip = joint(`thigh_${s}`);
    const knee = joint(`calf_${s}`);
    const at = lerp(hip, knee, 0.55);
    const side = Math.sign(hip[0]);
    // On the outside of the thigh, a little to the front.
    const p = onGarment(m, [hip[0], at[1], at[2]], [side, 0, 0.3], 0.08);
    addPatch(m, p, [0, 1, 0], 0.15, 0.17, body, `cargo_${s}`);
  }
  outfits.push({
    name: 'cargo_trousers',
    label: 'Cargo trousers',
    slot: 'bottom',
    from: 'mh:clothes/cortu_cargo_pants',
    m,
    look: (pl) => {
      const l = newLook(M('canvas'));
      l.zones[0]!.tint = [0.5, 0.48, 0.38];
      l.zones[0]!.wear = 0.35;
      l.zones.push({ id: 'z2', name: 'Cargo pockets', islands: [...pl.partIslands('cargo_l'), ...pl.partIslands('cargo_r')], material: M('canvas'), tint: [0.47, 0.45, 0.35], scale: 1, rotation: 0, wear: 0.45 });
      for (const s of ['l', 'r'] as const) {
        const hip = joint(`thigh_${s}`);
        const knee = joint(`calf_${s}`);
        const c = lerp(hip, knee, 0.55);
        const p = onGarment(m, [hip[0], c[1] + 0.07, c[2]], [Math.sign(hip[0]), 0, 0.3], 0.08);
        const at = pl.uvAt(p);
        l.decals.push({ id: `flap_${s}`, kind: 'pocketFlap', uv: at.uv, sizeMm: 150, heightMm: 55, rotation: at.rotation, colour: [0.3, 0.28, 0.22] });
      }
      l.folds.strength = 0.9;
      return l;
    },
  });
}

// ------------------------------------------------------------------ write

const catalogPath = join(ASSETS, 'catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { proxies: Record<string, unknown>[] };
const licPath = join(ASSETS, 'LICENSES.json');
const lic = JSON.parse(readFileSync(licPath, 'utf8')) as { files: Record<string, unknown>[] };
const licRows = new Map(lic.files.map((r) => [r.file as string, r]));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const report: Record<string, unknown>[] = [];

for (const o of outfits) {
  const raw = editMeshToRaw(o.m);
  const g = await importGarment(raw, { name: o.label, slot: o.slot, body: ref });
  const stem = `ps2cc_${o.name}`;
  const id = `ps2cc:clothes/${o.name}`;
  const rel = `proxies/clothes/${stem}`;
  const texRel = `textures/clothes/${stem}.png`;
  // A plain light texture: the look covers every piece with library materials.
  const tex = new Canvas(64, 64, [200, 198, 192]);
  writeFileSync(join(ASSETS, texRel), tex.toPng());

  // Where the studio's new parts ended up after the import (decimation keeps UVs).
  const proxy = g.proxy;
  const topo = buildRenderTopology(proxy.faceVerts, proxy.faceUvs, proxy.uvs);
  const pos = proxy.fit(ref.positions);
  const surface = surfaceFromTopology(topo, pos);
  const islands = uvIslands(surface);
  const canvas = prepareGarment(surface, 512, foldFrames({ joint }), null);
  const placer: Placer = {
    partIslands: (name) => {
      const part = o.m.parts.find((p) => p.name === name);
      if (!part) throw new Error(`${o.name}: no part ${name}`);
      const [u0, v0, u1, v1] = part.rect;
      const out: number[] = [];
      for (let i = 0; i < islands.count; i++) {
        const cu = (islands.bounds[i * 4]! + islands.bounds[i * 4 + 2]!) / 2;
        const cv = (islands.bounds[i * 4 + 1]! + islands.bounds[i * 4 + 3]!) / 2;
        if (cu >= u0 && cu <= u1 && cv >= v0 && cv <= v1) out.push(i);
      }
      if (out.length === 0) throw new Error(`${o.name}: part ${name} has no island`);
      return out;
    },
    uvAt: (p) => {
      const r = canvas.raster;
      const S = r.size;
      const nearest = (q: Vec3, island = -1) => {
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < S * S; i++) {
          if (r.coverage[i] !== 1 || (island >= 0 && r.island[i] !== island)) continue;
          const d = Math.hypot(r.position[i * 3]! - q[0], r.position[i * 3 + 1]! - q[1], r.position[i * 3 + 2]! - q[2]);
          if (d < bd) [bd, best] = [d, i];
        }
        return best;
      };
      const i = nearest(p);
      const island = r.island[i]!;
      const j = nearest([p[0], p[1] + 0.03, p[2]], island);
      const uv = (k: number): [number, number] => [((k % S) + 0.5) / S, 1 - (Math.floor(k / S) + 0.5) / S];
      const a = uv(i);
      const b = uv(j);
      // Rotation that turns the decal's +y (UV +v) towards body-up.
      const rotation = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI - 90;
      return { uv: a, rotation: Math.round(rotation), island };
    },
  };
  const look = o.look(placer);
  const defaults: GarmentDefaults = { look, ...(o.fur ? { fur: o.fur } : {}), ...(o.tint ? { tint: o.tint } : {}) };

  const meta = {
    ...g.meta,
    id,
    uuid: createHash('sha256').update(id).digest('hex').slice(0, 32),
    binary: `${stem}.bin`,
    tags: ['ps2cc', 'garment-studio'],
    material: { diffuseColor: [0.78, 0.78, 0.75] as [number, number, number], transparent: false, backfaceCull: false, opacity: 1, diffuseTexture: texRel, textureSize: [64, 64] as [number, number] },
    defaults,
  };
  writeFileSync(join(ASSETS, `${rel}.bin`), g.bin);
  writeFileSync(join(ASSETS, `${rel}.json`), JSON.stringify(meta, null, 1) + '\n');

  const entry = {
    id,
    category: 'clothes',
    name: o.label,
    file: `${rel}.json`,
    triangles: g.report.triangles,
    originalTriangles: g.report.originalTriangles,
    hiddenFaces: meta.hiddenFaces,
    overBudget: false,
    slot: o.slot,
    tags: meta.tags,
    licence: 'CC0-1.0',
    defaults,
  };
  catalog.proxies = [...catalog.proxies.filter((p) => p.id !== id), entry];
  const fromRow = [...licRows.values()].find((r) => r.asset === o.from && String(r.file).endsWith('.ps2.json'));
  if (!fromRow) throw new Error(`no licence row for ${o.from}`);
  for (const f of [`${rel}.json`, `${rel}.bin`, texRel]) {
    const abs = join(ASSETS, f);
    licRows.set(f, {
      file: f,
      asset: id,
      licence: fromRow.licence,
      author: f === texRel ? 'PS2CC (generated)' : `${fromRow.author as string}, reshaped in Garment Studio by PS2CC`,
      sourceUrl: f === texRel ? 'https://github.com/nabrahma/CCPS2' : fromRow.sourceUrl,
      upstream: f === texRel ? 'ps2cc' : fromRow.upstream,
      attributionRequired: f === texRel ? false : fromRow.attributionRequired,
      sha256: sha(abs),
      bytes: statSync(abs).size,
    });
  }
  report.push({ id, triangles: g.report.triangles, from: g.report.originalTriangles, islands: islands.count, parts: o.m.parts.map((p) => p.name), warnings: g.report.warnings });
}
writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');
lic.files = [...licRows.values()].sort((a, b) => (String(a.file) < String(b.file) ? -1 : 1));
writeFileSync(licPath, JSON.stringify(lic, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
