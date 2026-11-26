import type { CheckoutSession as CheckoutSessionRow } from '../../../generated/prisma/client.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  CheckoutSessionRepository,
  type CheckoutSession,
  type CheckoutSessionKey,
} from '../../domain/repositories/checkout-session.repository.js';
import type { DbContext } from './db.js';

function toSession(row: CheckoutSessionRow): CheckoutSession {
  return {
    id: row.id,
    sessionTokenHash: row.sessionTokenHash,
    pricingPlanId: row.pricingPlanId,
    customerReference: row.customerReference,
    customerEmail: row.customerEmail,
    publishableKeyId: row.publishableKeyId,
    paymentId: row.paymentId,
    createdAt: row.createdAt,
  };
}

export class PrismaCheckoutSessionRepository extends CheckoutSessionRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(
    scope: OrganizationScope,
    session: CheckoutSession,
  ): Promise<void> {
    await this.ctx.db.checkoutSession.create({
      data: { ...session, organizationId: scope.organizationId },
    });
  }

  async latest(
    scope: OrganizationScope,
    key: CheckoutSessionKey,
  ): Promise<CheckoutSession | null> {
    const row = await this.ctx.db.checkoutSession.findFirst({
      where: {
        organizationId: scope.organizationId,
        sessionTokenHash: key.sessionTokenHash,
        pricingPlanId: key.pricingPlanId,
        customerReference: key.customerReference,
        customerEmail: key.customerEmail,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toSession(row) : null;
  }

  async findByPaymentId(
    scope: OrganizationScope,
    paymentId: string,
  ): Promise<CheckoutSession | null> {
    const row = await this.ctx.db.checkoutSession.findFirst({
      where: { organizationId: scope.organizationId, paymentId },
    });
    return row ? toSession(row) : null;
  }
}
