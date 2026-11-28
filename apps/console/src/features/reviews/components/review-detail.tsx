'use client';

import { ErrorState, NotFoundState } from '@/components/shared/data-states';
import { PaymentSummary } from '@/features/payments/components/payment-summary';
import { TransactionTimeline } from '@/features/payments/components/transaction-timeline';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/services/errors';
import { usePayment } from '@/features/payments/hooks/payments';
import { statusBadge } from '@/components/shared/status-badges';

export const REVIEW_DESCRIPTION = 'The Payment, the PaymentTransaction in Review and its status history.';

/** The heading of a Review: its reason once the Payment has loaded. Shares the Payment query with `ReviewDetail`. */
export function useReviewTitle(paymentId: string, transactionId: string): string {
  const { data } = usePayment(paymentId);
  const attempt = data?.attempts.find((a) => a.id === transactionId);
  return attempt?.reviewReason ? `Review: ${statusBadge('review', attempt.reviewReason).label}` : 'Review';
}

/**
 * The body of a Review: the Payment summary, the PaymentTransaction in Review
 * (with its Review panel) and its status history. One component for the
 * Review modal and the full Review page (`/exceptions/<payment>/<transaction>`).
 */
export function ReviewDetail({ paymentId, transactionId }: { paymentId: string; transactionId: string }) {
  const { data, error, isPending, refetch } = usePayment(paymentId);
  const attempt = data?.attempts.find((a) => a.id === transactionId);

  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading Review" className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (error && !(isApiError(error) && error.isNotFound)) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data || !attempt) {
    return <NotFoundState title="Review not found" description="This PaymentTransaction is not on that Payment. Check the link and try again." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <PaymentSummary payment={data} />
      <TransactionTimeline attempts={[attempt]} payment={data} />
    </div>
  );
}
