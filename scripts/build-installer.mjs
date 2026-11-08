#!/usr/bin/env node
// Build the PS2CC installer (PRD M9: Wails NSIS): `pnpm build:installer`.
// Needs NSIS's makensis: $PS2CC_MAKENSIS, the portable NSIS in tools/.toolcache/nsis-3.11,
// the PATH, or a normal NSIS install (TOOLCHAIN.md). The NSIS script is app/build/windows/installer/project.nsi.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cgoEnv } from './cgo-env.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.PS2CC_MAKENSIS,
  join(repo, 'tools', '.toolcache', 'nsis-3.11', 'makensis.exe'),
  ...(process.env.PATH ?? '').split(delimiter).map((d) => join(d, 'makensis.exe')),
  'C:\\Program Files (x86)\\NSIS\\makensis.exe',
  'C:\\Program Files\\NSIS\\makensis.exe',
].filter(Boolean);
const makensis = candidates.find((p) => existsSync(p));
if (!makensis) {
  console.error('makensis.exe not found. Install NSIS 3.11 (TOOLCHAIN.md) or set PS2CC_MAKENSIS.');
  process.exit(1);
}
console.log(`makensis: ${makensis}`);
const base = cgoEnv();
const env = { ...base, PATH: `${dirname(makensis)}${delimiter}${base.PATH}` };
const r = spawnSync('wails', ['build', '-clean', '-nsis', '-trimpath', '-tags', 'ufbx'], { cwd: join(repo, 'app'), env, stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);
const out = join(repo, 'app', 'build', 'bin', 'PS2CC-amd64-installer.exe');
if (!existsSync(out)) {
  console.error(`installer not written: ${out}`);
  process.exit(1);
}
console.log(`installer: ${out} (${(statSync(out).size / 2 ** 20).toFixed(1)} MB)`);
