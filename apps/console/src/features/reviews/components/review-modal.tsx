'use client';

import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { REVIEW_DESCRIPTION, ReviewDetail, useReviewTitle } from '@/features/reviews/components/review-detail';

/**
 * The Review as a modal over the Exceptions list. Rendered by the intercepted
 * route (`app/@modal/(.)exceptions/...`); closing goes back, so the list keeps
 * its filters. A reload shows the full page instead.
 */
export function ReviewModal({ paymentId, transactionId }: { paymentId: string; transactionId: string }) {
  const router = useRouter();
  const title = useReviewTitle(paymentId, transactionId);
  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{REVIEW_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-4 pb-4">
          <ReviewDetail paymentId={paymentId} transactionId={transactionId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
