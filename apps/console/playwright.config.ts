import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /(review-resolution|webhook-deliveries)\.spec\.ts/ },
    // Change the mock store (resolve a Review, resend a Webhook), so they run after every read-only spec.
    {
      name: 'mutations',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(review-resolution|webhook-deliveries)\.spec\.ts/,
      dependencies: ['chromium'],
    },
  ],
  // Mock mode refuses to start in a production build, so e2e runs the dev server.
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    timeout: 120_000,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    env: { CONSOLE_API_MOCKS: 'true', CONSOLE_API_BASE_URL: 'http://api.test:3000' },
  },
});
