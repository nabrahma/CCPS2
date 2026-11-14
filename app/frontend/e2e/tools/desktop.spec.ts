/**
 * PRD M9 against the real Go backend (`pnpm test:desktop`): the app runs under
 * `wails dev` with a fresh, temporary PS2CC home folder, and Playwright drives
 * its UI through the dev server, which talks to the running Go process.
 *
 *  1. First-run setup with a real Unity project (tests/UnityHarness).
 *  2. Save writes the .ps2char and a thumbnail; the character browser lists it
 *     with the thumbnail, opens it and duplicates it.
 *  3. Round trip through the backend: save -> reload -> open from the browser
 *     gives a byte-identical GLB and export message.
 *  4. Custom garments (M10): the real file readers, OBJ through the dialog and
 *     FBX through ufbx; the garment is stored in the library, is still there
 *     after a reload, and a saved character wearing it loads again.
 *  5. Crash recovery: edit, wait for the autosave, edit again, then kill the Go
 *     process mid-edit. On the next start the recovery prompt restores the
 *     last autosave exactly.
 *
 * WebView2 in the built PS2CC.exe cannot be driven from outside (Wails clears
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS on purpose), so this uses the same
 * frontend and backend under `wails dev`. The installed exe is checked by
 * `pnpm test:installer`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../../..');
const UNITY_PROJECT = resolve(APP, '../tests/UnityHarness');
const URL_ = 'http://localhost:34115/';
const TIME = '2026-11-08 12:00:00:000';

/** Remove ANSI colour codes (ESC [ ... m) from wails' console output. */
const ESC = String.fromCharCode(27);
const stripAnsi = (s: string) => s.split(ESC).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))).join('');

interface Desktop {
  proc: ChildProcess;
  log: string[];
}

