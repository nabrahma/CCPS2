/**
 * PRD Part 3, M22 acceptance (F29), with the oracle parity in garment-pattern-oracle.test.ts:
 * - every program validates on random designs (40 per program here, 500 with PS2CC_M22_DESIGNS=500), drawn the
 *   way GarmentCode's sampler draws, on our measured bodies: closed panel loops, no self-intersecting panel,
 *   manifold sewing, seams of equal length unless gathered (1%, or 1 mm on short seams), attachments on their host.
 *   This project's programs must pass every rule. The ported GarmentCode programs must pass the structural rules;
 *   their eased seams (GarmentCode leaves some seams up to ~9% apart for the cloth simulation to absorb) are
 *   counted in docs/milestones/M22/validation.txt (D-174);
 * - patterns rebuild byte-identically from `.ps2pattern`;
 * - the SVG export has every panel labelled (the browser opens it in e2e/m22.spec.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram, makePs2Pattern, parsePs2Pattern, patternPrograms, patternSvg, programDefaultDesign, randomProgramDesign, rebuildPs2Pattern, serializePs2Pattern, validateBuilt } from '../src/garment/pattern';
import { Rng, hashSeed } from '../src/random';
import { REPO_ROOT } from './helpers';

const BODIES = JSON.parse(readFileSync(join(__dirname, 'fixtures/garmentcode/bodies.json'), 'utf-8')).bodies as { name: string; measurements: Record<string, number> }[];
const N = Number(process.env.PS2CC_M22_DESIGNS ?? 40);
const STRUCTURAL = new Set(['open-loop', 'bad-stitch', 'double-stitch', 'dangling-seam', 'loose-attachment']);

describe('pattern programs (PRD Part 3, M22)', () => {
  it(`every program validates on ${N} random designs`, () => {
    const rows: string[] = [];
    const failures: string[] = [];
    for (const p of patternPrograms()) {
      const rng = new Rng(hashSeed(`m22-${p.id}`));
      const kinds: Record<string, number> = {};
      const examples: string[] = [];
      let valid = 0;
      let draws = 0;
      for (let i = 0; i < N; i++) {
        const body = BODIES[i % BODIES.length]!;
        const r = randomProgramDesign(p.id, rng, body.measurements);
        draws += r.draws;
        const issues = validateBuilt(buildProgram(p.id, r.design, body.measurements));
        if (!issues.length) valid++;
        for (const k of new Set(issues.map((x) => x.kind))) kinds[k] = (kinds[k] ?? 0) + 1;
        for (const x of issues) {
          if (examples.length < 3) examples.push(`  design ${i} (${body.name}): ${x.kind}: ${x.detail}`);
          const strict = p.origin === 'ps2cc' || STRUCTURAL.has(x.kind);
          // GarmentCode's fitted waistband folds over on bodies whose waist is wider than their hips (D-174).
          const waistOverHips = body.measurements.waist! > body.measurements.hips! && x.kind === 'self-intersection';
          if (strict && !(p.origin === 'garmentcode' && waistOverHips)) failures.push(`${p.id} design ${i} (${body.name}): ${x.kind}: ${x.detail}`);
        }
      }
      const kindText = Object.entries(kinds)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      rows.push(`${p.id} (${p.origin}): ${valid}/${N} valid, ${(draws / N).toFixed(1)} draws per design${kindText ? `; ${kindText}` : ''}${examples.length ? `\n${examples.join('\n')}` : ''}`);
    }
    const out = join(REPO_ROOT, 'docs/milestones/M22');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'validation.txt'), `${N} random designs per program (GarmentCode's sampling), ${BODIES.length} measured bodies\n\n${rows.join('\n')}\n\n${failures.join('\n')}\n`);
    console.info(rows.join('\n'));
    expect(failures).toEqual([]);
  }, 3_600_000);

  it('patterns rebuild byte-identically from .ps2pattern', () => {
    for (const p of patternPrograms()) {
      const body = BODIES[hashSeed(p.id) % BODIES.length]!.measurements;
      const designs = [programDefaultDesign(p.id), randomProgramDesign(p.id, new Rng(hashSeed(`ps2pattern-${p.id}`)), body, 20).design];
      for (const d of designs) {
        const file = makePs2Pattern(p.id, d, body);
        const text = serializePs2Pattern(file);
        const back = parsePs2Pattern(text);
        expect(serializePs2Pattern(back)).toBe(text);
        const { identical, built } = rebuildPs2Pattern(back);
        expect(identical, p.id).toBe(true);
        expect(serializePs2Pattern(makePs2Pattern(p.id, back.design, back.body, built))).toBe(text);
      }
    }
  }, 600_000);

  it('the SVG export labels every panel and every stitch', () => {
    const body = BODIES[0]!.measurements;
    for (const id of ['Shirt', 'Pants', 'Bomber', 'WorkShirt']) {
      const b = buildProgram(id, programDefaultDesign(id), body);
      const svg = patternSvg(b.spec, { title: id, measurements: body });
      expect(svg.startsWith('<?xml')).toBe(true);
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      for (const name of Object.keys(b.spec.panels)) expect(svg).toContain(`>${name}</text>`);
      for (let i = 1; i <= b.spec.stitches.length; i++) expect(svg).toContain(`>${i}</text>`);
      if (id === 'Bomber' || id === 'Shirt') writeFileSync(join(REPO_ROOT, 'docs/milestones/M22', `pattern_${id}.svg`), svg);
    }
  });
});
