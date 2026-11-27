'use client';

import Link from 'next/link';
import { ErrorState, NotFoundState } from '@/components/data-states';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/services/errors';
import { CALLBACK_STATUSES } from '@/lib/api/callbacks';
import { humanizeCode } from '@/utils/format';
import { useGateway } from '@/lib/queries/gateways';
import { GatewayFacts } from './gateway-summary';

const linkClass = 'text-sm font-medium underline-offset-4 hover:underline';

export function GatewayDetailScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useGateway(id);

  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading gateway" className="flex flex-col gap-6 px-4 pb-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        {isApiError(error) && error.isNotFound ? (
          <NotFoundState title="Gateway not found" description={`No PaymentGateway has the id ${id}. Check the link and try again.`} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  const gatewayId = encodeURIComponent(data.id);
  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <section aria-label="Gateway summary" className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">{data.id}</h2>
        <GatewayFacts gateway={data} />
      </section>

      <section aria-label="Callbacks in the last 24 hours" className="rounded-xl border p-4">
        <h2 className="mb-3 text-sm font-medium">Callbacks in the last 24 hours</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {CALLBACK_STATUSES.map((status) => (
            <div key={status} className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">
                <StatusBadge kind="callback" value={status} />
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">{data.callbackCounts[status]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Last Callback" className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-medium">Last Callback</h2>
          {data.lastCallbackAt ? (
            <TimeText iso={data.lastCallbackAt} />
          ) : (
            <p className="text-sm text-muted-foreground">No Callback received yet</p>
          )}
        </section>

        <section aria-label="Recent gateway errors" className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-medium">Recent gateway errors</h2>
          {data.recentErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gateway errors in the last 24 hours</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.recentErrors.map((e) => (
                <li key={e.category} className="flex items-center justify-between gap-2">
                  <span>{humanizeCode(e.category)}</span>
                  <span className="font-semibold tabular-nums">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <nav aria-label="Related" className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href={`/payments?gatewayId=${gatewayId}`} className={linkClass}>
          View Payments
        </Link>
        <Link href={`/callbacks?gatewayId=${gatewayId}`} className={linkClass}>
          View Callbacks
        </Link>
        <Link href={`/callbacks?gatewayId=${gatewayId}&status=FAILED`} className={linkClass}>
          View failed Callbacks
        </Link>
      </nav>
    </div>
  );
}
