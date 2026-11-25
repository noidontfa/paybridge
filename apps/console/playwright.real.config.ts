import { defineConfig, devices } from '@playwright/test';

// LOCAL ONLY. Runs the smoke tests in e2e-real/ against a real API and a seeded database
// (see README: "Console against the real API"). CI uses playwright.config.ts (mock mode).
const port = Number(process.env.PLAYWRIGHT_REAL_PORT ?? 3200);
const apiBaseUrl = process.env.CONSOLE_API_BASE_URL ?? 'http://localhost:9999';

export default defineConfig({
  testDir: './e2e-real',
  // The specs share one database and the resolving spec changes it.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    timeout: 120_000,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    env: { CONSOLE_API_MOCKS: 'false', CONSOLE_API_BASE_URL: apiBaseUrl },
  },
});
