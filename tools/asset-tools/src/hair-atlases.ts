/**
 * The built-in hair card atlases, written to assets/core/textures/hair:
 *
 *  - Hair v2 (PRD F15): one greyscale strand atlas per strand preset, baked
 *    from 3D strands by @ps2cc/core's atlas baker (hair/strand-atlas.ts), with
 *    its flow map. Hair colour comes from a gradient map, so one atlas serves
 *    every colour.
 *  - Part 1's coloured card atlases (hair/card-texture.ts), kept for hair made
 *    before v2.
 *
 * Run alone with `pnpm build:hair`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bakeStrandAtlas,
  CARD_TEXTURE_COLOURS,
  defaultCardTexture,
  generateCardTexture,
  STRAND_PRESET_PARAMS,
  STRAND_PRESETS,
  type AtlasSpec,
  type Catalog,
  type CatalogHairAtlas,
  type RgbaImage,
} from '@ps2cc/core';
import { registerDerivedFiles } from './licenses';
import { Canvas } from './png';

export type BuiltInAtlas = CatalogHairAtlas;

/** Size of the shipped v2 atlases. */
export const STRAND_ATLAS_SIZE = 1024;

/** Write the generated atlases and their licence rows; returns their catalog entries, the v2 ones first. */
export function buildHairAtlases(assetsDir: string): BuiltInAtlas[] {
  const out: BuiltInAtlas[] = [];
  const files: { file: string; asset: string; generated: true }[] = [];
  const write = (file: string, img: RgbaImage) => {
    const canvas = new Canvas(img.width, img.height);
    canvas.data.set(img.data);
    mkdirSync(dirname(join(assetsDir, file)), { recursive: true });
    writeFileSync(join(assetsDir, file), canvas.toPng());
  };
  for (const preset of STRAND_PRESETS) {
    const { value, flow, regions } = bakeStrandAtlas(preset, STRAND_ATLAS_SIZE);
    const texture = `textures/hair/strands_${preset}.png`;
    const flowFile = `textures/hair/strands_${preset}_flow.png`;
    write(texture, value);
    write(flowFile, flow);
    const id = `ps2cc:atlas/strands_${preset}`;
    files.push({ file: texture, asset: id, generated: true }, { file: flowFile, asset: id, generated: true });
    const atlas: AtlasSpec = { format: 'ps2cc.atlas/1', texture, regions, greyscale: true, flow: flowFile };
    out.push({ id, name: `Strands: ${STRAND_PRESET_PARAMS[preset].name}`, atlas, licence: 'CC0-1.0', strands: preset });
  }
  for (const [key, colour] of Object.entries(CARD_TEXTURE_COLOURS)) {
    const { image, regions } = generateCardTexture(defaultCardTexture(key));
    const texture = `textures/hair/cards_${key}.png`;
    write(texture, image);
    const id = `ps2cc:atlas/cards_${key}`;
    files.push({ file: texture, asset: id, generated: true });
    out.push({ id, name: `Hair cards: ${colour.name}`, atlas: { format: 'ps2cc.atlas/1', texture, regions }, licence: 'CC0-1.0' });
  }
  registerDerivedFiles(assetsDir, files);
  return out;
}

// Run directly: refresh the atlases and their catalog entries without rebuilding the meshes.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/core');
  const catalogPath = join(assets, 'catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog;
  const generated = buildHairAtlases(assets);
  const ours = (id: string) => id.startsWith('ps2cc:atlas/cards_') || id.startsWith('ps2cc:atlas/strands_');
  const kept = (catalog.hairAtlases ?? []).filter((a) => !ours(a.id));
  catalog.hairAtlases = [...generated, ...kept];
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');
  console.info(`hair atlases: ${generated.map((a) => a.id).join(', ')}`);
}
