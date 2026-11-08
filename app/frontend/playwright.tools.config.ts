import base from './playwright.config';
import { defineConfig } from '@playwright/test';

/** Build-time tools that run in the app (e.g. the face landmark table): `pnpm build:landmarks`. */
export default defineConfig({ ...base, testDir: './e2e/tools', testIgnore: [], timeout: 600_000 });
