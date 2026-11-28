import type { PrismaClient } from '../src/generated/prisma/client.js';

// Seed Pricing Tables (embedded-checkout ticket 08): one table in the default
// Organization with its three seed Pricing Plans (Basic, Pro recommended, and
// the archived Legacy Starter, which shows as not buyable). Ids are fixed, so
// a re-run resets it to this state. Runs after `seedPricingPlans`.

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface SeedPricingTablesContext {
  /** Fixed UUID v5 for a seed name. */
  readonly id: (name: string) => string;
  readonly organizationId: string;
  /** Who last changed the table. */
  readonly editor: { readonly userId: string; readonly role: string; readonly name: string };
  readonly now: number;
}

export interface SeededPricingTable {
  readonly id: string;
  readonly name: string;
  readonly plans: number;
}

/** Creates or resets the seed Pricing Table. */
export async function seedPricingTables(
  tx: Tx,
  ctx: SeedPricingTablesContext,
): Promise<SeededPricingTable[]> {
  const tableId = ctx.id('pricing-table:primary-home');
  const planIds = ['primary-basic', 'primary-pro', 'primary-legacy'].map((key) =>
    ctx.id(`pricing-plan:${key}`),
  );
  const recommended = ctx.id('pricing-plan:primary-pro');
  const at = new Date(ctx.now);
  const data = {
    organizationId: ctx.organizationId,
    name: 'Home page pricing',
    mainColor: '#4f46e5',
    theme: 'light' as const,
    language: 'vi' as const,
    buttonText: 'Mua ngay',
    updatedByUserId: ctx.editor.userId,
    updatedByRole: ctx.editor.role,
    updatedByName: ctx.editor.name,
    createdAt: at,
    updatedAt: at,
  };
  await tx.pricingTablePlan.deleteMany({ where: { pricingTableId: tableId } });
  await tx.pricingTable.upsert({
    where: { id: tableId },
    update: data,
    create: { id: tableId, ...data },
  });
  await tx.pricingTablePlan.createMany({
    data: planIds.map((pricingPlanId, position) => ({
      pricingTableId: tableId,
      pricingPlanId,
      organizationId: ctx.organizationId,
      position,
      recommended: pricingPlanId === recommended,
    })),
  });
  return [{ id: tableId, name: data.name, plans: planIds.length }];
}
