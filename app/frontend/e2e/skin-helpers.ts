/** Types and helpers for the skin and photo e2e tests (M6). */
import { expect, type Page } from '@playwright/test';
import type { Studio } from '../src/state/studio';
import type { TestHooks } from '../src/testHooks';

export interface TestWindow {
  __ps2cc: Studio;
  __ps2ccTest: TestHooks;
}

/** Wait until the e2e-only helpers (window.__ps2ccTest) are loaded. */
export async function waitForTestHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as Partial<TestWindow>).__ps2ccTest), undefined, { timeout: 60_000 });
  await expect(page.getByTestId('budget')).toBeVisible();
}
