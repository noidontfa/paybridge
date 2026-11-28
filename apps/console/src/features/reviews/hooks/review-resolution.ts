'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { resolveReview, type ReviewResolutionBody } from '@/features/reviews/review-resolution';
import { overviewKeys } from '@/features/overview/hooks/queries';
import { paymentKeys } from '@/features/payments/hooks/payments';
import { reviewKeys } from './reviews';

/**
 * Resolve a Review, or add a note to it. A success changes what the Reviews
 * list and summary (sidebar badge), the Payments list and detail, and the
 * Overview show, so all of them are refetched.
 */
export function useResolveReview(paymentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewResolutionBody) => resolveReview(paymentId, body),
    // The toast comes first and lives here, not in a per-call callback: the refetch below closes the
    // Review and unmounts the form, and per-call callbacks do not run for an unmounted component.
    onSuccess: async (result, body) => {
      toast.success(body.status ? `Review resolved: the PaymentTransaction is now ${result.attemptStatus}.` : 'Note added to the Review.');
      await Promise.all([
        client.invalidateQueries({ queryKey: reviewKeys.all }),
        client.invalidateQueries({ queryKey: paymentKeys.all }),
        client.invalidateQueries({ queryKey: overviewKeys.all }),
      ]);
    },
  });
}
