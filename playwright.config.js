// Playwright E2E configuration for XActions
// by nichxbt
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://[::1]:3001';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.test.js',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    acceptDownloads: true,
    downloadsPath: 'test-results/downloads',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Web server is assumed to be already running via `npm run dev`/`npm start`.
  // Tests target http://localhost:3001 as configured in `use.baseURL`.
});
