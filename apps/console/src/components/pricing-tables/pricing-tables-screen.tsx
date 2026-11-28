'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/data-table/data-table';
import { EmptyListState } from '@/components/data-states';
import { PRICING_MANAGE } from '@/components/pricing-plans/pricing-plans-screen';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { PricingTable } from '@/lib/api/pricing-tables';
import { useCan } from '@/lib/operator';
import { usePricingPlans } from '@/lib/queries/pricing-plans';
import { usePricingTables } from '@/lib/queries/pricing-tables';

export const LANGUAGE_NAMES = { vi: 'Tiếng Việt', en: 'English' } as const;
export const THEME_NAMES = { light: 'Light', dark: 'Dark' } as const;

/** Who last changed a Pricing Table; a Super Admin's change is the platform's. */
export function tableEditorLabel(table: Pick<PricingTable, 'updatedBy'>): string {
  return table.updatedBy.label ?? table.updatedBy.name;
}

/** The Organization's Pricing Tables. Organization Admins also get "New Pricing Table". */
export function PricingTablesScreen() {
  const canManage = useCan(PRICING_MANAGE);
  const { data, error, isPending, refetch } = usePricingTables();
  const plans = usePricingPlans();
  const planItems = plans.data?.items;
  const planName = useCallback((id: string) => planItems?.find((p) => p.id === id)?.name ?? '…', [planItems]);

  const columns = useMemo(() => tableColumns(planName), [planName]);

  return (
    <div className="px-4 pb-6">
      <DataTable
        label="Pricing Tables"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(table) => table.id}
        getRowHref={(table) => `/pricing-tables/${encodeURIComponent(table.id)}`}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        toolbar={
          canManage && (
            <div>
              <Link href="/pricing-tables/new" className={buttonVariants()}>
                New Pricing Table
              </Link>
            </div>
          )
        }
        emptyState={
          <EmptyListState
            title="No Pricing Tables yet."
            description="A Pricing Table shows one to three Pricing Plans on your website through the checkout snippet."
          />
        }
      />
    </div>
  );
}

const column = createDataTableColumnHelper<PricingTable>();

function tableColumns(planName: (id: string) => string): DataTableColumns<PricingTable> {
  return column.columns([
    column.accessor('name', {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link href={`/pricing-tables/${encodeURIComponent(row.original.id)}`} className="font-medium underline-offset-4 hover:underline">
          {row.original.name}
        </Link>
      ),
    }),
    column.display({
      id: 'plans',
      header: 'Pricing Plans',
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          {row.original.planIds.map((id) => (
            <Badge key={id} variant={id === row.original.recommendedPlanId ? 'default' : 'secondary'}>
              {id === row.original.recommendedPlanId ? `${planName(id)} (recommended)` : planName(id)}
            </Badge>
          ))}
        </span>
      ),
    }),
    column.display({
      id: 'look',
      header: 'Look',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className="inline-block size-3 rounded-full border" style={{ backgroundColor: row.original.mainColor }} />
          {THEME_NAMES[row.original.theme]}, {LANGUAGE_NAMES[row.original.language]}
        </span>
      ),
    }),
    column.display({
      id: 'updatedBy',
      header: 'Last changed by',
      cell: ({ row }) => tableEditorLabel(row.original),
    }),
  ]);
}
