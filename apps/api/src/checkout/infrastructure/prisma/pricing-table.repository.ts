import type {
  PricingTable as PricingTableRow,
  PricingTablePlan as PricingTablePlanRow,
} from '../../../generated/prisma/client.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import type { PricingPlanEditor } from '../../domain/entities/pricing-plan.js';
import type {
  PricingTable,
  PricingTableTerms,
} from '../../domain/entities/pricing-table.js';
import {
  PricingTableRepository,
  type NewPricingTable,
} from '../../domain/repositories/pricing-table.repository.js';
import type { PricingTableRef } from '../../domain/services/pricing-plan-references.js';
import type { DbContext } from './db.js';

type Row = PricingTableRow & { plans: PricingTablePlanRow[] };

const withPlans = { plans: { orderBy: { position: 'asc' } } } as const;

function toTable(row: Row): PricingTable {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    planIds: row.plans.map((p) => p.pricingPlanId),
    recommendedPlanId: row.plans.find((p) => p.recommended)?.pricingPlanId ?? null,
    mainColor: row.mainColor,
    theme: row.theme,
    language: row.language,
    buttonText: row.buttonText,
    updatedBy: {
      userId: row.updatedByUserId,
      role: row.updatedByRole,
      name: row.updatedByName,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function lookColumns(terms: PricingTableTerms, by: PricingPlanEditor, at: Date) {
  return {
    name: terms.name,
    mainColor: terms.mainColor,
    theme: terms.theme,
    language: terms.language,
    buttonText: terms.buttonText,
    updatedByUserId: by.userId,
    updatedByRole: by.role,
    updatedByName: by.name,
    updatedAt: at,
  };
}

function planRows(scope: OrganizationScope, terms: PricingTableTerms) {
  return terms.planIds.map((pricingPlanId, position) => ({
    pricingPlanId,
    organizationId: scope.organizationId,
    position,
    recommended: pricingPlanId === terms.recommendedPlanId,
  }));
}

/**
 * Pricing Tables in `chk_pricing_tables`, their Pricing Plans in
 * `chk_pricing_table_plans`; always filtered by Organization.
 */
export class PrismaPricingTableRepository extends PricingTableRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  async create(scope: OrganizationScope, table: NewPricingTable): Promise<PricingTable> {
    await this.ctx.db.pricingTable.create({
      data: {
        id: table.id,
        organizationId: scope.organizationId,
        ...lookColumns(table, table.updatedBy, table.at),
        createdAt: table.at,
      },
    });
    await this.ctx.db.pricingTablePlan.createMany({
      data: planRows(scope, table).map((p) => ({ ...p, pricingTableId: table.id })),
    });
    return (await this.findById(scope, table.id))!;
  }

  async list(scope: OrganizationScope): Promise<PricingTable[]> {
    const rows = await this.ctx.db.pricingTable.findMany({
      where: { organizationId: scope.organizationId },
      include: withPlans,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toTable);
  }

  async findById(scope: OrganizationScope, id: string): Promise<PricingTable | null> {
    const row = await this.ctx.db.pricingTable.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: withPlans,
    });
    return row ? toTable(row) : null;
  }

  async update(
    scope: OrganizationScope,
    id: string,
    terms: PricingTableTerms,
    by: PricingPlanEditor,
    at: Date,
  ): Promise<PricingTable | null> {
    const { count } = await this.ctx.db.pricingTable.updateMany({
      where: { id, organizationId: scope.organizationId },
      data: lookColumns(terms, by, at),
    });
    if (count === 0) return null;
    await this.ctx.db.pricingTablePlan.deleteMany({
      where: { pricingTableId: id, organizationId: scope.organizationId },
    });
    await this.ctx.db.pricingTablePlan.createMany({
      data: planRows(scope, terms).map((p) => ({ ...p, pricingTableId: id })),
    });
    return this.findById(scope, id);
  }

  async delete(scope: OrganizationScope, id: string): Promise<boolean> {
    await this.ctx.db.pricingTablePlan.deleteMany({
      where: { pricingTableId: id, organizationId: scope.organizationId },
    });
    const { count } = await this.ctx.db.pricingTable.deleteMany({
      where: { id, organizationId: scope.organizationId },
    });
    return count > 0;
  }

  async including(
    scope: OrganizationScope,
    pricingPlanId: string,
  ): Promise<PricingTableRef[]> {
    return this.ctx.db.pricingTable.findMany({
      where: {
        organizationId: scope.organizationId,
        plans: { some: { pricingPlanId, organizationId: scope.organizationId } },
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
}
