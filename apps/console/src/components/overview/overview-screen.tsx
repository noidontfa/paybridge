'use client';

import { InboxIcon } from 'lucide-react';
import { ErrorState } from '@/components/data-states';
import { Skeleton } from '@/components/ui/skeleton';
import { RANGE_LABELS, type OverviewRange } from '@/lib/overview-range';
import { useOverview } from '@/lib/queries/overview';
import { StatusChart, VolumeChart } from './overview-charts';
import { Figures, GatewayBreakdown, RecentPayments } from './overview-panels';
import { RangeSelector } from './range-selector';

/** The Overview body: range selector, figures, charts, gateway breakdown and recent Payments. */
export function OverviewScreen({ range, onRangeChange }: { range: OverviewRange; onRangeChange: (range: OverviewRange) => void }) {
  const { data, error, isPending, refetch } = useOverview(range);

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <div className="flex justify-end">
        <RangeSelector value={range} onChange={onRangeChange} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <OverviewSkeleton />
      ) : data.paymentCount === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-medium">No Payments in this range</h2>
          <p className="text-sm text-muted-foreground">
            No Payment was created in the {RANGE_LABELS[range].toLowerCase()}. Try a longer range.
          </p>
        </div>
      ) : (
        <>
          <Figures overview={data} />
          <div className="grid gap-4 xl:grid-cols-2">
            <VolumeChart overview={data} />
            <StatusChart overview={data} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <GatewayBreakdown gateways={data.gateways} />
            <RecentPayments payments={data.recentPayments} />
          </div>
        </>
      )}
    </div>
  );
}

/** Same grid as the loaded page, so the layout does not jump. */
function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading overview" className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-[26rem] rounded-xl" />
        <Skeleton className="h-[26rem] rounded-xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
