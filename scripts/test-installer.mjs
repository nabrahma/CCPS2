#!/usr/bin/env node
// Installer check (PRD M9: "installer installs and runs"): `pnpm test:installer`.
//  1. Silent per-user install of app/build/bin/PS2CC-amd64-installer.exe into a temporary folder.
//  2. The installed files: PS2CC.exe, uninstall.exe, assets\core (catalog, LICENSES.json, a target).
//  3. Start the installed PS2CC.exe with a temporary PS2CC home folder and read its log: it must start
//     with its core assets from the install folder and the UI must load them.
//  4. Silent uninstall: the install folder is gone; the home folder is left alone.
// The installer also adds Start menu and desktop shortcuts and an uninstall entry for the current
// user while the check runs; the uninstall removes them. The clean-VM check is a manual step
// (docs/milestones/M9/installer_vm_check.md).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = join(repo, 'app', 'build', 'bin', 'PS2CC-amd64-installer.exe');
if (!existsSync(installer)) {
  console.error(`no installer at ${installer}: run pnpm build:installer`);
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(repo, 'app', 'wails.json'), 'utf8')).info.productVersion;
const work = mkdtempSync(join(tmpdir(), 'ps2cc-install-'));
const dir = join(work, 'PS2CC');
const home = join(work, 'home');
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Install (NSIS: /S silent; /D= must come last and unquoted).
  const t0 = Date.now();
  const inst = spawnSync(installer, ['/S', `/D=${dir}`], { stdio: 'inherit' });
  check(inst.status === 0, `installer exit code ${inst.status} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // 2. Files.
  for (const f of ['PS2CC.exe', 'uninstall.exe', 'assets/core/catalog.json', 'assets/core/LICENSES.json', 'assets/core/manifest.json', 'assets/core/expressions/face_poseunits.json']) {
    check(existsSync(join(dir, f)), `installed ${f}`);
  }

  // 3. Run the installed app; it logs to %LOCALAPPDATA%\PS2CC\logs\ps2cc-<date>.log.
  const logDir = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local'), 'PS2CC', 'logs');
  const today = new Date();
  const logFile = join(logDir, `ps2cc-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.log`);
  const logBefore = existsSync(logFile) ? readFileSync(logFile, 'utf8').length : 0;
  const app = spawn(join(dir, 'PS2CC.exe'), [], { cwd: dir, env: { ...process.env, PS2CC_HOME: home, PS2CC_ASSETS: '' }, stdio: 'ignore' });
  let started = '';
  let loaded = '';
  for (let i = 0; i < 120 && !(started && loaded); i++) {
    await sleep(1000);
    if (!existsSync(logFile)) continue;
    const fresh = readFileSync(logFile, 'utf8').slice(logBefore);
    started = fresh.split('\n').find((l) => l.includes(`PS2CC ${version}`) && l.includes('started')) ?? '';
    loaded = fresh.split('\n').find((l) => l.includes('[ui] assets loaded')) ?? '';
  }
  check(Boolean(started), `installed app started: ${started.trim()}`);
  check(started.toLowerCase().includes(join(dir, 'assets', 'core').toLowerCase()), 'core assets come from the install folder');
  check(Boolean(loaded), `UI loaded the assets: ${loaded.trim()}`);
  check(existsSync(join(home, 'Characters')) && existsSync(join(home, 'Library')), 'user folders created in the PS2CC home folder');
  if (app.pid) spawnSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' });
  await sleep(1500);

  // 4. Uninstall (_?= runs it in place and waits).
  const un = spawnSync(join(dir, 'uninstall.exe'), ['/S', `_?=${dir}`], { stdio: 'inherit' });
  check(un.status === 0, `uninstaller exit code ${un.status}`);
  check(!existsSync(join(dir, 'PS2CC.exe')) && !existsSync(join(dir, 'assets')), 'program files removed');
  check(existsSync(join(home, 'Characters')), 'the user home folder is left alone');
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failures.length ? `${failures.length} failures` : 'installer check passed');
process.exit(failures.length ? 1 : 0);
