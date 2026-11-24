import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Empties every `core_*` table, keeping the schema. Call it in `beforeEach`.
 * Tables are discovered from the catalog, so new tables need no change here.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'core\\_%'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
