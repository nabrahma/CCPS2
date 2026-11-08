import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreAssets } from '../src/assets';
import { NodeAssetSource } from '../src/io/node';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');
export const ASSETS_DIR = join(REPO_ROOT, 'assets', 'core');
export const GOLDEN_DIR = join(here, 'fixtures', 'golden');

export const assetsAvailable = existsSync(join(ASSETS_DIR, 'targets', 'targets.json'));
export const goldenAvailable = existsSync(join(GOLDEN_DIR, 'morph.json'));

let cached: Promise<CoreAssets> | null = null;

/** Load compiled assets once per test worker. */
export function loadAssets(): Promise<CoreAssets> {
  if (!assetsAvailable) throw new Error('assets/core is missing: run `pnpm build:assets` first');
  cached ??= CoreAssets.load(new NodeAssetSource(ASSETS_DIR));
  return cached;
}

export function readFloat32(path: string): Float32Array {
  const buf = readFileSync(path);
  const out = new Float32Array(buf.byteLength / 4);
  new Uint8Array(out.buffer).set(buf);
  return out;
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): { max: number; index: number } {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} vs ${b.length}`);
  let max = 0;
  let index = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > max || Number.isNaN(d)) {
      max = Number.isNaN(d) ? Infinity : d;
      index = i;
    }
  }
  return { max, index };
}
