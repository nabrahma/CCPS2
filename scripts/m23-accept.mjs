// PRD Part 3, M23 acceptance run: 50 designs of every pattern program on both benchmark bodies (Mara and
// Cole), each draped and built into a PS2 garment. Programs run in parallel, one vitest process each
// (packages/core/test/m23.test.ts with PS2CC_M23_OUT set), then the results are summarised in
// docs/milestones/M23/drape.txt.
//   node scripts/m23-accept.mjs [designs=50] [programs=all]
//   node scripts/m23-accept.mjs --summary [designs=50]   (summarise the results already in results/)
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = join(repo, 'packages', 'core');
const results = join(repo, 'docs', 'milestones', 'M23', 'results');
const summaryOnly = process.argv[2] === '--summary';
const args = summaryOnly ? process.argv.slice(3) : process.argv.slice(2);
const designs = Number(args[0] ?? 50);
const PROGRAMS = ['FittedShirt', 'Shirt', 'Pants', 'SkirtCircle', 'AsymmSkirtCircle', 'GodetSkirt', 'Skirt2', 'SkirtManyPanels', 'PencilSkirt', 'SkirtLevels', 'StraightWB', 'FittedWB', 'Bomber', 'Coat', 'UtilityVest', 'Hoodie', 'WorkShirt'];
const programs = !summaryOnly && args[1] ? args[1].split(',') : PROGRAMS;
const parallel = Math.max(1, Math.min(programs.length, cpus().length - 1));

if (!summaryOnly) {
  for (const id of programs) rmSync(join(results, `${id}.json`), { force: true });
}
mkdirSync(results, { recursive: true });
const queue = summaryOnly ? [] : [...programs];
let running = 0;
const t0 = Date.now();
await new Promise((done) => {
  const next = () => {
    if (!queue.length && running === 0) return done();
    while (running < parallel && queue.length) {
      const id = queue.shift();
      running++;
      const child = spawn(process.execPath, [join(core, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'test/m23.test.ts'], {
        cwd: core,
        env: { ...process.env, PS2CC_M23_PROGRAMS: id, PS2CC_M23_DESIGNS: String(designs), PS2CC_M23_BODIES: 'mara,cole', PS2CC_M23_OUT: '1' },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      child.on('exit', (code) => {
        running--;
        console.log(`${id}: done (exit ${code}) after ${((Date.now() - t0) / 60000).toFixed(1)} min`);
        next();
      });
    }
  };
  next();
});

// Summary.
const rows = readdirSync(results)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(results, f), 'utf8')));
// Results written before the cloth area was recorded: the fold check stands as it was then.
const by = new Map();
for (const r of rows) {
  if (!by.has(r.program)) by.set(r.program, []);
  by.get(r.program).push(r);
}
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
};
const lines = [];
lines.push(`M23 drape acceptance: ${designs} designs per program (the default and seeded random designs) on Mara and Cole; ${rows.length} drapes.`);
lines.push('Per program: drapes passing every check; worst seam gap and penetration (mm); woven stretch along the threads (mean of the per-drape means, worst mean, worst 95th percentile, %); worst texel spread (%); lowest fold deviation; triangles (max); drape time (median / max, s).');
lines.push('');
let pass = 0;
for (const id of PROGRAMS) {
  const rs = by.get(id) ?? [];
  if (!rs.length) continue;
  const ok = rs.filter((r) => !r.failures.length).length;
  pass += ok;
  const mx = (k) => Math.max(...rs.map((r) => r[k]));
  const mn = (k) => Math.min(...rs.map((r) => r[k]));
  const mean = (k) => rs.reduce((s, r) => s + r[k], 0) / Math.max(1, rs.length);
  lines.push(
    `${id}: ${ok}/${rs.length} pass; gap ${mx('seamGapMm').toFixed(2)}, pen ${mx('penetrationMm').toFixed(2)}; stretch ${(mean('strainMean') * 100).toFixed(2)} / ${(mx('strainMean') * 100).toFixed(2)} / ${(mx('strainP95') * 100).toFixed(1)}; texel ${(mx('texelSpread') * 100).toFixed(1)}; folds ${mn('foldDeviation').toFixed(3)}; tris ${mx('triangles')}; drape ${(pct(rs.map((r) => r.drapeMs), 0.5) / 1000).toFixed(1)} / ${(mx('drapeMs') / 1000).toFixed(1)}`,
  );
  const reasons = new Map();
  for (const r of rs) for (const f of r.failures) {
    const k = f.replace(/[0-9.]+/g, '#');
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  for (const [k, n] of reasons) lines.push(`    ${n} x ${k}`);
}
lines.push('');
lines.push(`Total: ${pass}/${rows.length} drapes pass every check. Drape time: median ${(pct(rows.map((r) => r.drapeMs), 0.5) / 1000).toFixed(1)} s, 95th percentile ${(pct(rows.map((r) => r.drapeMs), 0.95) / 1000).toFixed(1)} s, max ${(Math.max(...rows.map((r) => r.drapeMs)) / 1000).toFixed(1)} s (target 10 s), with 15 drapes running at once.${summaryOnly ? '' : ` Run time ${((Date.now() - t0) / 60000).toFixed(1)} min on ${parallel} processes.`}`);
writeFileSync(join(repo, 'docs', 'milestones', 'M23', 'drape.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
