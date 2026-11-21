/**
 * PRD Part 3, M23 acceptance: drape and garment asset (F30, F31).
 *
 * For designs of every program on the benchmark bodies (Mara and Cole, PRD Part 2 section 4), each design
 * built to that body's measurements, draped on it and turned into a PS2 garment:
 * - seam gaps under 1 mm after sewing, no body penetration over 1 mm, woven cloth's stretch along its
 *   threads under 3% (area-weighted mean; the 95th percentile and the largest are listed);
 * - the coarse garment watertight except at hems and openings (no open seam edge, no edge with more than
 *   two triangles), UV texel density within 5% across panels, folds in the bake (shade deviation over
 *   FOLD_MIN);
 * - the drape's time logged (target under 10 s).
 *
 * The routine suite runs the default design of every program on Mara. The acceptance run is
 * `node scripts/m23-accept.mjs` (50 designs per program on both bodies, programs in parallel), which sets
 * PS2CC_M23_PROGRAMS, PS2CC_M23_DESIGNS, PS2CC_M23_BODIES and PS2CC_M23_OUT and writes
 * docs/milestones/M23/drape.txt.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { garmentCodeBody } from '../src/anthro/definitions';
import { defaultCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { drapeProgram } from '../src/garment/build/generate';
import { patternPrograms, programDefaultDesign, randomProgramDesign } from '../src/garment/pattern/programs/registry';
import '../src/garment/pattern/programs/ps2cc-programs';
import { shellBody, shellBodyAt, type ShellBody } from '../src/garment/shell/body';
import type { DEFAULT_MACROS } from '../src/morph/macros';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets, REPO_ROOT } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;
const PROGRAMS = process.env.PS2CC_M23_PROGRAMS ? process.env.PS2CC_M23_PROGRAMS.split(',') : null;
const DESIGNS = Number(process.env.PS2CC_M23_DESIGNS ?? 1);
const BODIES = (process.env.PS2CC_M23_BODIES ?? 'mara').split(',');
const OUT = process.env.PS2CC_M23_OUT ? join(REPO_ROOT, 'docs', 'milestones', 'M23', 'results') : null;
const SEED = 23000;
/** For looking into some designs: PS2CC_M23_ONLY=5,20 runs only those design numbers. */
const ONLY = process.env.PS2CC_M23_ONLY ? process.env.PS2CC_M23_ONLY.split(',').map(Number) : null;

/** Folds in the bake: the shade's standard deviation over the cloth above this (about 4 grey levels; a flat bake has 0). */
export const FOLD_MIN = 0.015;
/** Garments with less cloth than this (m²: a lone waistband) are not held to the fold check. */
export const FOLD_MIN_AREA = 0.1;

/** The benchmark characters' bodies (app/frontend/e2e/bench-characters.ts). */
const BENCH: Record<string, Partial<typeof DEFAULT_MACROS>> = {
  mara: { gender: 0, age: 0.38, muscle: 0.55, weight: 0.42, height: 0.48 },
  cole: { gender: 1, age: 0.55, muscle: 0.62, weight: 0.5, height: 0.6 },
};

interface Row {
  program: string;
  body: string;
  design: number;
  seamGapMm: number;
  weldGapMm: number;
  penetrationMm: number;
  strainMean: number;
  strainP95: number;
  strainMax: number;
  openSeamEdges: number;
  nonManifoldEdges: number;
  texelSpread: number;
  foldDeviation: number;
  /** Pattern area of the draped panels (m²). */
  clothArea: number;
  particles: number;
  triangles: number;
  edgeCm: number;
  drapeMs: number;
  totalMs: number;
  simTime: number;
  failures: string[];
}

function check(r: Row): string[] {
  const f: string[] = [];
  if (r.seamGapMm >= 1) f.push(`seam gap ${r.seamGapMm.toFixed(2)} mm`);
  if (r.penetrationMm > 1) f.push(`penetration ${r.penetrationMm.toFixed(2)} mm`);
  if (r.strainMean >= 0.03) f.push(`woven strain ${(r.strainMean * 100).toFixed(2)}%`);
  if (r.openSeamEdges > 0 || r.nonManifoldEdges > 0) f.push(`not watertight (${r.openSeamEdges} open seam edges, ${r.nonManifoldEdges} non-manifold)`);
  if (r.texelSpread >= 0.05) f.push(`texel spread ${(r.texelSpread * 100).toFixed(1)}%`);
  // A lone waistband (well under 0.1 m² of cloth) has nothing to fold.
  if (r.clothArea >= FOLD_MIN_AREA && r.foldDeviation <= FOLD_MIN) f.push(`fold deviation ${r.foldDeviation.toFixed(3)}`);
  return f;
}