/** Start the app under `wails dev` with the given home folder; resolves when the dev server is up. */
async function startDesktop(home: string): Promise<Desktop> {
  const log: string[] = [];
  // FBX import needs ufbx, which is linked through cgo (scripts/cgo-env.mjs).
  const cc = process.env.PS2CC_CC ?? 'C:\\mingw64\\bin\\x86_64-w64-mingw32-gcc.exe';
  const proc = spawn('wails.exe', ['dev', '-s', '-m', '-noreload', '-tags', 'ufbx'], {
    cwd: APP,
    env: { ...process.env, PS2CC_HOME: home, CGO_ENABLED: '1', CC: cc, PATH: `${dirname(cc)};${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise<void>((ok, fail) => {
    const onData = (b: Buffer) => {
      const text = stripAnsi(b.toString());
      log.push(text);
      if (text.includes('navigate to: http://localhost:34115')) ok();
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);
    proc.on('exit', (code) => fail(new Error(`wails dev exited (${code}):\n${log.join('').slice(-2000)}`)));
  });
  await Promise.race([ready, new Promise((_, fail) => setTimeout(() => fail(new Error(`wails dev did not start:\n${log.join('').slice(-2000)}`)), 240_000))]);
  return { proc, log };
}

/** Stop our own `wails dev` process tree (and the app and dev server it started). */
function stopDesktop(d: Desktop | null): void {
  if (!d?.proc.pid || d.proc.exitCode !== null) return;
  spawnSync('taskkill', ['/T', '/F', '/PID', String(d.proc.pid)], { stdio: 'ignore' });
}

async function openApp(page: Page): Promise<void> {
  await page.goto(URL_);
  await page.waitForFunction(() => Boolean((window as unknown as TestWindow).__ps2cc && window.go?.main?.App), undefined, { timeout: 180_000 });
  await page.waitForFunction(() => Boolean((window as unknown as Partial<TestWindow>).__ps2ccTest), undefined, { timeout: 60_000 });
  await expect(page.getByTestId('budget')).toBeVisible();
}

async function exportDigest(page: Page): Promise<{ glb: string; message: string }> {
  return page.evaluate(async (time) => {
    const w = window as unknown as TestWindow;
    await w.__ps2cc.settled();
    const { scene, message } = await w.__ps2ccTest.prepareExport(w.__ps2cc, { glb: true, tPose: false }, time);
    const glb = await w.__ps2ccTest.buildGlb(scene);
    const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource)), (x) => x.toString(16).padStart(2, '0')).join('');
    return { glb: await hex(glb.bytes), message: await hex(message) };
  }, TIME);
}

/** Move a body slider with the keyboard, like a user (marks the character as changed). */
async function nudgeSlider(page: Page, index: number, presses: number): Promise<void> {
  await page.getByRole('tab', { name: 'Create' }).click();
  await page.getByTestId('create-body').click();
  const slider = page.locator('.slider-row input[type="range"]').nth(index);
  await slider.focus();
  for (let i = 0; i < presses; i++) await slider.press('ArrowRight');
  await slider.press('Tab');
}

test('desktop: first run, save, character browser, round trip and crash recovery', async ({ page }) => {
  test.setTimeout(1_200_000);
  const home = mkdtempSync(join(tmpdir(), 'ps2cc-desktop-'));
  let app: Desktop | null = null;
  try {
    // ---------------------------------------------------------------- first launch
    app = await startDesktop(home);
    await openApp(page);
    await expect(page.getByTestId('first-run')).toBeVisible();
    await page.getByTestId('firstrun-project').fill(UNITY_PROJECT);
    await page.getByTestId('firstrun-project').blur();
    await expect(page.getByTestId('firstrun-status')).toContainText('Unity 6000');
    await page.getByTestId('firstrun-done').click();
    await expect(page.getByTestId('first-run')).toBeHidden();
    const settings = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as { firstRunCompleted: boolean; unityProject: string };
    expect(settings.firstRunCompleted).toBe(true);
    expect(resolve(settings.unityProject)).toBe(UNITY_PROJECT);

    // Edit and save: the document and a thumbnail are written.
    const name = page.getByLabel('Character name');
    await name.fill('Desk Test');
    await name.press('Enter');
    await nudgeSlider(page, 0, 8);
    await page.keyboard.press('Control+s');
    const docPath = join(home, 'Characters', 'Desk Test', 'Desk Test.ps2char');
    const thumbPath = join(home, 'Characters', 'Desk Test', 'renders', 'thumb.png');
    await expect.poll(() => existsSync(docPath) && existsSync(thumbPath), { timeout: 60_000 }).toBe(true);
    expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.dirty)).toBe(false);
    const before = await exportDigest(page);

    // Fresh frontend (reload), then open the character from the browser: identical export.
    await page.reload();
    await openApp(page);
    await page.keyboard.press('Control+o');
    await expect(page.getByTestId('character-browser')).toBeVisible();
    const card = page.getByTestId('character-card').filter({ hasText: 'Desk Test' });
    await expect(card).toHaveCount(1);
    // The thumbnail comes from the backend's asset server.
    await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(256);
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByTestId('character-browser')).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.name)).toBe('Desk Test');
    const after = await exportDigest(page);
    expect(after.glb, 'GLB bytes after save -> reload -> open').toBe(before.glb);
    expect(after.message, 'export message after save -> reload -> open').toBe(before.message);

    // Duplicate from the browser: a second character with its own id and thumbnail.
    await page.keyboard.press('Control+o');
    await page.getByTestId('character-card').filter({ hasText: 'Desk Test' }).getByTestId('character-duplicate').click();
    await expect(page.getByTestId('character-card')).toHaveCount(2, { timeout: 60_000 });
    const copy = join(home, 'Characters', 'Desk Test copy', 'Desk Test copy.ps2char');
    expect(existsSync(copy)).toBe(true);
    expect(JSON.parse(readFileSync(copy, 'utf8')).id).not.toBe(JSON.parse(readFileSync(docPath, 'utf8')).id);
    await page.screenshot({ path: resolve(APP, '../docs/milestones/M9/ui_character_browser.png') });
    await page.getByTestId('character-browser').getByRole('button', { name: 'Close', exact: true }).click();

    // ---------------------------------------------------------------- user preset and background (Go side)
    const preset = await page.evaluate(async () => {
      const g = window.go!.main!.App!;
      const item = await g.SavePreset('Desk preset', JSON.stringify({ format: 'ps2cc.preset/1', preset: { label: 'Desk preset', macros: { gender: 0.3 } } }));
      const listed = (await g.ListLibrary('presets')) ?? [];
      return { file: item.file, listed: listed.map((i) => i.file), text: await g.ReadLibraryDocument(item.file) };
    });
    expect(preset.listed).toContain(preset.file);
    expect(preset.text).toContain('Desk preset');
    await page.evaluate((f) => window.go!.main!.App!.DeleteLibraryItem(f), preset.file);
    expect((await page.evaluate(() => window.go!.main!.App!.ListLibrary('presets'))) ?? []).toHaveLength(0);
    const background = await page.evaluate(async () => {
      const c = new OffscreenCanvas(4, 4);
      c.getContext('2d')!.fillRect(0, 0, 4, 4);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return window.go!.main!.App!.ImportBytes('backgrounds', 'room.png', btoa(String.fromCharCode(...bytes)));
    });
    expect(background.file).toMatch(/^backgrounds\/room_.*\.png$/);

    // ---------------------------------------------------------------- custom garment (M10)
    await page.evaluate(async (p) => (window as unknown as TestWindow).__ps2cc.openPath(p), docPath); // the duplicate is open now
    await page.getByRole('tab', { name: 'Wardrobe' }).click();
    const shirtPath = resolve(APP, '../tests/fixtures/garments/test_shirt.obj');
    await page.evaluate((path) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openGarmentImport({ path }), shirtPath);
    await expect(page.getByTestId('garment-import-status')).toContainText('10,944 triangles');
    await page.getByTestId('garment-import-name').fill('Desk shirt');
    await page.getByTestId('garment-import-run').click();
    await expect(page.getByTestId('garment-import-report')).toBeVisible();
    await page.getByTestId('garment-import-wear').click();
    const stored = () => readdirSync(join(home, 'Library', 'garments')).filter((f) => !f.endsWith('.tmp')).sort();
    expect(stored().map((f) => f.split('.').pop())).toEqual(['bin', 'json']);
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.dirty), { timeout: 60_000 }).toBe(false);
    await page.reload();
    await openApp(page);
    await page.evaluate(async (p) => (window as unknown as TestWindow).__ps2cc.openPath(p), docPath);
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
    expect(
      await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.filter((p) => p.kind === 'garment').map((p) => p.label)),
      'the garment comes back from the library after a restart',
    ).toEqual(['Desk shirt']);
    // A file the Go reader cannot use is reported in the dialog.
    await page.evaluate((path) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openGarmentImport({ path }), resolve(APP, 'wails.json.fbx'));
    await expect(page.getByTestId('garment-import-problem')).not.toHaveText('\u00a0');
    await page.getByTestId('garment-import-dialog').getByRole('button', { name: 'Cancel' }).click();
    // FBX through ufbx: PS2CC's own export is an FBX the reader must understand.
    const fbxDir = join(home, 'fbx-check');
    const message = await page.evaluate(async (time) => {
      const w = window as unknown as TestWindow;
      const { message } = await w.__ps2ccTest.prepareExport(w.__ps2cc, { glb: false, tPose: false }, time);
      let bin = '';
      for (let k = 0; k < message.length; k += 0x8000) bin += String.fromCharCode(...message.subarray(k, k + 0x8000));
      return btoa(bin);
    }, TIME);
    const fbxFiles = await page.evaluate(async ({ m, dir }) => (await window.go!.main!.App!.ExportCharacter(m, dir)).files, { m: message, dir: fbxDir });
    const fbx = fbxFiles.find((f) => f.endsWith('.fbx'));
    expect(fbx).toBeTruthy();
    const read = await page.evaluate((p) => window.go!.main!.App!.ReadGarment(p), fbx!);
    expect(read.triangles, 'FBX read through ufbx').toBeGreaterThan(5000);
    expect(read.hasUvs).toBe(true);
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.update('Undress', (d) => void (d.garments = [])));
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.dirty), { timeout: 60_000 }).toBe(false);

    // Back to the original for the crash test.
    await page.evaluate(async (p) => (window as unknown as TestWindow).__ps2cc.openPath(p), docPath);

    // ---------------------------------------------------------------- crash mid-edit
    // Autosave every minute (the shortest setting), picked up when the frontend restarts.
    await page.evaluate(async () => {
      const g = window.go!.main!.App!;
      await g.SaveSettings({ ...(await g.GetSettings()), autosaveMinutes: 1 });
    });
    await page.reload();
    await openApp(page);
    await page.evaluate(async (p) => (window as unknown as TestWindow).__ps2cc.openPath(p), docPath);
    await nudgeSlider(page, 1, 10);
    const autosaveDir = join(home, 'Characters', 'Desk Test', 'autosave');
    const latest = () => (existsSync(autosaveDir) ? readdirSync(autosaveDir).filter((f) => f.endsWith('.ps2char')).sort().pop() ?? null : null);
    await expect.poll(latest, { timeout: 100_000, intervals: [2000] }).not.toBeNull();
    const autosaved = readFileSync(join(autosaveDir, latest()!), 'utf8');
    // Keep editing after the autosave: this change is lost in the crash.
    await nudgeSlider(page, 2, 6);
    const pid = await page.evaluate(async () => (await window.go!.main!.App!.Info()).pid ?? 0);
    expect(pid).toBeGreaterThan(0);
    process.kill(pid, 'SIGKILL'); // TerminateProcess: no shutdown handler runs, like a crash
    await expect.poll(() => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH']).stdout.toString().includes(String(pid)), { timeout: 30_000 }).toBe(false);
    stopDesktop(app);
    app = null;
    expect(existsSync(join(home, '.session')), 'the crashed session left its marker').toBe(true);

    // ---------------------------------------------------------------- next start
    app = await startDesktop(home);
    await openApp(page);
    await expect(page.getByRole('dialog', { name: 'PS2CC closed unexpectedly' })).toBeVisible();
    await page.screenshot({ path: resolve(APP, '../docs/milestones/M9/ui_recovery_prompt.png') });
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('dialog', { name: 'PS2CC closed unexpectedly' })).toBeHidden();
    const restored = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      return { doc: w.__ps2ccTest.core.serializeCharacter(w.__ps2cc.engine.doc as never), dirty: w.__ps2cc.dirty };
    });
    expect(restored.doc, 'restored document equals the last autosave').toBe(autosaved);
    expect(restored.dirty, 'a restored autosave still needs saving').toBe(true);
    console.log(`recovered ${latest()} (${statSync(join(autosaveDir, latest()!)).size} bytes) after killing pid ${pid}`);
  } finally {
    stopDesktop(app);
    rmSync(home, { recursive: true, force: true });
  }
});
