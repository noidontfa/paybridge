import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { DEFAULT_ORGANIZATION_ID } from '../../src/identity/domain/organization.js';
import { connectFakeGateway } from './reset-db.js';
import { organizationScope } from '../../src/payment-core/domain/value-objects/organization-scope.js';

export { DEFAULT_ORGANIZATION_ID };

/** A second Organization, for isolation tests. Create it with `ensureOtherOrganization`. */
export const OTHER_ORGANIZATION_ID = '00000000-0000-7000-8000-000000000002';

/** The scope the stub principal gives every request. */
export const defaultScope = organizationScope(DEFAULT_ORGANIZATION_ID);
export const otherScope = organizationScope(OTHER_ORGANIZATION_ID);

/**
 * `resetDatabase` empties only `core_*` tables, so the default Organization
 * (created by the migration) always exists; other Organizations are inserted
 * on demand, once.
 */
export async function ensureOrganization(
  prisma: PrismaClient,
  id: string,
  name: string,
): Promise<void> {
  await prisma.organization.upsert({
    where: { id },
    update: {},
    create: { id, name },
  });
  await connectFakeGateway(prisma);
}

export function ensureOtherOrganization(prisma: PrismaClient): Promise<void> {
  return ensureOrganization(
    prisma,
    OTHER_ORGANIZATION_ID,
    'Other Organization',
  );
}

/** A fresh Organization with its own id (for tests that want many). */
export async function createOrganization(
  prisma: PrismaClient,
  name = 'Test Organization',
): Promise<string> {
  const id = randomUUID();
  await ensureOrganization(prisma, id, name);
  return id;
}
