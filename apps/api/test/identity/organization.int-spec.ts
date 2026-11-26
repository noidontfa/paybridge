import { randomUUID } from 'node:crypto';
import { GetOrganization } from '../../src/identity/application/use-cases/get-organization.js';
import {
  DEFAULT_ORGANIZATION_ID,
  OrganizationNotFoundError,
} from '../../src/identity/domain/entities/organization.js';
import { PrismaTransactionRunner } from '../../src/identity/infrastructure/prisma/transaction-runner.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// The identity module's Organizations, through its own transaction runner.

const prisma = createTestPrismaClient();
const runner = new PrismaTransactionRunner(prisma);
const getOrganization = new GetOrganization(runner.repositories.organizations);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Organizations', () => {
  it('has the default Organization from the migration, active', async () => {
    const organization = await getOrganization.execute(DEFAULT_ORGANIZATION_ID);

    expect(organization).toMatchObject({
      id: DEFAULT_ORGANIZATION_ID,
      name: 'Default Organization',
      status: 'ACTIVE',
    });
  });

  it('creates an active Organization with a name and timestamps', async () => {
    const id = randomUUID();

    const created = await runner.repositories.organizations.create({
      id,
      name: 'Acme Retail',
    });

    expect(created).toEqual({
      id,
      name: 'Acme Retail',
      status: 'ACTIVE',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(await getOrganization.execute(id)).toEqual(created);
  });

  it('reports an unknown Organization as not found', async () => {
    await expect(getOrganization.execute(randomUUID())).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    );
  });

  it('rolls back a create when the transaction fails', async () => {
    const id = randomUUID();

    await expect(
      runner.run(async (repos) => {
        await repos.organizations.create({ id, name: 'Rolled back' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await runner.repositories.organizations.findById(id)).toBeNull();
  });

  it('offers no way to delete an Organization', () => {
    expect(
      Object.keys(Object.getPrototypeOf(runner.repositories.organizations)),
    ).not.toContain('delete');
  });
});
