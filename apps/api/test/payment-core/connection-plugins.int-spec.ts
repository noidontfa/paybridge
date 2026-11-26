import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { ConnectionPlugins } from '../../src/payment-core/application/connection-plugins.js';
import { GatewayNotConnectedError } from '../../src/payment-core/domain/errors.js';
import {
  DEFAULT_ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  ensureOtherOrganization,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// ADR 0007: an Organization without a Gateway Connection never acts with the
// deployment's own credentials; only the legacy callback route of the default
// Organization may.

const prisma = createTestPrismaClient();
let app: INestApplication;
let plugins: ConnectionPlugins;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  plugins = moduleRef.get(ConnectionPlugins);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await ensureOtherOrganization(prisma);
  await prisma.gatewayConnection.deleteMany({ where: { gatewayId: 'fake' } });
});

describe('ConnectionPlugins without a Gateway Connection', () => {
  it('forExisting refuses, for the default Organization too', async () => {
    for (const org of [DEFAULT_ORGANIZATION_ID, OTHER_ORGANIZATION_ID]) {
      await expect(plugins.forExisting(org, 'fake')).rejects.toBeInstanceOf(
        GatewayNotConnectedError,
      );
    }
  });

  it('the legacy callback route falls back for the default Organization only', async () => {
    await expect(
      plugins.forLegacyCallback(DEFAULT_ORGANIZATION_ID, 'fake'),
    ).resolves.toMatchObject({ gatewayId: 'fake' });
    await expect(
      plugins.forLegacyCallback(OTHER_ORGANIZATION_ID, 'fake'),
    ).rejects.toBeInstanceOf(GatewayNotConnectedError);
  });
});
