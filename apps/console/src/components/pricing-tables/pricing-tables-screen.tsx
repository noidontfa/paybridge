'use client';

import Link from 'next/link';
import { ErrorState } from '@/components/data-states';
import { PRICING_MANAGE } from '@/components/pricing-plans/pricing-plans-screen';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  const planName = (id: string) => plans.data?.items.find((p) => p.id === id)?.name ?? '…';

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      {canManage && (
        <div>
          <Link href="/pricing-tables/new" className={buttonVariants()}>
            New Pricing Table
          </Link>
        </div>
      )}
      {isPending && !error ? (
        <Skeleton role="status" aria-label="Loading Pricing Tables" className="h-24 rounded-xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Pricing Tables yet.</p>
      ) : (
        <table aria-label="Pricing Tables" className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Name</th>
              <th>Pricing Plans</th>
              <th>Look</th>
              <th>Last changed by</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((table) => (
              <tr key={table.id} className="border-t">
                <td className="py-2">
                  <Link href={`/pricing-tables/${encodeURIComponent(table.id)}`} className="font-medium underline-offset-4 hover:underline">
                    {table.name}
                  </Link>
                </td>
                <td>
                  {table.planIds
                    .map((id) => (id === table.recommendedPlanId ? `${planName(id)} (recommended)` : planName(id)))
                    .join(', ')}
                </td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="inline-block size-3 rounded-full border" style={{ backgroundColor: table.mainColor }} />
                    {THEME_NAMES[table.theme]}, {LANGUAGE_NAMES[table.language]}
                  </span>
                </td>
                <td>{tableEditorLabel(table)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
