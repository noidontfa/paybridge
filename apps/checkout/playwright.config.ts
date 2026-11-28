import { defineConfig, devices } from '@playwright/test';
import {
  ALLOWED_HOST,
  API_PORT,
  API_URL,
  CHECKOUT_PORT,
  CHECKOUT_URL,
} from './e2e/env.js';

// End to end against the real API (migrated and seeded database of its own,
// Redis from docker compose), the built checkout app, and plain HTML host
// pages on an allowed and a disallowed origin. Run `pnpm build` first.
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's.

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  // The real API is slow to answer its first few requests after starting.
  expect: { timeout: 15_000 },
  use: {
    baseURL: ALLOWED_HOST,
    trace: 'on-first-retry',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec tsx e2e/start-api.ts',
      url: `${API_URL}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'node dist/server.js',
      url: `${CHECKOUT_URL}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        PORT: String(CHECKOUT_PORT),
        CHECKOUT_PUBLIC_URL: CHECKOUT_URL,
        PAYBRIDGE_API_URL: `http://localhost:${API_PORT}`,
      },
    },
    {
      // Serves both host origins from one process.
      command: 'pnpm exec tsx e2e/host-server.ts',
      url: `${ALLOWED_HOST}/`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
