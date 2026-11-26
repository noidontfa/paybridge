import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../../common/principal/access-policy.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import {
  ManagePricingPlans,
  type PricingPlanDetail,
} from '../../application/use-cases/pricing-plans.js';
import type {
  PricingPlan,
  PricingPlanEditor,
} from '../../domain/entities/pricing-plan.js';
import { CheckoutErrorInterceptor } from './checkout-error.interceptor.js';
import { CheckoutEditor, CheckoutScope } from './current-scope.js';

// Shapes only; the Pricing Plan rules (lengths, Amount, URLs, Payment Expiry)
// are checked by the domain so every caller gets the same answers.
const planSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  features: z
    .array(z.object({ text: z.string(), included: z.boolean() }))
    .max(100)
    .optional(),
  amount: z.string(),
  allowedGatewayIds: z.array(z.string()).max(100).optional(),
  successUrl: z.string().nullable().optional(),
  cancelUrl: z.string().nullable().optional(),
  expiryMinutes: z.number().optional(),
});
type PlanBody = z.output<typeof planSchema>;

/** How a Super Admin's change is shown: done by the platform. */
const PLATFORM_LABEL = 'Super Admin (PayBridge)';

const editorView = (by: PricingPlanEditor) => ({
  userId: by.userId,
  role: by.role,
  name: by.name,
  label: by.role === 'SUPER_ADMIN' ? PLATFORM_LABEL : null,
});

const view = (plan: PricingPlan) => ({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  features: plan.features,
  amount: plan.amount,
  currency: plan.currency,
  allowedGatewayIds: plan.allowedGatewayIds,
  successUrl: plan.successUrl,
  cancelUrl: plan.cancelUrl,
  expiryMinutes: plan.expiryMinutes,
  status: plan.status,
  updatedBy: editorView(plan.updatedBy),
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

const detailView = ({ plan, pricingTables }: PricingPlanDetail) => ({
  ...view(plan),
  pricingTables,
});

/**
 * Pricing Plan management. Operators may read; every write is sensitive
 * (re-checked in the database, ADR 0008) and needs `pricing:manage`. Edits
 * are POSTs, so the Console's BFF needs no new methods.
 */
@ApiTags('internal')
@UseInterceptors(CheckoutErrorInterceptor)
@Controller(`${INTERNAL_PREFIX}/pricing-plans`)
export class PricingPlansController {
  constructor(
    @Inject(ManagePricingPlans) private readonly plans: ManagePricingPlans,
  ) {}

  @Get()
  @RequirePermission('pricing:view')
  @ApiOperation({ summary: "List the Organization's Pricing Plans" })
  async list(@CheckoutScope() scope: OrganizationScope) {
    const items = await this.plans.list(scope);
    return { items: items.map(view) };
  }

  @Get(':id')
  @RequirePermission('pricing:view')
  @ApiOperation({
    summary: 'One Pricing Plan, with the Pricing Tables that show it',
  })
  async get(
    @CheckoutScope() scope: OrganizationScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return detailView(await this.plans.get(scope, id));
  }

  @Post()
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({ summary: 'Create a Pricing Plan' })
  async create(
    @CheckoutScope() scope: OrganizationScope,
    @CheckoutEditor() editor: PricingPlanEditor,
    @Body(new ZodValidationPipe(planSchema)) body: PlanBody,
  ) {
    return view(await this.plans.create(scope, body, editor));
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({ summary: 'Replace every field of a Pricing Plan' })
  async update(
    @CheckoutScope() scope: OrganizationScope,
    @CheckoutEditor() editor: PricingPlanEditor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(planSchema)) body: PlanBody,
  ) {
    return view(await this.plans.update(scope, id, body, editor));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({
    summary:
      'Archive a Pricing Plan; returns the Pricing Tables that still show it',
  })
  async archive(
    @CheckoutScope() scope: OrganizationScope,
    @CheckoutEditor() editor: PricingPlanEditor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return detailView(await this.plans.archive(scope, id, editor));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({ summary: 'Restore an archived Pricing Plan' })
  async restore(
    @CheckoutScope() scope: OrganizationScope,
    @CheckoutEditor() editor: PricingPlanEditor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return detailView(await this.plans.restore(scope, id, editor));
  }

  @Delete(':id')
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({
    summary: 'Delete a Pricing Plan that no Payment references',
  })
  async delete(
    @CheckoutScope() scope: OrganizationScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.plans.delete(scope, id);
    return { deleted: true };
  }
}
