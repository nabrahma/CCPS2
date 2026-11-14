/**
 * PRD M13 against the real Material Painter (`pnpm test:painter`; skipped when
 * Material Painter is not installed). The app runs under `wails dev` with a
 * fresh home folder, like the desktop test. Node stands in for the artist:
 * it paints through Material Painter's own agent server, the same way PS2CC
 * drives it.
 *
 *  1. Skin: Paint in Material Painter sends hm08 and the composited skin;
 *     paint one UV island; Bring paint back adds one painted layer (one undo
 *     step) holding just that paint, and the body shows it.
 *  2. Paint again reopens the saved project: the earlier paint is still there,
 *     and the reference does not include it (no paint twice).
 *  3. Garment: the same for a worn T-shirt; the paint becomes its paint texture.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../../..');
const OUT = resolve(APP, '../docs/milestones/M13');
const URL_ = 'http://localhost:34115/';
const EXE = process.env.PS2CC_MATERIAL_PAINTER ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Material Painter', 'MaterialPainter.exe');

const ESC = String.fromCharCode(27);
const stripAnsi = (s: string) => s.split(ESC).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))).join('');

async function startDesktop(home: string): Promise<ChildProcess> {
  const log: string[] = [];
  const proc = spawn('wails.exe', ['dev', '-s', '-m', '-noreload'], { cwd: APP, env: { ...process.env, PS2CC_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((ok, fail) => {
    const onData = (b: Buffer) => {
      const text = stripAnsi(b.toString());
      log.push(text);
      if (text.includes('navigate to: http://localhost:34115')) ok();
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);
    proc.on('exit', (code) => fail(new Error(`wails dev exited (${code}):\n${log.join('').slice(-2000)}`)));
    setTimeout(() => fail(new Error(`wails dev did not start:\n${log.join('').slice(-2000)}`)), 240_000);
  });
  return proc;
}

/** One tool call on Material Painter's agent server (as the artist's hand). */
async function mp(tool: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch('http://127.0.0.1:39831/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const body = (await res.json()) as { result: { isError?: boolean; content: { type: string; text?: string; data?: string }[] } };
  if (body.result.isError) throw new Error(`${tool}: ${body.result.content.map((c) => c.text).join(' ')}`);
  return body.result.content.map((c) => c.text ?? c.data ?? '').join('');
}

/** Paint one UV island (picked by a UV inside it) on Material Painter's "Paint" layer. */
async function paintIsland(uv: [number, number], color: [number, number, number]): Promise<void> {
  const state = JSON.parse(await mp('get_state')) as { layers_bottom_to_top: { index: number; name: string }[] };
  const layer = state.layers_bottom_to_top.find((l) => l.name === 'Paint');
  expect(layer, 'the session has a Paint layer').toBeTruthy();
  await mp('poly_fill', { index: layer!.index, uv, mode: 'uv_island', color });
}

/** A UV inside the mesh: the centroid of the first face of the session's OBJ. */
function firstFaceUv(obj: string): [number, number] {
  const vts = obj.split('\n').filter((l) => l.startsWith('vt ')).map((l) => l.split(' ').slice(1).map(Number) as [number, number]);
  const face = obj.split('\n').find((l) => l.startsWith('f '))!.split(' ').slice(1).map((c) => Number(c.split('/')[1]) - 1);
  const u = face.reduce((s, i) => s + vts[i]![0], 0) / face.length;
  const v = face.reduce((s, i) => s + vts[i]![1], 0) / face.length;
  return [u, v];
}

async function openApp(page: Page): Promise<void> {
  await page.goto(URL_);
  await page.waitForFunction(() => Boolean((window as unknown as TestWindow).__ps2cc && window.go?.main?.App), undefined, { timeout: 180_000 });
  await page.waitForFunction(() => Boolean((window as unknown as Partial<TestWindow>).__ps2ccTest), undefined, { timeout: 60_000 });
  await expect(page.getByTestId('budget')).toBeVisible();
}

const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());

