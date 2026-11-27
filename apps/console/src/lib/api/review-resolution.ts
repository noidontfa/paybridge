/**
 * `POST /internal/payments/:id/review-resolution`: resolve a Review, or add a
 * note to it. The body has no `actor`: the BFF sets it from the current
 * Operator (auth seam) and ignores anything the browser sends.
 */
import { z } from 'zod';
import { request } from '@/services/client';
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

/**
 * The real API answers with the Payment (its attempts included), the mock with the small
 * result above. Both are accepted; `toReviewResolutionResult` reduces either to the result.
 */
export const reviewResolutionResponseSchema = z.union([
  reviewResolutionResultSchema,
  z.object({
    id: z.string(),
    status: paymentStatusSchema,
    attempts: z.array(z.object({ id: z.string(), status: attemptStatusSchema })),
  }),
]);
export type ReviewResolutionResponse = z.infer<typeof reviewResolutionResponseSchema>;

export function toReviewResolutionResult(response: ReviewResolutionResponse, attemptId: string): ReviewResolutionResult {
  if ('paymentId' in response) return response;
  const attempt = response.attempts.find((a) => a.id === attemptId);
  if (!attempt) throw new Error(`The API response does not contain the attempt ${attemptId}.`);
  return { paymentId: response.id, attemptId, attemptStatus: attempt.status, paymentStatus: response.status };
}

export async function resolveReview(paymentId: string, body: ReviewResolutionBody): Promise<ReviewResolutionResult> {
  const response = await request(
    `/internal/payments/${encodeURIComponent(paymentId)}/review-resolution`,
    reviewResolutionResponseSchema,
    { method: 'POST', body },
  );
  return toReviewResolutionResult(response, body.attemptId);
}
