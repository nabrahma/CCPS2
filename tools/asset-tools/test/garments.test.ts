/** PRD F4: decimated garments keep valid MHCLO bindings (subset of vertices) and fit identically. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BaseMesh, Container, ProxyAsset, type ProxyMeta } from '@ps2cc/core';
import { NodeAssetSource } from '@ps2cc/core/node';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '../../../assets/core');
const catalogPath = join(ASSETS, 'catalog.json');
const ready = existsSync(catalogPath) && JSON.parse(readFileSync(catalogPath, 'utf8')).proxies.some((p: { fullFile?: string }) => p.fullFile);
const suite = ready ? describe : describe.skip;

interface Entry {
  id: string;
  category: string;
  file: string;
  fullFile?: string;
  triangles: number;
  overBudget?: boolean;
}

suite('decimated garments', () => {
  const source = new NodeAssetSource(ASSETS);
  const entries = ready ? (JSON.parse(readFileSync(catalogPath, 'utf8')).proxies as Entry[]).filter((p) => p.category === 'clothes') : [];

  it('almost every garment is within the 2,500-triangle PS2 target', () => {
    const over = entries.filter((e) => e.overBudget);
    expect(over.length).toBeLessThanOrEqual(Math.ceil(entries.length * 0.05));
    for (const e of entries) expect(e.triangles, e.id).toBeGreaterThan(0);
  });

  it('kept vertices carry the original binding and fit to the same positions', async () => {
    const base = await BaseMesh.load(source);
    for (const e of entries.slice(0, 40)) {
      const full = await ProxyAsset.load(source, e.fullFile!);
      const decMeta = JSON.parse(readFileSync(join(ASSETS, e.file), 'utf8')) as ProxyMeta;
      const bin = readFileSync(join(ASSETS, dirname(e.file), decMeta.binary));
      const container = new Container(decMeta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
      const dec = new ProxyAsset(container);
      const map = container.get('sourceProxyVertex', 'u32');
      expect(map.length).toBe(dec.vertexCount);
      const a = full.fit(base.positions);
      const b = dec.fit(base.positions);
      for (let i = 0; i < map.length; i++) {
        const s = map[i]!;
        expect(s).toBeLessThan(full.vertexCount);
        for (let k = 0; k < 3; k++) {
          expect(dec.refVerts[i * 3 + k]).toBe(full.refVerts[s * 3 + k]);
          expect(b[i * 3 + k]).toBeCloseTo(a[s * 3 + k]!, 6);
        }
      }
    }
  });
});
