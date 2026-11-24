import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/setup/test-database.js';

// Integration tests: real PostgreSQL (docker compose). The database name comes
// from TEST_DATABASE_NAME (default paybridge_test); the global setup recreates
// it and runs `prisma migrate deploy`. Files share one database, so they run
// one at a time; reset tables with test/setup/reset-db.ts in beforeEach.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.int-spec.ts'],
    env: { NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl() },
    globalSetup: ['./test/setup/db.global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
