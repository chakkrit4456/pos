import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Captures the screenshots used in docs/manual from a brand-new install (build first).
// Run: npx playwright test -c tools/manual/playwright.config.ts
const dataDir = mkdtempSync(join(tmpdir(), 'flexpos-manual-'));

export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  workers: 1,
  use: { baseURL: 'http://localhost:4400', viewport: { width: 1366, height: 820 }, locale: process.env.SHOT_LANG === 'en' ? 'en-US' : 'th-TH', deviceScaleFactor: 1, actionTimeout: 15_000 },
  webServer: {
    command: 'node apps/server/dist/main.js',
    cwd: '../..',
    url: 'http://localhost:4400/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: '4400', FLEXPOS_DATA_DIR: dataDir, FLEXPOS_WEB_DIR: 'apps/web/dist', FLEXPOS_FONTS_DIR: 'apps/server/dist/fonts', NODE_ENV: 'test' },
  },
});
