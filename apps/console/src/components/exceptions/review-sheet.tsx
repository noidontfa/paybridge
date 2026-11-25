'use client';

import { ErrorState, NotFoundState } from '@/components/data-states';
import { PaymentSummary } from '@/components/payment-detail/payment-summary';
import { TransactionTimeline } from '@/components/payment-detail/transaction-timeline';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api/errors';
import { usePayment } from '@/lib/queries/payments';
import { statusBadge } from '@/lib/status-badges';

/**
 * The side sheet of a Review: the Payment summary, the PaymentTransaction in
 * Review (with its Review panel) and its status history. Which Review is open
 * is the Payment id and the Attempt Key; the screen keeps both in the URL.
 */
export function ReviewSheet({ paymentId, transactionId, onClose }: { paymentId: string; transactionId: string; onClose: () => void }) {
  const { data, error, isPending, refetch } = usePayment(paymentId);
  const attempt = data?.attempts.find((a) => a.id === transactionId);
  const title = attempt?.reviewReason ? `Review: ${statusBadge('review', attempt.reviewReason).label}` : 'Review';

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>The Payment, the PaymentTransaction in Review and its status history.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {isPending && !error ? (
            <div role="status" aria-label="Loading Review" className="flex flex-col gap-3">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          ) : error && !(isApiError(error) && error.isNotFound) ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : !data || !attempt ? (
            <NotFoundState title="Review not found" description="This PaymentTransaction is not on that Payment. Check the link and try again." />
          ) : (
            <>
              <PaymentSummary payment={data} />
              <TransactionTimeline attempts={[attempt]} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
