/**
 * PRD M7 in the real UI: the Export panel builds the export (skin composite,
 * meshes, textures, validated GLB) and hands one message to the backend. In a
 * plain browser there is no backend, so the message is downloaded instead;
 * the test checks it is a well-formed PS2CC export message with the GLB.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { boot, garment, setCharacter } from './helpers';
import { waitForTestHooks } from './skin-helpers';

test('Export panel: export to Unity produces the message with FBX data, textures and a validated GLB', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  await setCharacter(page, { gender: 1 }, { name: 'Panel Test', garments: [garment('mh:clothes/male_worksuit01', 'full')], export: {
    triangleBudget: 12000, hardMax: 15000, headTexture: 1024, bodyTexture: 1024, writeGlb: true, tPose: false, unityProject: 'C:/UnityProject',
  } });
  await page.getByRole('tab', { name: /export/i }).click();
  await expect(page.getByTestId('export-panel')).toBeVisible();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByTestId('export-unity').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Panel Test.ps2exp');
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('PS2CCEX1');
  const len = bytes.readUInt32LE(8);
  const header = JSON.parse(bytes.subarray(12, 12 + len).toString('utf8')) as {
    meshes: { name: string }[];
    materials: { shader: string; texture: string }[];
    textures: { file: string }[];
    glb?: { length: number };
    bones: unknown[];
    sidecar: { budget: { triangles: number } };
  };
  expect(header.meshes.map((m) => m.name)).toEqual(['Panel Test_Head', 'Panel Test_Body', 'Panel Test_Garments', 'Panel Test_Eyes']);
  expect(header.bones).toHaveLength(53);
  expect(header.materials.map((m) => m.shader)).toEqual(['PS2/Skin', 'PS2/Skin', 'PS2/Cloth', 'PS2/Cutout']);
  expect(header.textures.map((t) => t.file)).toContain('Textures/Panel Test_Head_D.png');
  expect(header.glb?.length).toBeGreaterThan(100_000);
  await expect(page.getByTestId('export-result')).toBeVisible();
  await page.screenshot({ path: '../../docs/milestones/M7/ui_export_panel.png' });
});
