'use client';

import Link from 'next/link';
import { ErrorState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PricingPlan } from '@/lib/api/pricing-plans';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/operator';
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
    <div className="flex flex-col gap-4 px-4 pb-6">
      {canManage && (
        <div>
          <Link href="/pricing-plans/new" className={buttonVariants()}>
            New Pricing Plan
          </Link>
        </div>
      )}
      {isPending && !error ? (
        <Skeleton role="status" aria-label="Loading Pricing Plans" className="h-24 rounded-xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Pricing Plans yet.</p>
      ) : (
        <table aria-label="Pricing Plans" className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Name</th>
              <th>Amount</th>
              <th>Features</th>
              <th>Gateways</th>
              <th>Payment Expiry</th>
              <th>Status</th>
              <th>Last changed by</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((plan) => (
              <tr key={plan.id} className="border-t">
                <td className="py-2">
                  <Link href={`/pricing-plans/${encodeURIComponent(plan.id)}`} className="font-medium underline-offset-4 hover:underline">
                    {plan.name}
                  </Link>
                </td>
                <td className="tabular-nums">{formatMoney(plan.amount)}</td>
                <td>{plan.features.length}</td>
                <td>{gatewaysLabel(plan.allowedGatewayIds)}</td>
                <td>{plan.expiryMinutes} min</td>
                <td>
                  <Badge variant={plan.status === 'ACTIVE' ? 'default' : 'secondary'}>
                    {plan.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </td>
                <td>{editorLabel(plan)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
