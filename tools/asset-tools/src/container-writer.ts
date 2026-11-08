/** Writes the shared binary container to disk (same "PSCB" layout as ps2cc_assets/binfmt.py). */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { ContainerBuilder } from '@ps2cc/core';

export class ContainerWriter extends ContainerBuilder {
  /** Write `<base>.json` and `<base>.bin`; returns sha256 of both files. */
  write(base: string, meta: Record<string, unknown>): { json: string; bin: string } {
    mkdirSync(dirname(base), { recursive: true });
    const { bin, table } = this.finish(`${basename(base)}.bin`);
    writeFileSync(`${base}.bin`, bin);
    const json = JSON.stringify({ ...meta, ...table }, null, 1) + '\n';
    writeFileSync(`${base}.json`, json);
    return { json: sha256(json), bin: sha256(bin) };
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
