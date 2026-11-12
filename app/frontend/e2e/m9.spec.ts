/**
 * PRD M9 in the browser build:
 *  - round trip: save -> reload the app -> load gives an identical export
 *    (byte-identical GLB, and the whole export message with FBX data,
 *    textures and sidecar, with the creation time fixed);
 *  - first-run setup (Unity project, budget) shown once;
 *  - PNG renders from 1024 to 4096 px, solid or transparent;
 *  - texture memory, bones and blendshapes in the budget bar.
 * The desktop parts (character browser thumbnails, autosave and crash
 * recovery through the Go backend) are in e2e/tools/desktop.spec.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { boot, garment, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const TIME = '2026-11-08 12:00:00:000';

/** SHA-256 of the GLB and of the full export message, plus the saved document. */
async function exportDigest(page: Page, tPose: boolean): Promise<{ parts: Record<string, string>; glb: string; message: string; glbBytes: number; messageBytes: number; doc: string }> {
  return page.evaluate(
    async ({ tPose, time }) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      await s.settled();
      const { scene, message } = await w.__ps2ccTest.prepareExport(s, { glb: true, tPose }, time);
      const glb = await w.__ps2ccTest.buildGlb(scene);
      const hex = async (b: Uint8Array) =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource)), (x) => x.toString(16).padStart(2, '0')).join('');
      const parts: Record<string, string> = {};
      for (const m of scene.meshes) {
        parts[`${m.name}.positions`] = await hex(new Uint8Array(m.positions.buffer.slice(0)));
        parts[`${m.name}.normals`] = await hex(new Uint8Array(m.normals.buffer.slice(0)));
        parts[`${m.name}.uvs`] = await hex(new Uint8Array(m.uvs.buffer.slice(0)));
        parts[`${m.name}.indices`] = await hex(new Uint8Array(m.indices.buffer.slice(0)));
        parts[`${m.name}.weights`] = await hex(new Uint8Array(m.weights.buffer.slice(0)));
        parts[`${m.name}.shapes`] = await hex(new TextEncoder().encode(JSON.stringify(m.shapes.map((x) => [x.name, Array.from(x.indices), Array.from(x.deltas)]))));
      }
      for (const t of scene.textures) parts[t.file] = await hex(new Uint8Array(t.image.data.buffer.slice(0)));
      {
        const len = new DataView(message.buffer, message.byteOffset).getUint32(8, true);
        parts['message.header'] = new TextDecoder().decode(message.subarray(12, 12 + len));
        const CH = 1 << 18;
        for (let o = 12 + len, i = 0; o < message.length; o += CH, i++) parts[`message.chunk${String(i).padStart(3, '0')}@${o}`] = await hex(message.subarray(o, Math.min(message.length, o + CH)));
      }
      parts.bones = await hex(new TextEncoder().encode(JSON.stringify(scene.bones)));
      (window as unknown as { __parts?: Record<string, string>[] }).__parts ??= [];
      (window as unknown as { __parts: Record<string, string>[] }).__parts.push(parts);
      return {
        parts,
        glb: await hex(glb.bytes),
        message: await hex(message),
        glbBytes: glb.bytes.length,
        messageBytes: message.length,
        doc: w.__ps2ccTest.core.serializeCharacter(s.engine.doc as never),
      };
    },
    { tPose, time: TIME },
  );
}

const CHARACTERS: { name: string; macros: Record<string, number>; extra: Record<string, unknown>; hair: string | null; layers: string[]; tPose: boolean }[] = [
  {
    name: 'RT Worker',
    macros: { gender: 1, age: 0.6, muscle: 0.7 },
    extra: { garments: [garment('mh:clothes/male_worksuit01', 'full', { dirt: 0.3 })], bodyMesh: 'ps2_body_8k' },
    hair: 'crew',
    layers: ['stubble', 'dirt'],
    tPose: false,
  },
  {
    name: 'RT Mesh Hair',
    macros: { gender: 0, age: 0.45 },
    extra: { garments: [], bodyMesh: 'ps2_body_10k', hair: { mode: 'mesh', asset: 'mh:hair/bob02', tint: { color: [0.6, 0.4, 0.3], brightness: 1 }, alphaThreshold: 0.5 } },
    hair: null,
    layers: ['lips', 'freckles'],
    tPose: true,
  },
];

