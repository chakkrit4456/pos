import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E runs the production bundle (build first) on a fresh data folder.
const dataDir = mkdtempSync(join(tmpdir(), 'flexpos-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://localhost:4300', viewport: { width: 1280, height: 800 }, locale: 'th-TH' },
  webServer: {
    command: 'node apps/server/dist/main.js',
    url: 'http://localhost:4300/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: '4300', FLEXPOS_DATA_DIR: dataDir, FLEXPOS_WEB_DIR: 'apps/web/dist', FLEXPOS_FONTS_DIR: 'apps/server/dist/fonts', NODE_ENV: 'test' },
  },
});