suite('M23: drape and garment asset (PRD Part 3, F30, F31)', () => {
  let assets: CoreAssets;
  const bodies = new Map<string, { body: ShellBody; positions: Float32Array; measurements: Record<string, number> }>();
  beforeAll(async () => {
    assets = await loadAssets();
    const base = await shellBody(assets);
    for (const id of BODIES) {
      const doc = defaultCharacter(id);
      doc.macros = { ...doc.macros, ...BENCH[id]! };
      const engine = new CharacterEngine(assets, doc);
      const positions = engine.positions.slice();
      bodies.set(id, { body: shellBodyAt(base, positions, engine.skeleton), positions, measurements: garmentCodeBody(assets.anthro.measure(positions)) });
    }
    if (OUT) mkdirSync(OUT, { recursive: true });
  });

  const programs = patternPrograms().filter((p) => !PROGRAMS || PROGRAMS.includes(p.id));
  for (const prog of programs) {
    it(`${prog.id}: ${DESIGNS} design(s) on ${BODIES.join(', ')}`, () => {
      const rows: Row[] = [];
      for (const bid of BODIES) {
        const b = bodies.get(bid)!;
        const rng = new Rng(SEED + prog.id.length * 101 + bid.length);
        for (let d = 0; d < DESIGNS; d++) {
          const design = d === 0 ? programDefaultDesign(prog.id) : randomProgramDesign(prog.id, rng, b.measurements).design;
          if (ONLY && !ONLY.includes(d)) continue;
          const t0 = performance.now();
          const m = drapeProgram({ program: prog.id, design, measurements: b.measurements, body: b.body, bodyPositions: b.positions, clock: () => performance.now() })!;
          const total = performance.now() - t0;
          const dm = m.drape.metrics;
          const row: Row = {
            program: prog.id,
            body: bid,
            design: d,
            seamGapMm: dm.seamGap * 1000,
            weldGapMm: dm.weldGap * 1000,
            penetrationMm: dm.penetration * 1000,
            strainMean: dm.wovenStrainMean,
            strainP95: dm.wovenStrainP95,
            strainMax: dm.wovenStrainMax,
            openSeamEdges: m.coarse.report.openSeamEdges,
            nonManifoldEdges: m.coarse.report.nonManifoldEdges,
            texelSpread: m.coarse.report.texelSpread,
            foldDeviation: m.folds.deviation,
            clothArea: m.drape.fine.panels.reduce((a, p) => a + p.area, 0) / 1e4,
            particles: m.drape.fine.particles,
            triangles: m.coarse.report.triangles,
            edgeCm: m.coarse.report.edgeCm,
            drapeMs: m.drape.ms,
            totalMs: total,
            simTime: m.drape.simTime,
            failures: [],
          };
          row.failures = check(row);
          if (process.env.PS2CC_M23_DEBUG) {
            const at = m.drape.metrics.penetrationAt;
            const pm = m.drape.fine.panels.find((p) => at >= p.offset && at < p.offset + p.count);
            const P = m.drape.positions;
            let seg = -1;
            let bd = Infinity;
            for (let v = 0; v < b.body.positions.length / 3; v++) {
              const dd = (b.body.positions[v * 3]! - P[at * 3]!) ** 2 + (b.body.positions[v * 3 + 1]! - P[at * 3 + 1]!) ** 2 + (b.body.positions[v * 3 + 2]! - P[at * 3 + 2]!) ** 2;
              if (dd < bd) {
                bd = dd;
                seg = b.body.segment[v]!;
              }
            }
            console.log('deepest', pm?.name, at >= 0 ? [0, 1, 2].map((k) => P[at * 3 + k]!.toFixed(3)).join(',') : '', 'segment', seg, 'boundary', pm ? at - pm.offset < pm.edgeSamples.reduce((s2, e) => s2 + e.length - 1, 0) : null);
          }
          rows.push(row);
        }
      }
      if (OUT) writeFileSync(join(OUT, `${prog.id}.json`), JSON.stringify(rows, null, 1) + '\n');
      for (const r of rows) console.log(`${r.program} ${r.body} #${r.design}: gap ${r.seamGapMm.toFixed(2)} mm, pen ${r.penetrationMm.toFixed(2)} mm, strain ${(r.strainMean * 100).toFixed(2)}% (p95 ${(r.strainP95 * 100).toFixed(1)}%), tris ${r.triangles}, texel ${(r.texelSpread * 100).toFixed(1)}%, folds ${r.foldDeviation.toFixed(3)}, drape ${(r.drapeMs / 1000).toFixed(1)} s${r.failures.length ? ' FAIL ' + r.failures.join('; ') : ''}`);
      if (!OUT) for (const r of rows) expect(r.failures, `${r.program} ${r.body} #${r.design}`).toEqual([]);
    });
  }
});
