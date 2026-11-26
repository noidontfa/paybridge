import type { PrismaClient } from '../../src/generated/prisma/client.js';

/** PostgreSQL SQLSTATE for "deadlock detected". */
const DEADLOCK_DETECTED = '40P01';
const MAX_ATTEMPTS = 5;

/**
 * Empties every `core_*` and `chk_*` table, keeping the schema. Call it in `beforeEach`.
 * Tables are discovered from the catalog, so new tables need no change here.
 *
 * A booted PaymentCoreModule runs BullMQ sweep jobs (expiry, webhook inbox,
 * review re-query, retention) in the background, and they read and write these
 * tables while a test resets them. TRUNCATE takes ACCESS EXCLUSIVE locks one
 * table at a time, so a sweep transaction holding a lock on a later table can
 * deadlock with it; PostgreSQL then aborts one side. When TRUNCATE is the one
 * aborted, nothing was emptied, so it is simply retried.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND (tablename LIKE 'core\\_%' OR tablename LIKE 'chk\\_%')`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(
        `TRUNCATE ${list} RESTART IDENTITY CASCADE`,
      );
      await connectFakeGateway(prisma);
      return;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isDeadlock(error)) throw error;
      await new Promise((r) => setTimeout(r, 20 * attempt));
    }
  }
}

function isDeadlock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  return (
    meta?.code === DEADLOCK_DETECTED || error.message.includes(DEADLOCK_DETECTED)
  );
}

/** Gateways the test suites register (`fake`, and `alpha`/`beta` doubles). */
const TEST_GATEWAY_IDS = ['fake', 'alpha', 'beta'];

/**
 * Every Organization holds an enabled, credential-less Gateway Connection for
 * each test gateway after a reset, so tests start attempts without ceremony.
 * Tests about Gateway Connections delete or change them.
 */
export async function connectFakeGateway(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO core_gateway_connections (id, organization_id, gateway_id, updated_at)
     SELECT gen_random_uuid(), o.id, g.id, now()
     FROM iam_organizations o CROSS JOIN unnest(ARRAY[${TEST_GATEWAY_IDS.map((g) => `'${g}'`).join(',')}]) AS g(id)
     ON CONFLICT DO NOTHING`,
  );
}
