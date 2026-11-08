import { defineConfig } from '@playwright/test';

/**
 * Screenshot tests (PRD 8.2): the built frontend in Chromium with WebGL via
 * SwiftShader, so results do not depend on the machine's GPU.
 */
export default defineConfig({
  testDir: './e2e',
  // Build tools (pnpm build:landmarks) run with playwright.tools.config.ts only.
  testIgnore: ['tools/**'],
  timeout: 180_000,
  expect: { timeout: 60_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1600, height: 960 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'pnpm exec vite --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
