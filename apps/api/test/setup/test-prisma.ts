import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { testDatabaseUrl } from './test-database.js';

/** A PrismaClient on the integration-test database. Disconnect it in afterAll. */
export function createTestPrismaClient(
  connectionString = testDatabaseUrl(),
): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
