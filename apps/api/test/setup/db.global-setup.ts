import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestPrismaClient } from './test-prisma.js';
import {
  maintenanceDatabaseUrl,
  testDatabaseName,
  testDatabaseUrl,
} from './test-database.js';

/**
 * Vitest global setup for integration tests: recreates the test database from
 * empty and applies every migration with `prisma migrate deploy`, so each run
 * also proves the migrations apply cleanly to an empty database.
 */
export default async function setup(): Promise<void> {
  const name = testDatabaseName();
  const admin = createTestPrismaClient(maintenanceDatabaseUrl());
  try {
    // `name` is validated by testDatabaseName() (lowercase [a-z0-9_] only).
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl() },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
