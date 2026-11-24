import { join } from 'node:path';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';

/**
 * Where integration tests run. The server, user and password come from
 * `DATABASE_URL` in `.env.test`; the database name is `TEST_DATABASE_NAME`
 * (default `paybridge_test`), so parallel runs can each use their own.
 */
export const DEFAULT_TEST_DATABASE_NAME = 'paybridge_test';

// The global setup drops and recreates this database, so refuse any name that
// could be a real database (it must contain `test`).
const SAFE_NAME = /^[a-z0-9_]*test[a-z0-9_]*$/;

export function testDatabaseName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.TEST_DATABASE_NAME || DEFAULT_TEST_DATABASE_NAME;
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `TEST_DATABASE_NAME must be lowercase [a-z0-9_] and contain "test" (got "${name}")`,
    );
  }
  return name;
}

function baseUrl(): URL {
  const file = join(import.meta.dirname, '../../.env.test');
  const fromFile = parse(readFileSync(file, 'utf8')).DATABASE_URL;
  if (!fromFile) throw new Error(`DATABASE_URL missing in ${file}`);
  return new URL(fromFile);
}

function withDatabase(name: string): string {
  const url = baseUrl();
  url.pathname = `/${name}`;
  return url.toString();
}

/** Connection string of the integration-test database. */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return withDatabase(testDatabaseName(env));
}

/** Connection string of the server's maintenance database (`postgres`). */
export function maintenanceDatabaseUrl(): string {
  return withDatabase('postgres');
}
