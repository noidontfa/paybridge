import { roleOf } from '../../../common/principal/actor.js';
import type { PricingPlan as PricingPlanRow } from '../../../generated/prisma/client.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type {
  PricingPlan,
  Actor,
  PricingPlanFeature,
  PricingPlanStatus,
  PricingPlanTerms,
} from '../../domain/entities/pricing-plan.js';
import {
  PricingPlanRepository,
  type NewPricingPlan,
} from '../../domain/repositories/pricing-plan.repository.js';
import type { DbContext } from './db.js';

function toPlan(row: PricingPlanRow): PricingPlan {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    features: row.features as unknown as PricingPlanFeature[],
    // An exact decimal string with no exponent and no trailing zeros.
    amount: row.amount.toFixed(),
    currency: row.currency,
    allowedGatewayIds: row.allowedGatewayIds,
    successUrl: row.successUrl,
    cancelUrl: row.cancelUrl,
    expiryMinutes: row.expiryMinutes,
    status: row.status,
    updatedBy: {
      userId: row.updatedByUserId,
      role: roleOf(row.updatedByRole),
      name: row.updatedByName,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function termColumns(terms: PricingPlanTerms) {
  return {
    name: terms.name,
    description: terms.description,
    features: terms.features.map((f) => ({
      text: f.text,
      included: f.included,
    })),
    amount: terms.amount,
    currency: terms.currency,
    allowedGatewayIds: [...terms.allowedGatewayIds],
    successUrl: terms.successUrl,
    cancelUrl: terms.cancelUrl,
    expiryMinutes: terms.expiryMinutes,
  };
}

function editorColumns(by: Actor, at: Date) {
  return {
    updatedByUserId: by.userId,
    updatedByRole: by.role,
    updatedByName: by.name,
    updatedAt: at,
  };
}

/** Pricing Plans in `chk_pricing_plans`, always filtered by Organization. */
export class PrismaPricingPlanRepository extends PricingPlanRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(
    scope: OrganizationScope,
    plan: NewPricingPlan,
  ): Promise<PricingPlan> {
    const row = await this.ctx.db.pricingPlan.create({
      data: {
        id: plan.id,
        organizationId: scope.organizationId,
        ...termColumns(plan),
        ...editorColumns(plan.updatedBy, plan.at),
        createdAt: plan.at,
      },
    });
    return toPlan(row);
  }

  async list(scope: OrganizationScope): Promise<PricingPlan[]> {
    const rows = await this.ctx.db.pricingPlan.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toPlan);
  }

  async findById(
    scope: OrganizationScope,
    id: string,
  ): Promise<PricingPlan | null> {
    const row = await this.ctx.db.pricingPlan.findFirst({
      where: { id, organizationId: scope.organizationId },
    });
    return row ? toPlan(row) : null;
  }

  update(
    scope: OrganizationScope,
    id: string,
    terms: PricingPlanTerms,
    by: Actor,
    at: Date,
  ): Promise<PricingPlan | null> {
    return this.change(scope, id, {
      ...termColumns(terms),
      ...editorColumns(by, at),
    });
  }

  setStatus(
    scope: OrganizationScope,
    id: string,
    status: PricingPlanStatus,
    by: Actor,
    at: Date,
  ): Promise<PricingPlan | null> {
    return this.change(scope, id, { status, ...editorColumns(by, at) });
  }

  async delete(scope: OrganizationScope, id: string): Promise<boolean> {
    const { count } = await this.ctx.db.pricingPlan.deleteMany({
      where: { id, organizationId: scope.organizationId },
    });
    return count > 0;
  }

  private async change(
    scope: OrganizationScope,
    id: string,
    data: Parameters<DbContext['db']['pricingPlan']['updateMany']>[0]['data'],
  ): Promise<PricingPlan | null> {
    const { count } = await this.ctx.db.pricingPlan.updateMany({
      where: { id, organizationId: scope.organizationId },
      data,
    });
    if (count === 0) return null;
    return this.findById(scope, id);
  }
}
