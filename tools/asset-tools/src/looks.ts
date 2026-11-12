/**
 * The shipped looks (PRD Part 2, F14): one `.ps2look` per look and the LUTs the
 * graded ones use, generated from @ps2cc/core's grading controls and written
 * to assets/core/looks/. Run with `pnpm build:looks`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeLut, LOOK_IDS, LOOKS, serializeLook, SHIPPED_GRADES, writeCube } from '@ps2cc/core';
import { registerDerivedFiles } from './licenses';

export function buildLooks(assetsDir: string): string[] {
  const dir = join(assetsDir, 'looks');
  mkdirSync(dir, { recursive: true });
  const files: { file: string; asset: string; generated: true }[] = [];
  for (const [id, g] of Object.entries(SHIPPED_GRADES)) {
    writeFileSync(join(assetsDir, g.file), writeCube(gradeLut(g.controls, 32, `PS2CC ${LOOKS[id as keyof typeof LOOKS].label}`)));
    files.push({ file: g.file, asset: `ps2cc:look/${id}`, generated: true });
  }
  for (const id of LOOK_IDS) {
    const look = LOOKS[id];
    if (look.grade.lut && !Object.values(SHIPPED_GRADES).some((g) => g.file === look.grade.lut)) throw new Error(`${id}: no generated LUT ${look.grade.lut}`);
    const file = `looks/${id}.ps2look`;
    writeFileSync(join(assetsDir, file), serializeLook(look));
    files.push({ file, asset: `ps2cc:look/${id}`, generated: true });
  }
  registerDerivedFiles(assetsDir, files);
  return files.map((f) => f.file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/core');
  console.info(`looks: ${buildLooks(assets).join(', ')}`);
}
