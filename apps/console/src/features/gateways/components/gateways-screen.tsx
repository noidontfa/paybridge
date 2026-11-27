'use client';

import { LandmarkIcon } from 'lucide-react';
import Link from 'next/link';
import { ErrorState } from '@/components/shared/data-states';
import { Skeleton } from '@/components/ui/skeleton';
import { useGatewayList } from '@/features/gateways/hooks/queries';
import { GatewayFacts } from './gateway-summary';

export function GatewaysScreen() {
  const { data, error, isPending, refetch } = useGatewayList();

  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading gateways" className="grid gap-4 px-4 pb-6 md:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data.items.length === 0) {
    return (
      <div className="px-4 pb-4">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <LandmarkIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-medium">No PaymentGateways are registered</h2>
          <p className="text-sm text-muted-foreground">The API reports no gateway for this deployment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 px-4 pb-6 md:grid-cols-2">
      {data.items.map((gateway) => (
        <article key={gateway.id} aria-label={gateway.id} className="rounded-xl border p-4">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            <Link href={`/gateways/${encodeURIComponent(gateway.id)}`} className="underline-offset-4 hover:underline">
              {gateway.id}
            </Link>
          </h2>
          <GatewayFacts gateway={gateway} />
        </article>
      ))}
    </div>
  );
}
