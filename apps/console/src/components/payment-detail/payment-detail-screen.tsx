'use client';

import { NotFoundState, ErrorState } from '@/components/data-states';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api/errors';
import { usePayment } from '@/lib/queries/payments';
import { PaymentEvents } from './payment-events';
import { PaymentSummary } from './payment-summary';
import { TransactionTimeline } from './transaction-timeline';

/** The Payment detail page body: summary, PaymentTransaction timeline, Payment Events. */
export function PaymentDetailScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = usePayment(id);

  if (isPending && !error) return <PaymentDetailSkeleton />;
  if (error) {
    return (
      <div className="px-4 pb-4">
        {isApiError(error) && error.isNotFound ? (
          <NotFoundState title="Payment not found" description={`No Payment has the id ${id}. Check the link and try again.`} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <PaymentSummary payment={data} />
      <TransactionTimeline attempts={data.attempts} />
      <PaymentEvents events={data.events} />
    </div>
  );
}

function PaymentDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading payment" className="flex flex-col gap-6 px-4 pb-6">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
