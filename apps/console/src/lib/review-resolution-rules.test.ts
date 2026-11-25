import { describe, expect, it } from 'vitest';
import type { ReviewReason } from '@/lib/api/schemas';
import { reviewActions, type ReviewFacts } from './review-resolution-rules';

const NOW = new Date('2026-11-25T12:00:00.000Z');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function facts(overrides: Partial<ReviewFacts> = {}): ReviewFacts {
  return {
    reason: 'AMBIGUOUS_PROVIDER_STATUS',
    attemptStatus: 'REQUIRES_REVIEW',
    reviewOpenedAt: ago(100),
    paymentStatus: 'PENDING',
    ...overrides,
  };
}

const allowed = (reason: ReviewReason, overrides: Partial<ReviewFacts> = {}) => {
  const a = reviewActions(facts({ reason, ...overrides }), NOW);
  return { succeed: a.succeed.allowed, fail: a.fail.allowed, note: a.note.allowed };
};

describe('reviewActions', () => {
  it('lets AMBIGUOUS_PROVIDER_STATUS resolve to SUCCEEDED or FAILED, not just note', () => {
    expect(allowed('AMBIGUOUS_PROVIDER_STATUS')).toEqual({ succeed: true, fail: true, note: false });
  });

  it('offers only FAILED for AMOUNT_MISMATCH', () => {
    expect(allowed('AMOUNT_MISMATCH')).toEqual({ succeed: false, fail: true, note: false });
    const { succeed } = reviewActions(facts({ reason: 'AMOUNT_MISMATCH' }), NOW);
    expect(succeed).toEqual({ allowed: false, reason: expect.stringContaining('amount') });
  });

  it.each(['LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS'] as const)('offers only a note for %s', (reason) => {
    expect(allowed(reason, { paymentStatus: 'EXPIRED' })).toEqual({ succeed: false, fail: false, note: true });
  });

  it.each(['SUCCEEDED', 'EXPIRED', 'CANCELLED'] as const)(
    'offers SUCCEEDED only while the Payment is PENDING (not %s)',
    (paymentStatus) => {
      const { succeed, fail } = reviewActions(facts({ paymentStatus }), NOW);
      expect(succeed.allowed).toBe(false);
      expect(succeed).toMatchObject({ reason: expect.stringContaining('PENDING') });
      expect(fail.allowed).toBe(true);
    },
  );

  it('locks status resolutions until the Review has been open for 72 hours', () => {
    for (const reason of ['AMBIGUOUS_PROVIDER_STATUS', 'AMOUNT_MISMATCH'] as const) {
      const a = reviewActions(facts({ reason, reviewOpenedAt: ago(71.9) }), NOW);
      for (const verdict of [a.succeed, a.fail, a.note]) {
        expect(verdict.allowed).toBe(false);
        expect(verdict).toMatchObject({ reason: expect.stringContaining('72 hours') });
      }
      expect(a.locked).toBe(true);
    }
  });

  it.each(['LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS'] as const)(
    'does not lock a note on %s: Core accepts notes on these at any time',
    (reason) => {
      expect(allowed(reason, { reviewOpenedAt: ago(1), paymentStatus: 'EXPIRED' })).toEqual({ succeed: false, fail: false, note: true });
      expect(reviewActions(facts({ reason, reviewOpenedAt: ago(1) }), NOW).locked).toBe(false);
    },
  );

  it('unlocks at exactly 72 hours', () => {
    const a = reviewActions(facts({ reviewOpenedAt: ago(72) }), NOW);
    expect(a.locked).toBe(false);
    expect(a.fail.allowed).toBe(true);
  });

  it('allows nothing once the Review is no longer open', () => {
    const a = reviewActions(facts({ attemptStatus: 'FAILED' }), NOW);
    expect([a.succeed, a.fail, a.note].map((v) => v.allowed)).toEqual([false, false, false]);
    expect(a.open).toBe(false);
    expect(a.fail).toMatchObject({ reason: expect.stringContaining('resolved') });
  });

  it('treats a Review without an opened time as locked', () => {
    expect(reviewActions(facts({ reviewOpenedAt: undefined }), NOW).locked).toBe(true);
  });
});
