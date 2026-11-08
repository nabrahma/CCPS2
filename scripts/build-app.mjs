#!/usr/bin/env node
// Build PS2CC.exe: `pnpm build`. Links ufbx through cgo for FBX garment import (PRD F4).
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cgoEnv } from './cgo-env.mjs';

const app = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'app');
const r = spawnSync('wails', ['build', '-clean', '-platform', 'windows/amd64', '-tags', 'ufbx'], { cwd: app, env: cgoEnv(), stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
