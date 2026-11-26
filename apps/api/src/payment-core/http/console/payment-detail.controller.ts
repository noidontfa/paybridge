import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/filters/error-response.dto.js';
import { CurrentReadScope } from '../current-scope.decorator.js';
import type { ReadScope } from '../../domain/organization-scope.js';
import { RequirePermission } from '../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import { GetPaymentDetail } from '../../application/use-cases/console/get-payment-detail.js';

/**
 * Operator endpoint (no authentication in Phase 1; keep `/internal` off the
 * public ingress). The response shape is the Console's `operatorPaymentSchema`.
 */
@ApiTags('internal')
@RequirePermission('payments:view')
@Controller(`${INTERNAL_PREFIX}/payments`)
export class PaymentDetailController {
  constructor(
    @Inject(GetPaymentDetail) private readonly getPayment: GetPaymentDetail,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'A Payment with its attempts, their status history and its Payment Events (operator)',
  })
  @ApiOkResponse({ description: 'The operator Payment detail' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async detail(
    @CurrentReadScope() scope: ReadScope,
    @Param('id') id: string,
  ) {
    const p = await this.getPayment.execute(scope, id);
    if (!p) throw new NotFoundException(`Payment "${id}" not found`);
    return {
      id: p.id,
      upstreamReference: p.upstreamReference,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      expiresAt: p.expiresAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      attempts: p.attempts.map((a) => ({
        id: a.id,
        gatewayId: a.gatewayId,
        status: a.status,
        providerRef: a.providerRef,
        nextAction: a.nextAction ?? undefined,
        reviewReason: a.reviewReason ?? undefined,
        reviewOpenedAt: a.reviewOpenedAt?.toISOString(),
        refundRequired: a.refundRequired,
        providerReportedAmount: a.providerReportedAmount ?? undefined,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        transitions: a.transitions.map((t) => ({
          id: t.id,
          entityType: t.entityType,
          entityId: t.entityId,
          fromStatus: t.fromStatus,
          toStatus: t.toStatus,
          trigger: t.trigger,
          actor: t.actor,
          reason: t.reason,
          createdAt: t.createdAt.toISOString(),
        })),
      })),
      events: p.events.map((e) => ({
        id: e.id,
        type: e.type,
        paymentId: e.paymentId,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
        publishedAt: e.publishedAt?.toISOString() ?? null,
      })),
    };
  }
}
