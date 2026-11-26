import { describe, expect, it } from 'vitest';
import {
  reviewResolutionResponseSchema,
  toReviewResolutionResult,
} from './review-resolution';

// What the real API answers (the Payment with its attempts), cut down to the fields the Console reads.
const apiResponse = {
  id: 'p-1',
  status: 'PENDING',
  attempts: [
    { id: 'a-1', status: 'FAILED' },
    { id: 'a-2', status: 'REQUIRES_REVIEW' },
  ],
};
// What the Console's mock answers.
const mockResponse = {
  paymentId: 'p-1',
  attemptId: 'a-2',
  attemptStatus: 'SUCCEEDED',
  paymentStatus: 'SUCCEEDED',
};

describe('toReviewResolutionResult', () => {
  it('reads the resolved attempt out of the Payment the API answers with', () => {
    const parsed = reviewResolutionResponseSchema.parse(apiResponse);
    expect(toReviewResolutionResult(parsed, 'a-2')).toEqual({
      paymentId: 'p-1',
      attemptId: 'a-2',
      attemptStatus: 'REQUIRES_REVIEW',
      paymentStatus: 'PENDING',
    });
  });

  it('passes the mock shape through', () => {
    const parsed = reviewResolutionResponseSchema.parse(mockResponse);
    expect(toReviewResolutionResult(parsed, 'a-2')).toEqual(mockResponse);
  });

  it('rejects an attempt the response does not contain', () => {
    const parsed = reviewResolutionResponseSchema.parse(apiResponse);
    expect(() => toReviewResolutionResult(parsed, 'nope')).toThrow();
  });
});
