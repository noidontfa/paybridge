import type { CheckoutSession as CheckoutSessionRow } from '../../../generated/prisma/client.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  CheckoutSessionRepository,
  type CheckoutReturnContext,
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
    returnContext: row.returnHostPageUrl
      ? {
          hostPageUrl: row.returnHostPageUrl,
          successUrl: row.returnSuccessUrl,
          cancelUrl: row.returnCancelUrl,
        }
      : null,
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
    const { returnContext, ...columns } = session;
    await this.ctx.db.checkoutSession.create({
      data: {
        ...columns,
        organizationId: scope.organizationId,
        returnHostPageUrl: returnContext?.hostPageUrl ?? null,
        returnSuccessUrl: returnContext?.successUrl ?? null,
        returnCancelUrl: returnContext?.cancelUrl ?? null,
      },
    });
  }

  async saveReturnContext(
    scope: OrganizationScope,
    paymentId: string,
    context: CheckoutReturnContext,
  ): Promise<void> {
    await this.ctx.db.checkoutSession.updateMany({
      where: { organizationId: scope.organizationId, paymentId },
      data: {
        returnHostPageUrl: context.hostPageUrl,
        returnSuccessUrl: context.successUrl,
        returnCancelUrl: context.cancelUrl,
      },
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
