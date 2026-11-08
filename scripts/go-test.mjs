// Runs the Go tests with the ufbx read-back tests enabled (PRD 6.3): cgo with
// the 64-bit mingw-w64 compiler (TOOLCHAIN.md) and the "ufbx" build tag.
// Set PS2CC_CC to use another compiler. Extra arguments go to `go test`.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cgoEnv } from './cgo-env.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const env = cgoEnv();
const args = ['test', '-tags', 'ufbx', ...(process.argv.length > 2 ? process.argv.slice(2) : ['./...'])];
console.log(`go ${args.join(' ')}  (CC=${env.CC})`);
const r = spawnSync('go', args, { cwd: app, env, stdio: 'inherit', shell: false });
process.exit(r.status ?? 1);
