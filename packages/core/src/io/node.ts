/**
 * Node-only asset source for tests and build tools. Not exported from the main
 * entry point so the engine stays browser-safe.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AssetSource } from './source';

export class NodeAssetSource implements AssetSource {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async readText(path: string): Promise<string> {
    return readFile(join(this.root, path), 'utf8');
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const buf = await readFile(join(this.root, path));
    // Copy into a standalone ArrayBuffer (Node Buffers may share a pool).
    const out = new ArrayBuffer(buf.byteLength);
    new Uint8Array(out).set(buf);
    return out;
  }
}
