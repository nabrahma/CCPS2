// PRD 6.4 Unity harness: writes the 10 test character exports into
// tests/UnityHarness/Assets/PS2CC (from app/backend/fbx/testdata/characters),
// then runs Unity in batchmode:
//   Unity -batchmode -projectPath tests/UnityHarness -executeMethod PS2CC.Tests.Harness.ImportAll -quit
// Set PS2CC_UNITY to the Unity.exe to use (default: the newest 6000.x editor found).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = join(repo, 'tests', 'UnityHarness');
const testdata = join(repo, 'app', 'backend', 'fbx', 'testdata', 'characters');

function findUnity() {
  if (process.env.PS2CC_UNITY && existsSync(process.env.PS2CC_UNITY)) return process.env.PS2CC_UNITY;
  const roots = ['D:\\Unity Editor', 'C:\\Program Files\\Unity\\Hub\\Editor', 'D:\\Program Files\\Unity\\Hub\\Editor'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).filter((v) => v.startsWith('6000.')).sort().reverse();
    for (const v of versions) {
      const exe = join(root, v, 'Editor', 'Unity.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

const unity = findUnity();
if (!unity) {
  console.error('Unity 6 not found. Set PS2CC_UNITY to Unity.exe.');
  process.exit(1);
}
const files = readdirSync(testdata).filter((f) => f.endsWith('.ps2exp')).map((f) => join(testdata, f));
if (files.length === 0) {
  console.error('No test exports: run `pnpm export:testchars` first.');
  process.exit(1);
}
const out = join(harness, 'Assets', 'PS2CC');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const gen = spawnSync('go', ['run', './cmd/ps2cc-export', '-out', out, ...files], { cwd: join(repo, 'app'), stdio: 'inherit' });
if (gen.status !== 0) process.exit(gen.status ?? 1);

mkdirSync(join(harness, 'Reports'), { recursive: true });
const log = join(harness, 'Reports', 'unity.log');
console.log(`Unity: ${unity}`);
const r = spawnSync(unity, ['-batchmode', '-projectPath', harness, '-executeMethod', 'PS2CC.Tests.Harness.ImportAll', '-logFile', log, '-quit'], { stdio: 'inherit' });
const reportPath = join(harness, 'Reports', 'report.json');
if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  for (const c of report.characters) {
    console.log(`${c.errors.length ? 'FAIL' : 'ok  '} ${c.name}: avatar ${c.avatarValid && c.avatarHuman ? 'Humanoid' : 'INVALID'}, ${c.renderers} renderers, ${c.triangles}/${c.budget} triangles, ${c.blendshapes} blendshapes, ${c.height.toFixed(3)} m, facing +Z ${c.facesPlusZ}, pose stretch ${c.maxPoseStretch.toFixed(2)}${c.errors.length ? ' - ' + c.errors.join('; ') : ''}`);
  }
  for (const e of report.shaderErrors) console.log(`SHADER ${e}`);
  console.log(`${report.failures} failures (Unity ${report.unity}, ${report.pipeline})`);
  // Review copies: retargeted poses (M7) and expression close-ups (M8).
  for (const [milestone, pick] of [
    ['M7', (f) => !/_(face|eye)_/.test(f) && !/Custom/.test(f)],
    ['M8', (f) => /_(face|eye)_/.test(f)],
    ['M10', (f) => /Custom/.test(f) && !/_(face|eye)_/.test(f)],
  ]) {
    const review = join(repo, 'docs', 'milestones', milestone, 'unity');
    rmSync(review, { recursive: true, force: true });
    mkdirSync(review, { recursive: true });
    for (const f of readdirSync(join(harness, 'Reports'))) {
      if (f.endsWith('.png') && pick(f)) copyFileSync(join(harness, 'Reports', f), join(review, f.replace(/ /g, '_')));
    }
    copyFileSync(reportPath, join(review, 'report.json'));
  }
} else {
  console.error(`No report written; see ${log}`);
}
process.exit(r.status ?? 1);
