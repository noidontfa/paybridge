import type { ReviewReason } from '../statuses.js';
import {
  REVIEW_REQUERY_WINDOW_MS,
  isReviewRequeryEligible,
} from './review-requery.js';

const OPENED = new Date('2026-05-01T10:00:00.000Z');
const at = (ms: number) => new Date(OPENED.getTime() + ms);
const attempt = (
  reviewReason: ReviewReason | null,
  status = 'REQUIRES_REVIEW',
) =>
  ({
    status,
    reviewReason,
    reviewOpenedAt: OPENED,
  }) as Parameters<typeof isReviewRequeryEligible>[0];

describe('isReviewRequeryEligible', () => {
  it.each(['AMBIGUOUS_PROVIDER_STATUS', 'AMOUNT_MISMATCH'] as const)(
    'is true for %s inside the 72 hour window',
    (reason) => {
      expect(isReviewRequeryEligible(attempt(reason), at(0))).toBe(true);
      expect(
        isReviewRequeryEligible(
          attempt(reason),
          at(REVIEW_REQUERY_WINDOW_MS - 1),
        ),
      ).toBe(true);
    },
  );

  it('is false at 72 hours and later', () => {
    expect(
      isReviewRequeryEligible(
        attempt('AMOUNT_MISMATCH'),
        at(REVIEW_REQUERY_WINDOW_MS),
      ),
    ).toBe(false);
  });

  it.each(['LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS'] as const)(
    'is false for %s',
    (reason) => {
      expect(isReviewRequeryEligible(attempt(reason), at(0))).toBe(false);
    },
  );

  it('is false for an attempt not in review', () => {
    expect(
      isReviewRequeryEligible(attempt('AMOUNT_MISMATCH', 'FAILED'), at(0)),
    ).toBe(false);
  });
});
