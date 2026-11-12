// The benchmark board (PRD Part 2 section 4): `pnpm bench`.
//
// 1. App: render Mara and Cole in every quality profile, under the two
//    benchmark looks, from the four benchmark cameras; save parity renders,
//    the cameras (views.json) and an export per character and profile
//    (app/frontend/e2e/tools/bench.spec.ts).
// 2. Unity (when installed): turn the exports into Unity folders, import them
//    in tests/UnityHarness and render every view with the same camera, look
//    and grade (PS2CC.Tests.Bench.Run).
// 3. Compare: app-to-Unity SSIM per view (passes at 0.9), diff images, one
//    contact sheet per character with the private references from refs/,
//    the regression check against docs/bench/accepted, a score template.
//
// Output: docs/bench/latest/. Accept a board by copying it to docs/bench/accepted/
// (`pnpm bench -- --accept`) and record scores in docs/bench/scores.json.
// Set PS2CC_UNITY to Unity.exe; PS2CC_BENCH_SKIP_UNITY=1 skips step 2.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = join(repo, 'docs', 'bench', 'latest');
const harness = join(repo, 'tests', 'UnityHarness');

if (process.argv.includes('--accept')) {
  const accepted = join(repo, 'docs', 'bench', 'accepted');
  if (!existsSync(join(run, 'app'))) {
    console.error('No board to accept: run `pnpm bench` first.');
    process.exit(1);
  }
  rmSync(accepted, { recursive: true, force: true });
  mkdirSync(accepted, { recursive: true });
  cpSync(join(run, 'app'), join(accepted, 'app'), { recursive: true });
  for (const f of readdirSync(run)) if (/^board_.*\.png$|views\.json|bench_report\.json/.test(f)) copyFileSync(join(run, f), join(accepted, f));
  console.log(`Accepted the board in ${accepted}`);
  process.exit(0);
}

function step(label, cmd, args, opts = {}) {
  console.log(`\n== ${label}`);
  const shell = opts.shell ?? (process.platform === 'win32' && cmd === 'pnpm');
  // Through a shell, arguments with spaces (this repo may live in a folder like "D:\For coding") must be quoted.
  const argv = shell ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts, shell });
  if (r.status !== 0) {
    console.error(`${label} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function findUnity() {
  if (process.env.PS2CC_UNITY && existsSync(process.env.PS2CC_UNITY)) return process.env.PS2CC_UNITY;
  for (const root of ['D:\\Unity Editor', 'C:\\Program Files\\Unity\\Hub\\Editor', 'D:\\Program Files\\Unity\\Hub\\Editor']) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).filter((x) => x.startsWith('6000.')).sort().reverse()) {
      const exe = join(root, v, 'Editor', 'Unity.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

const env = { ...process.env, PS2CC_BENCH_DIR: run };
// --skip-app reuses the app half of the last run (to redo the Unity half or the comparison).
if (!process.argv.includes('--skip-app')) {
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true });
  step('App renders and exports', 'pnpm', ['--filter', '@ps2cc/app-frontend', 'exec', 'playwright', 'test', '-c', 'playwright.tools.config.ts', 'bench'], { cwd: repo, env });
}

const unity = process.env.PS2CC_BENCH_SKIP_UNITY === '1' ? null : findUnity();
if (unity) {
  const bench = join(harness, 'Assets', 'PS2CC', 'Bench');
  rmSync(bench, { recursive: true, force: true });
  mkdirSync(join(bench, 'Looks'), { recursive: true });
  const exports = readdirSync(join(run, 'exports')).filter((f) => f.endsWith('.ps2exp')).map((f) => join(run, 'exports', f));
  step('Unity export folders', 'go', ['run', './cmd/ps2cc-export', '-out', bench, ...exports], { cwd: join(repo, 'app') });
  const looks = join(repo, 'assets', 'core', 'looks');
  for (const f of readdirSync(looks)) copyFileSync(join(looks, f), join(bench, 'Looks', f));
  mkdirSync(join(harness, 'Reports'), { recursive: true });
  step('Unity renders', unity, ['-batchmode', '-projectPath', harness, '-executeMethod', 'PS2CC.Tests.Bench.Run', '-logFile', join(harness, 'Reports', 'bench.log'), '-quit'], { env, shell: false });
} else {
  console.log('\n== Unity renders skipped (Unity 6 not found or PS2CC_BENCH_SKIP_UNITY=1)');
}

step('Parity, boards and regression', 'pnpm', ['--filter', '@ps2cc/asset-tools', 'exec', 'tsx', 'src/bench.ts', run], { cwd: repo });
console.log(`\nBoard: ${run}\nScore it in docs/bench/scores.json (template: score_template.json); accept it with \`pnpm bench -- --accept\`.`);