test('Texture Studio: skin and garment painted in Material Painter come back', async ({ page }) => {
  test.skip(!existsSync(EXE), `Material Painter is not installed (${EXE})`);
  test.setTimeout(1_200_000);
  mkdirSync(OUT, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), 'ps2cc-painter-'));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ firstRunCompleted: true, materialPainter: EXE }));
  let app: ChildProcess | null = null;
  try {
    app = await startDesktop(home);
    await openApp(page);
    await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      s.engine.update('e2e', (d) => {
        d.name = 'MP Test';
        d.garments = [{ slot: 'top', asset: 'mh:clothes/elvs_crude_t-shirt_male', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: false }];
      });
      await s.settled();
      await s.viewport!.skinSettled();
    });

    // ------------------------------------------------------------ 1. skin
    await page.getByTestId('cat-skin').click();
    await page.getByTestId('open-texture-studio').click();
    await page.getByTestId('paint-open-skin').click();
    await expect(page.getByTestId('paint-open-skin')).toHaveText('Paint again in Material Painter', { timeout: 180_000 });
    const session = join(home, 'paint', 'MP_Test', 'skin');
    for (const f of ['mesh.obj', 'reference.png', 'project.mpp']) expect(existsSync(join(session, f)), f).toBe(true);
    const firstReference = readFileSync(join(session, 'reference.png')).toString('base64');
    const skinUv = firstFaceUv(readFileSync(join(session, 'mesh.obj'), 'utf8'));
    await paintIsland(skinUv, [0.9, 0.1, 0.1]);
    writeFileSync(join(OUT, 'material_painter_skin.png'), Buffer.from(await mp('render_view', { width: 1024, height: 768 }), 'base64'));

    const layers = () => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.skin.layers.map((l) => ({ id: l.id, image: l.image ?? null })));
    const before = await layers();
    await page.getByTestId('paint-collect-skin').click();
    await expect.poll(async () => (await layers()).length, { timeout: 120_000 }).toBe(before.length + 1);
    const painted = (await layers()).at(-1)!;
    expect(painted.id.startsWith('painted-')).toBe(true);
    await settled(page);
    // The layer holds the island and nothing else: red where painted, transparent elsewhere.
    const stats = await page.evaluate(async (url) => {
      const bmp = await createImageBitmap(await (await fetch(url!)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let opaque = 0;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        opaque++;
        if (d[i]! > 200 && d[i + 1]! < 80) red++;
      }
      return { opaque, red, size: bmp.width };
    }, painted.image);
    expect(stats.size).toBe(2048);
    expect(stats.opaque).toBeGreaterThan(500);
    expect(stats.red / stats.opaque, 'only the painted island comes back').toBeGreaterThan(0.95);
    await page.screenshot({ path: join(OUT, 'ui_skin_painted.png') });
    // One undo step.
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
    expect(await layers()).toEqual(before);
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.redo());

    // ------------------------------------------------------------ 2. paint again
    await page.getByTestId('paint-open-skin').click();
    await expect(page.getByTestId('paint-open-skin')).toHaveText('Paint again in Material Painter', { timeout: 180_000 });
    await expect(page.getByTestId('paint-open-skin')).toBeEnabled({ timeout: 180_000 });
    const state = JSON.parse(await mp('get_state')) as { layers_bottom_to_top: { name: string }[] };
    expect(state.layers_bottom_to_top.map((l) => l.name)).toEqual(['PS2CC reference (do not paint)', 'Paint']);
    // The reference sent this time is the skin under the painted layer: the same pixels as the first time.
    const differ = await page.evaluate(
      async ([a, b]) => {
        const pixels = async (b64: string) => {
          const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext('2d')!;
          ctx.drawImage(bmp, 0, 0);
          return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        };
        const [x, y] = await Promise.all([pixels(a!), pixels(b!)]);
        let n = 0;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++;
        return n;
      },
      [firstReference, readFileSync(join(session, 'reference.png')).toString('base64')],
    );
    expect(differ, 'the reference leaves the painted layer out').toBe(0);
    // Bringing it back unchanged keeps the same paint (the island is still in the project).
    await page.getByTestId('paint-collect-skin').click();
    await expect.poll(async () => (await layers()).length, { timeout: 120_000 }).toBe(before.length + 1);

    // ------------------------------------------------------------ 3. garment
    const key = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.find((p) => p.kind === 'garment')!.key);
    await page.evaluate((k) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().select(k), key);
    await page.getByTestId('paint-open-garment-top').click();
    await expect(page.getByTestId('paint-open-garment-top')).toHaveText('Paint again in Material Painter', { timeout: 180_000 });
    const gSession = join(home, 'paint', 'MP_Test', 'garment_top');
    await paintIsland(firstFaceUv(readFileSync(join(gSession, 'mesh.obj'), 'utf8')), [0.1, 0.2, 0.9]);
    writeFileSync(join(OUT, 'material_painter_garment.png'), Buffer.from(await mp('render_view', { width: 1024, height: 768, yaw: Math.PI }), 'base64'));
    await page.getByTestId('paint-collect-garment-top').click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments[0]!.paint ?? null), { timeout: 120_000 })
      .not.toBeNull();
    await settled(page);
    // The island painted is the shirt's back panel: look from behind.
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraFrame({ targetHeight: 0.68, span: 0.6, yaw: Math.PI, pitch: 0 }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'ui_garment_painted.png') });
    await page.getByTestId('garment-paint-remove').click();
    expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments[0]!.paint ?? null)).toBeNull();
  } finally {
    if (app?.pid) spawnSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' });
    rmSync(home, { recursive: true, force: true });
  }
});
