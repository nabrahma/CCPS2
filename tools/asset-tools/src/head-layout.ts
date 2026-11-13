/**
 * The head texture's UV layouts (PRD Part 2 F19, M14): for each PS2 body mesh,
 * its head islands re-flattened with the face enlarged to fill the head
 * texture (@ps2cc/core skin/headpack.ts). They depend only on the shipped
 * meshes and take a few seconds each, so they are solved here and stored in
 * assets/core/skin/head/<mesh>.json. Run with `pnpm build:headlayout`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHeadLayout, CoreAssets, headLayoutFile, headLayoutPath, headMeshOf } from '@ps2cc/core';
import { NodeAssetSource } from '@ps2cc/core/node';
import { registerDerivedFiles } from './licenses';

export async function buildHeadLayouts(assetsDir: string): Promise<string[]> {
  const assets = await CoreAssets.load(new NodeAssetSource(assetsDir));
  const layout = assets.skinComposer.layout;
  mkdirSync(join(assetsDir, 'skin', 'head'), { recursive: true });
  const files: { file: string; asset: string }[] = [];
  for (const { id } of assets.catalog.bodyMeshes ?? []) {
    const mesh = await assets.bodyMesh(id)!;
    const head = computeHeadLayout(layout, assets.base, headMeshOf(layout, mesh));
    const file = headLayoutPath(id);
    writeFileSync(join(assetsDir, file), `${JSON.stringify(headLayoutFile(id, head))}\n`);
    files.push({ file, asset: `ps2cc:skin/head/${id}` });
  }
  registerDerivedFiles(assetsDir, files);
  return files.map((f) => f.file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/core');
  console.info(`head layouts: ${(await buildHeadLayouts(assets)).join(', ')}`);
}
