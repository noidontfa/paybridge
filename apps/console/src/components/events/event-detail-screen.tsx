'use client';

import Link from 'next/link';
import { ErrorState, NotFoundState } from '@/components/data-states';
import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api/errors';
import { usePaymentEvent } from '@/lib/queries/payment-events';
import { paymentHref } from './events-columns';

/** One Payment Event: what it is, when it was emitted and relayed, and the payload downstream systems receive. */
export function EventDetailScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = usePaymentEvent(id);

  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading Payment Event" className="flex flex-col gap-6 px-4 pb-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        {isApiError(error) && error.isNotFound ? (
          <NotFoundState title="Payment Event not found" description={`No Payment Event has the id ${id}. Check the link and try again.`} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  const payload = JSON.stringify(data.payload, null, 2);
  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <section aria-label="Payment Event summary" className="rounded-xl border p-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Type</dt>
            <dd>
              <StatusBadge kind="event" value={data.type} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Payment</dt>
            <dd className="min-w-0">
              <Link href={paymentHref(data.paymentId)} className="block truncate font-mono text-xs underline-offset-4 hover:underline">
                {data.paymentId}
              </Link>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Created</dt>
            <dd>
              <TimeText iso={data.createdAt} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Published</dt>
            <dd>
              {data.publishedAt ? (
                <TimeText iso={data.publishedAt} />
              ) : (
                <span className="inline-flex w-fit rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Unpublished
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="payload-heading" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="payload-heading" className="text-base font-semibold">
            Payload
          </h2>
          <CopyButton value={payload} label="payload" />
        </div>
        <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-4 font-mono text-xs leading-relaxed">{payload}</pre>
      </section>
    </div>
  );
}
