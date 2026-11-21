/**
 * Determinism hashes (PRD Part 3, 0.2 rule 5): SHA-256 of the output of every
 * Part 3 generator for fixed inputs. The golden values live in
 * `packages/core/test/fixtures/determinism.json`; `determinism.test.ts` checks
 * them in Node and `e2e/determinism.spec.ts` in the browser engine the app
 * uses. The two must match: same inputs, byte-identical outputs.
 *
 * Each milestone adds its generators here (M21: the shell garment templates; M22: the pattern programs; M23:
 * drapes and the garments built from them).
 */
import type { CoreAssets } from './assets';
import { garmentCodeBody, MEASURE_IDS, type MeasureId } from './anthro/definitions';
import { BodyEvaluator } from './anthro/evaluator';
import { solveMeasurements } from './anthro/solve';
import { serializeCharacter } from './character/doc';
import { randomizeRealistic } from './character/randomize';
import { defaultCharacter } from './character/doc';
import * as d from './math/dmath';
import { beta, dirichletUniform, normal, truncatedNormal } from './math/distributions';
import { Sha256 } from './math/sha256';
import { DEFAULT_MACROS, type MacroValues } from './morph/macros';
import { generateCrowd } from './population/crowd';
import { samplePerson } from './population/sampler';
import { hashSeed, Rng } from './random';
import { buildProgram, canonicalJSON, patternPrograms, programDefaultDesign, randomProgramDesign } from './garment/pattern';
import { EXPRESSION_MAP } from './expression/map';
import { buildTemplate } from './garment/shell/generate';
import { SHELL_TEMPLATES } from './garment/shell/templates';
import { shellBody } from './garment/shell/body';
import { drapeProgram } from './garment/build/generate';

function hashFloats(values: ArrayLike<number>): string {
  return new Sha256().updateArray(Float64Array.from(values as ArrayLike<number>)).hex();
}

/** Outputs of the engine-independent maths over fixed sweeps. */
export function dmathHash(): string {
  const out: number[] = [];
  for (let i = -4000; i <= 4000; i++) {
    const x = i * 0.0137;
    out.push(d.sin(x), d.cos(x), d.tan(x), d.atan(x), d.exp(x * 0.5), d.atan2(x, 1.5 - x * 0.1));
    const u = i / 4000;
    out.push(d.asin(u), d.acos(u));
    const p = (i + 4001) * 0.731;
    out.push(d.log(p), d.pow(p, 0.37), d.pow(1 + Math.abs(u), 7), d.sin(p * 1000), d.cos(p * 977));
  }
  return hashFloats(out);
}

/** Seeded draws of every distribution. */
export function distributionsHash(): string {
  const rng = new Rng(4242);
  const out: number[] = [];
  for (let i = 0; i < 2000; i++) {
    out.push(normal(rng), truncatedNormal(rng, 2.5), beta(rng, 16.4956, 25.6562), beta(rng, 0.2341, 0.6836), beta(rng, 1, 1), beta(rng, 3.2, 0.7));
    out.push(...dirichletUniform(rng, 3));
  }
  return hashFloats(out);
}

function seededMacros(rng: Rng): MacroValues {
  const m: MacroValues = { ...DEFAULT_MACROS };
  m.gender = rng.next();
  m.age = rng.range(0.36, 1);
  m.muscle = rng.next();
  m.weight = rng.next();
  m.height = rng.next();
  m.proportions = rng.next();
  m.breastSize = rng.next();
  m.breastFirmness = rng.next();
  const a = rng.next() + 0.01;
  const b = rng.next() + 0.01;
  const c = rng.next() + 0.01;
  m.african = a / (a + b + c);
  m.asian = b / (a + b + c);
  m.caucasian = c / (a + b + c);
  return m;
}

