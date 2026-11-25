/**
 * `POST /internal/payments/:id/review-resolution`: resolve a Review, or add a
 * note to it. The body has no `actor`: the BFF sets it from the current
 * Operator (auth seam) and ignores anything the browser sends.
 */
import { z } from 'zod';
import { request } from './client';
import { attemptStatusSchema, paymentStatusSchema } from './schemas';

export const REVIEW_NOTE_MAX_LENGTH = 2000;

export interface ReviewResolutionBody {
  /** The Attempt Key of the PaymentTransaction in Review. */
  attemptId: string;
  note: string;
  /** Absent means "add a note only". */
  status?: 'SUCCEEDED' | 'FAILED';
  /** The amount the PaymentGateway collected, as a decimal string; required for SUCCEEDED. */
  amount?: string;
}

export const reviewResolutionResultSchema = z.object({
  paymentId: z.string(),
  attemptId: z.string(),
  /** Status of the PaymentTransaction after the call. */
  attemptStatus: attemptStatusSchema,
  paymentStatus: paymentStatusSchema,
});
export type ReviewResolutionResult = z.infer<typeof reviewResolutionResultSchema>;

export function resolveReview(paymentId: string, body: ReviewResolutionBody): Promise<ReviewResolutionResult> {
  return request(`/internal/payments/${encodeURIComponent(paymentId)}/review-resolution`, reviewResolutionResultSchema, {
    method: 'POST',
    body,
  });
}
