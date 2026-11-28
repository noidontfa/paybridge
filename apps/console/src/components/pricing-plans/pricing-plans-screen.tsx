'use client';

import Link from 'next/link';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/shared/data-table/data-table';
import { EmptyListState } from '@/components/shared/data-states';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { PricingPlan } from '@/lib/api/pricing-plans';
import { formatMoney } from '@/utils/format';
import { useCan } from '@/features/auth/hooks/use-operator';
import { usePricingPlans } from '@/lib/queries/pricing-plans';

export const PRICING_MANAGE = 'pricing:manage';

/** Who last changed a Pricing Plan; a Super Admin's change is the platform's. */
export function editorLabel(plan: Pick<PricingPlan, 'updatedBy'>): string {
  return plan.updatedBy.label ?? plan.updatedBy.name;
}

export function gatewaysLabel(ids: readonly string[]): string {
  return ids.length === 0 ? 'Every enabled gateway' : ids.join(', ');
}

/** The Organization's Pricing Plans. Organization Admins also get "New Pricing Plan". */
export function PricingPlansScreen() {
  const canManage = useCan(PRICING_MANAGE);
  const { data, error, isPending, refetch } = usePricingPlans();

  return (
    <div className="px-4 pb-6">
      <DataTable
        label="Pricing Plans"
        columns={PLAN_COLUMNS}
        rows={data?.items ?? []}
        getRowId={(plan) => plan.id}
        getRowHref={(plan) => `/pricing-plans/${encodeURIComponent(plan.id)}`}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        toolbar={
          canManage && (
            <div>
              <Link href="/pricing-plans/new" className={buttonVariants()}>
                New Pricing Plan
              </Link>
            </div>
          )
        }
        emptyState={
          <EmptyListState
            title="No Pricing Plans yet."
            description="A Pricing Plan is what a Customer buys from a Pricing Table: a name, an Amount and its features."
          />
        }
      />
    </div>
  );
}

const column = createDataTableColumnHelper<PricingPlan>();

const PLAN_COLUMNS: DataTableColumns<PricingPlan> = column.columns([
  column.accessor('name', {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Link href={`/pricing-plans/${encodeURIComponent(row.original.id)}`} className="font-medium underline-offset-4 hover:underline">
        {row.original.name}
      </Link>
    ),
  }),
  column.display({
    id: 'amount',
    header: 'Amount',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.amount)}</span>,
  }),
  column.display({
    id: 'features',
    header: 'Features',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.features.length}</span>,
  }),
  column.display({
    id: 'gateways',
    header: 'Gateways',
    cell: ({ row }) =>
      row.original.allowedGatewayIds.length === 0 ? (
        <span className="text-muted-foreground">{gatewaysLabel(row.original.allowedGatewayIds)}</span>
      ) : (
        <span className="font-mono text-xs">{gatewaysLabel(row.original.allowedGatewayIds)}</span>
      ),
  }),
  column.display({
    id: 'expiry',
    header: 'Payment Expiry',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.expiryMinutes} min</span>,
  }),
  column.display({
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'ACTIVE' ? 'default' : 'secondary'}>
        {row.original.status === 'ACTIVE' ? 'Active' : 'Archived'}
      </Badge>
    ),
  }),
  column.display({
    id: 'updatedBy',
    header: 'Last changed by',
    cell: ({ row }) => editorLabel(row.original),
  }),
]);
