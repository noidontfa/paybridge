import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { DEFAULT_ORGANIZATION_ID } from './organizations.js';

/** The host page a test checkout runs on. */
export const SHOP_ORIGIN = 'https://shop.example.com';

/**
 * Inserts a Publishable Key allowing `allowedOrigins` and returns its id and
 * key. `iam_` rows survive `resetDatabase`; delete them in `beforeEach`.
 */
export async function createPublishableKey(
  prisma: PrismaClient,
  organizationId: string = DEFAULT_ORGANIZATION_ID,
  allowedOrigins: string[] = [SHOP_ORIGIN],
): Promise<{ id: string; key: string }> {
  const id = randomUUID();
  const key = `pb_pk_${randomBytes(24).toString('base64url')}`;
  await prisma.publishableKey.create({
    data: {
      id,
      organizationId,
      label: 'Test checkout',
      key,
      allowedOrigins,
      updatedAt: new Date(),
    },
  });
  return { id, key };
}

export interface TestPricingPlan {
  readonly name?: string;
  readonly amount?: string;
  readonly allowedGatewayIds?: string[];
  readonly expiryMinutes?: number;
  readonly status?: 'ACTIVE' | 'ARCHIVED';
}

/** Inserts a Pricing Plan and returns its id. */
export async function createPricingPlan(
  prisma: PrismaClient,
  organizationId: string = DEFAULT_ORGANIZATION_ID,
  plan: TestPricingPlan = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.pricingPlan.create({
    data: {
      id,
      organizationId,
      name: plan.name ?? 'Pro',
      description: '',
      features: [],
      amount: plan.amount ?? '199000',
      currency: 'VND',
      allowedGatewayIds: plan.allowedGatewayIds ?? [],
      expiryMinutes: plan.expiryMinutes ?? 60,
      status: plan.status ?? 'ACTIVE',
      updatedByUserId: randomUUID(),
      updatedByRole: 'ORGANIZATION_ADMIN',
      updatedByName: 'Test Admin',
      updatedAt: new Date(),
    },
  });
  return id;
}