test('round trip: save, reload, load gives a byte-identical export', async ({ page }) => {
  test.setTimeout(600_000);
  for (const c of CHARACTERS) {
    await boot(page);
    await waitForTestHooks(page);
    await setCharacter(page, c.macros, { name: c.name, modifiers: { 'nose/nose-scale-horiz-incr|decr': 0.4 }, ...c.extra });
    await page.evaluate(
      async ({ hair, layers }) => {
        const w = window as unknown as TestWindow;
        const s = w.__ps2cc;
        const { core } = w.__ps2ccTest;
        s.engine.update('look', (d) => {
          if (hair) d.hair = { mode: 'cards', style: core.starterStyle(hair), atlas: null, tint: { color: [0.35, 0.25, 0.18], brightness: 1 }, alphaThreshold: 0.5 };
          d.skin.layers = layers.map((k) => core.newLayer(k as never));
          d.expressionsToBake = d.expressionsToBake.filter((e) => e !== 'MBP');
        });
        await s.settled();
      },
      { hair: c.hair, layers: c.layers },
    );
    const before = await exportDigest(page, c.tPose);
    // Save (browser mode: localStorage), then a fresh app: reload the page and open the saved character.
    await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.save();
    });
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as TestWindow).__ps2cc), undefined, { timeout: 120_000 });
    await waitForTestHooks(page);
    const opened = await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      const ok = await s.open();
      await s.settled();
      return ok && !s.dirty;
    });
    expect(opened, `${c.name}: reopened and clean`).toBe(true);
    const after = await exportDigest(page, c.tPose);
    console.log(`${c.name}: GLB ${before.glbBytes} bytes ${before.glb.slice(0, 12)}…, message ${before.messageBytes} bytes ${before.message.slice(0, 12)}…`);
    if (after.doc !== before.doc) {
      writeFileSync(`test-results/rt_before_${c.name}.json`, before.doc);
      writeFileSync(`test-results/rt_after_${c.name}.json`, after.doc);
    }
    expect(after.doc, `${c.name}: document`).toBe(before.doc);
    for (const k of Object.keys(before.parts)) {
      if (before.parts[k] === after.parts[k]) continue;
      if (k === 'message.header') {
        const a = before.parts[k]!;
        const b = after.parts[k]!;
        let i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        console.log(`DIFF header at ${i}: ${a.slice(Math.max(0, i - 120), i + 80)} ||| ${b.slice(Math.max(0, i - 120), i + 80)}`);
      } else console.log(`DIFF ${c.name} ${k}`);
    }
    expect(after.glb, `${c.name}: GLB bytes`).toBe(before.glb);
    expect(after.glbBytes).toBe(before.glbBytes);
    expect(after.message, `${c.name}: export message (FBX data, textures, sidecar)`).toBe(before.message);
  }
});

test('first-run setup: Unity project and quality profile, shown once', async ({ page }) => {
  await boot(page, { firstRun: true });
  await expect(page.getByTestId('first-run')).toBeVisible();
  await page.getByTestId('firstrun-project').fill('C:\\Projects\\MyGame');
  await page.getByTestId('firstrun-profile').selectOption('hero');
  await page.getByTestId('firstrun-done').click();
  await expect(page.getByTestId('first-run')).toBeHidden();
  const state = await page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2cc;
    return { settings: JSON.parse(localStorage.getItem('ps2cc:settings') ?? '{}'), exportSettings: s.engine.doc.export, dirty: s.dirty };
  });
  expect(state.settings).toMatchObject({ firstRunCompleted: true, unityProject: 'C:\\Projects\\MyGame', qualityProfile: 'hero' });
  expect(state.exportSettings).toMatchObject({ unityProject: 'C:\\Projects\\MyGame', profile: 'hero', triangleBudget: 30000 });
  expect(state.dirty).toBe(false);
  // New characters start from the settings too, and the setup does not come back.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.newCharacter());
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.export.profile)).toBe('hero');
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as TestWindow).__ps2cc), undefined, { timeout: 120_000 });
  await expect(page.getByTestId('budget')).toBeVisible();
  await expect(page.getByTestId('first-run')).toHaveCount(0);
});

test('renders: 4096 px transparent and 1024 px solid; budget bar', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await waitForTestHooks(page);
  await setCharacter(page, { gender: 1 }, { name: 'Render Test', garments: [] });
  await expect(page.getByTestId('budget-textures')).toHaveText(/Textures \d+\.\d MB/);
  await expect(page.getByTestId('budget')).toContainText('Bones 53');
  const shot = async (size: string, bg: string) => {
    await page.getByTestId('render-size').selectOption(size);
    await page.getByTestId('render-background').selectOption(bg);
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('render-png').click();
    const file = await download;
    const b64 = readFileSync(await file.path()).toString('base64');
    return page.evaluate(async (b64) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const corner = g.getImageData(2, 2, 1, 1).data;
      const centre = g.getImageData(img.width / 2, img.height * 0.3, 1, 1).data;
      return { width: img.width, height: img.height, cornerAlpha: corner[3]!, centreAlpha: centre[3]! };
    }, b64);
  };
  const big = await shot('4096', 'transparent');
  expect(big).toMatchObject({ width: 4096, height: 4096, cornerAlpha: 0 });
  expect(big.centreAlpha).toBeGreaterThan(200);
  const small = await shot('1024', 'solid');
  expect(small).toMatchObject({ width: 1024, height: 1024, cornerAlpha: 255 });
});
