'use client';

import Link from 'next/link';
import { ErrorState } from '@/components/data-states';
import { StatusBadge } from '@/components/status-badge';
import { TimeText } from '@/components/time-text';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/operator';
import { usePaymentWebhookDeliveries } from '@/lib/queries/webhook-deliveries';
import { webhookDeliveryHref } from '@/components/webhook-deliveries/webhook-deliveries-columns';

/** The Webhook deliveries of one Payment's events, so an Operator can tell whether it was reported. */
export function PaymentWebhooks({ paymentId }: { paymentId: string }) {
  if (!useCan('webhook-deliveries:view')) return null;
  return <PaymentWebhookList paymentId={paymentId} />;
}

function PaymentWebhookList({ paymentId }: { paymentId: string }) {
  const list = usePaymentWebhookDeliveries(paymentId);

  return (
    <section aria-label="Webhook deliveries" className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-medium">Webhook deliveries</h2>
      {list.isPending && !list.error ? (
        <Skeleton role="status" aria-label="Loading Webhook deliveries" className="h-16 w-full rounded-lg" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Webhook was sent for this Payment.</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {list.rows.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center gap-3 border-t py-2 text-sm first:border-t-0">
                <Link href={webhookDeliveryHref(delivery)} className="font-mono text-xs font-medium underline-offset-4 hover:underline">
                  {delivery.eventKind}
                </Link>
                <StatusBadge kind="webhookDelivery" value={delivery.status} />
                <span className="font-mono text-xs break-all text-muted-foreground">{delivery.endpoint.url}</span>
                <span className="text-muted-foreground">
                  {delivery.attempts} {delivery.attempts === 1 ? 'attempt' : 'attempts'}
                  {delivery.lastAttemptAt && (
                    <>
                      , last <TimeText iso={delivery.lastAttemptAt} />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button variant="outline" size="sm" className="mt-2" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Show more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