/** Every generator's hash, by name. Takes a few seconds. */
export async function generatorHashes(assets: CoreAssets): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  out.dmath = dmathHash();
  out.distributions = distributionsHash();

  // F24: body shapes and their measurements.
  const evaluator = new BodyEvaluator(assets);
  const bodies = new Sha256();
  const measures: number[] = [];
  const rng = new Rng(1234);
  for (let i = 0; i < 8; i++) {
    const macros = seededMacros(rng);
    const modifiers: Record<string, number> = i % 2 ? { 'measure/measure-waist-circ-decr|incr': rng.range(-1, 1), 'torso/torso-scale-horiz-decr|incr': rng.range(-1, 1) } : {};
    const pos = evaluator.evaluate(macros, modifiers);
    bodies.updateArray(pos);
    const m = assets.anthro.measure(pos);
    for (const id of MEASURE_IDS) measures.push(m[id]);
  }
  out.bodies = bodies.hex();
  out.measurements = hashFloats(measures);

  // F24: the measurement solve.
  const solved: number[] = [];
  const cases: [MacroValues, Partial<Record<MeasureId, number>>][] = [
    [{ ...DEFAULT_MACROS, gender: 1 }, { height: 178, bust: 102, waist: 84 }],
    [{ ...DEFAULT_MACROS, gender: 0 }, { height: 164, hips: 98, thigh: 57, inseam: 76 }],
  ];
  for (const [macros, targets] of cases) {
    const report = solveMeasurements(assets, assets.anthro, { macros, modifiers: {} }, targets);
    solved.push(...Object.values(report.macros));
    for (const key of Object.keys(report.modifiers).sort()) solved.push(report.modifiers[key]!);
    for (const t of report.targets) solved.push(t.reached);
  }
  out.measurementSolve = hashFloats(solved);

  // F23: the population sampler, realistic random and the crowd generator.
  const people: number[] = [];
  const prng = new Rng(20261115);
  for (let i = 0; i < 60; i++) {
    const p = samplePerson(assets, assets.anthro, assets.population, prng, DEFAULT_MACROS);
    people.push(p.years, p.statureCm, ...Object.values(p.macros));
  }
  out.population = hashFloats(people);
  const text = new Sha256();
  const template = defaultCharacter('Template');
  template.id = 'determinism';
  template.skin.layers.forEach((layer, k) => (layer.id = `${layer.kind}-${k + 1}`));
  text.updateText(serializeCharacter(randomizeRealistic(template, assets.sliders, assets, assets.anthro, assets.population, { seed: 7 }).doc));
  for (const member of generateCrowd(assets.sliders, assets, assets.anthro, assets.population, { seed: 99, count: 4 })) text.updateText(serializeCharacter(member.doc));
  out.crowd = text.hex();

  // F25: every expression recipe as a blend of the face units, and the mirror table.
  const units = await assets.faceUnits();
  const shapes = new Sha256();
  for (const e of EXPRESSION_MAP.expressions) shapes.updateArray(units.blend(e.units, assets.base.vertexCount));
  shapes.updateArray(await assets.mirror());
  out.faceUnits = shapes.hex();

  // F28: every shell template on the reference body (positions, triangles, UVs), default parameters.
  for (const t of SHELL_TEMPLATES) {
    const { build } = await buildTemplate(assets, t.id);
    const h = new Sha256().updateArray(Float64Array.from(build.mesh.pos)).updateArray(Uint32Array.from(build.mesh.tris));
    out[`shell:${t.id}`] = h.updateArray(Float64Array.from(build.uv.uvs)).hex();
  }

  // F29: every pattern program on the default body's GarmentCode measurements: its default design and one
  // seeded random design (canonical pattern bytes).
  const gcBody = garmentCodeBody(assets.anthro.measure(evaluator.evaluate(DEFAULT_MACROS)));
  for (const p of patternPrograms()) {
    const h = new Sha256();
    h.updateText(canonicalJSON(buildProgram(p.id, programDefaultDesign(p.id), gcBody).spec));
    const { design } = randomProgramDesign(p.id, new Rng(hashSeed(p.id)), gcBody, 20);
    h.updateText(canonicalJSON(buildProgram(p.id, design, gcBody).spec));
    out[`pattern:${p.id}`] = h.hex();
  }

  // F30, F31: draped on the reference body and built into a PS2 garment (the drape's positions, the coarse
  // garment's positions, triangles and UVs, the fold bake).
  const ref = await shellBody(assets);
  for (const id of DRAPE_HASHED) {
    const m = drapeProgram({ program: id, design: programDefaultDesign(id), measurements: gcBody, body: ref, bodyPositions: ref.hm08 })!;
    const h = new Sha256().updateArray(m.drape.positions).updateArray(Float64Array.from(m.coarse.mesh.pos)).updateArray(Uint32Array.from(m.coarse.mesh.tris));
    h.updateArray(m.coarse.raw.uvs).updateArray(new Uint8Array(m.folds.image.data.buffer, m.folds.image.data.byteOffset, m.folds.image.data.byteLength));
    out[`drape:${id}`] = h.hex();
  }
  return out;
}

/** Programs whose drape is hashed (a jacket with sleeves, collar, bands and pockets; a skirt). */
export const DRAPE_HASHED = ['Bomber', 'SkirtCircle'];
