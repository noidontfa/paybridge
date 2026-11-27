import { ReviewDetail } from '@/features/reviews/components/review-detail';

/** The full-page Review, shown on a reload or a shared link. */
export function ReviewPage({ paymentId, transactionId }: { paymentId: string; transactionId: string }) {
  return (
    <div className="px-4 pb-4">
      <ReviewDetail paymentId={paymentId} transactionId={transactionId} />
    </div>
  );
}
