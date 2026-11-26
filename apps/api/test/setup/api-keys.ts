import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { generateApiKey } from '../../src/identity/application/api-key-secret.js';
import { DEFAULT_ORGANIZATION_ID } from './organizations.js';

/**
 * Inserts an API Key for an Organization and returns the full key. Tests of
 * the public payments API send it as `Authorization: Bearer <key>`.
 */
export async function createApiKey(
  prisma: PrismaClient,
  organizationId: string = DEFAULT_ORGANIZATION_ID,
  label = 'Test key',
): Promise<string> {
  const generated = generateApiKey();
  await prisma.apiKey.create({
    data: {
      id: randomUUID(),
      organizationId,
      label,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
    },
  });
  return generated.key;
}

export const bearer = (key: string): { Authorization: string } => ({
  Authorization: `Bearer ${key}`,
});
