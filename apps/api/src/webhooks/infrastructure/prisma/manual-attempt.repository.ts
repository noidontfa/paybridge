import type { Prisma } from '../../../generated/prisma/client.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type {
  DeliveryAttemptResult,
  NewWebhookDelivery,
} from '../../domain/entities/webhook-delivery.js';
import type { Actor } from '../../domain/entities/webhook-endpoint.js';
import { ManualAttemptRepository } from '../../domain/repositories/manual-attempt.repository.js';
import type { DbContext } from './db.js';

function attemptRow(
  organizationId: string,
  deliveryId: string,
  attemptId: string,
  result: DeliveryAttemptResult,
  actor: Actor,
): Prisma.WebhookDeliveryAttemptUncheckedCreateInput {
  return {
    id: attemptId,
    organizationId,
    deliveryId,
    attemptedAt: result.attemptedAt,
    succeeded: result.succeeded,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    responseBody: result.responseBody,
    error: result.error,
    triggeredByUserId: actor.userId,
    triggeredByRole: actor.role,
    triggeredByName: actor.name,
  };
}

/** Resends and test sends, in `wh_deliveries` and `wh_delivery_attempts`. */
export class PrismaManualAttemptRepository extends ManualAttemptRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async recordResend(
    scope: OrganizationScope,
    deliveryId: string,
    attemptId: string,
    result: DeliveryAttemptResult,
    actor: Actor,
  ): Promise<boolean> {
    const { count } = await this.ctx.db.webhookDelivery.updateMany({
      where: { id: deliveryId, organizationId: scope.organizationId },
      data: {
        attempts: { increment: 1 },
        // Delivered: no automatic retry is due any more.
        ...(result.succeeded && { status: 'SUCCEEDED', nextAttemptAt: null }),
      },
    });
    if (count === 0) return false;
    await this.ctx.db.webhookDeliveryAttempt.create({
      data: attemptRow(
        scope.organizationId,
        deliveryId,
        attemptId,
        result,
        actor,
      ),
    });
    return true;
  }

  async recordTestSend(
    scope: OrganizationScope,
    delivery: NewWebhookDelivery,
    attemptId: string,
    result: DeliveryAttemptResult,
    actor: Actor,
  ): Promise<void> {
    await this.ctx.db.webhookDelivery.create({
      data: {
        id: delivery.id,
        organizationId: scope.organizationId,
        endpointId: delivery.endpointId,
        eventId: delivery.eventId,
        eventKind: delivery.eventKind,
        eventCreatedAt: delivery.eventCreatedAt,
        paymentId: delivery.paymentId,
        payload: (delivery.data ?? null) as Prisma.InputJsonValue,
        status: result.succeeded ? 'SUCCEEDED' : 'FAILED',
        attempts: 1,
      },
    });
    await this.ctx.db.webhookDeliveryAttempt.create({
      data: attemptRow(
        scope.organizationId,
        delivery.id,
        attemptId,
        result,
        actor,
      ),
    });
  }
}
