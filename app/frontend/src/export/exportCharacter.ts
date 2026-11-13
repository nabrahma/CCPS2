/**
 * Export (PRD 6.3): build the export scene, encode the textures, optionally
 * write and validate the GLB, and send everything to the backend in one binary
 * message; the backend writes the FBX and the files into the Unity project.
 */
import { buildExportScene, encodeExportMessage, fbxTime, type ExportScene } from '@ps2cc/core';
import { resolveAssetUrl } from '@ps2cc/viewport';
import { backend, type ExportResult } from '../backend';
import { decodeImage, imageToPng } from '../images';
import { currentHeadSkin, currentSkin } from '../skin';
import type { Studio } from '../state/studio';
import { buildGlb } from './glb';

export interface ExportOptions {
  /** Folder to export into; "" uses <Unity project>/Assets/PS2CC from the settings. */
  target: string;
  glb: boolean;
  tPose: boolean;
  /** Export even when the triangle count is above the hard maximum (PRD F11 override). */
  overrideBudget?: boolean;
  onProgress?: (step: string) => void;
  cancelled?: () => boolean;
}

export interface ExportOutcome {
  result: ExportResult;
  scene: ExportScene;
  glbWarnings: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** The export scene and its encoded message (no files written): used by the export and the test tools. */
export async function prepareExport(studio: Studio, opts: Pick<ExportOptions, 'glb' | 'tPose' | 'onProgress' | 'cancelled'>, creationTime = fbxTime(new Date())) {
  const step = (s: string) => {
    if (opts.cancelled?.()) throw new ExportCancelled();
    opts.onProgress?.(s);
  };
  if (studio.engine.doc.export.bakeAO || studio.engine.doc.export.bakeLight) {
    step('Baking occlusion');
    await studio.bakeSettled();
  }
  step('Compositing the skin');
  const skin = await currentSkin(studio);
  const headSkin = await currentHeadSkin(studio, skin);
  step('Building meshes and skeleton');
  const scene = await buildExportScene(studio.scene, {
    loadImage: (url) => decodeImage(resolveAssetUrl(studio.info.coreAssetsUrl, url)),
    skin,
    headSkin,
    tPose: opts.tPose,
    appVersion: studio.info.version,
    baked: (key) => studio.bakedImage(key),
  });
  step('Encoding textures');
  const pngs: Uint8Array[] = [];
  for (const t of scene.textures) pngs.push(new Uint8Array(await (await imageToPng(t.image)).arrayBuffer()));
  let glb: Uint8Array | null = null;
  let glbWarnings = 0;
  if (opts.glb) {
    step('Writing and validating the GLB');
    const g = await buildGlb(scene);
    if (g.errors > 0) throw new Error(`glTF-Validator found ${g.errors} errors in the GLB:\n${g.messages.join('\n')}`);
    glb = g.bytes;
    glbWarnings = g.warnings;
  }
  step('Packing');
  const message = encodeExportMessage(scene, pngs, creationTime, glb);
  return { scene, message, glbWarnings };
}

export async function exportCharacter(studio: Studio, opts: ExportOptions): Promise<ExportOutcome> {
  const budget = studio.scene.budget();
  if (budget.exportBlocked && !opts.overrideBudget) {
    throw new Error(`The character has ${budget.total.toLocaleString()} triangles, above the hard maximum of ${budget.hardMax.toLocaleString()}. Remove parts or override.`);
  }
  const { scene, message, glbWarnings } = await prepareExport(studio, opts);
  if (opts.cancelled?.()) throw new ExportCancelled();
  opts.onProgress?.('Writing the FBX and files');
  const result = await backend.exportCharacter(message, opts.target, scene.name);
  return { result, scene, glbWarnings };
}
