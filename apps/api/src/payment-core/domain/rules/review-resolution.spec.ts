import { describe, expect, it } from 'vitest';
import type { Payment } from '../entities/payment.js';
import type { PaymentTransaction } from '../entities/payment-transaction.js';
import type { ReviewReason } from '../statuses.js';
import { decideReviewResolution } from './review-resolution.js';

const HOUR = 60 * 60 * 1000;
const OPENED = new Date('2026-05-01T10:00:00.000Z');
const AFTER_72H = new Date(OPENED.getTime() + 72 * HOUR);

function attempt(
  reason: ReviewReason,
  overrides: Partial<PaymentTransaction> = {},
): PaymentTransaction {
  return {
    id: 'a1',
    organizationId: 'org-1',
    paymentId: 'p1',
    gatewayId: 'fake',
    status: 'REQUIRES_REVIEW',
    providerRef: null,
    providerMetadata: null,
    nextAction: null,
    reviewReason: reason,
    reviewOpenedAt: OPENED,
    refundRequired: true,
    createdAt: OPENED,
    updatedAt: OPENED,
    ...overrides,
  };
}

function payment(status: Payment['status'] = 'PENDING'): Payment {
  return {
    id: 'p1',
    organizationId: 'org-1',
    merchantOrderId: 'o1',
    checkoutOrigin: null,
    amount: '150000',
    currency: 'VND',
    status,
    expiresAt: OPENED,
    createdAt: OPENED,
    updatedAt: OPENED,
    attempts: [],
  };
}

const decide = (
  reason: ReviewReason,
  extra: Partial<Parameters<typeof decideReviewResolution>[0]> = {},
) =>
  decideReviewResolution({
    payment: payment(),
    attempt: attempt(reason),
    now: AFTER_72H,
    ...extra,
  });

describe('decideReviewResolution', () => {
  it('rejects an attempt that is not in review', () => {
    expect(() =>
      decide('AMBIGUOUS_PROVIDER_STATUS', {
        attempt: attempt('AMBIGUOUS_PROVIDER_STATUS', { status: 'PENDING' }),
        status: 'FAILED',
      }),
    ).toThrow(/not REQUIRES_REVIEW/);
  });

  it('rejects a status before 72 hours, allows it at exactly 72 hours', () => {
    expect(() =>
      decide('AMBIGUOUS_PROVIDER_STATUS', {
        status: 'FAILED',
        now: new Date(AFTER_72H.getTime() - 1),
      }),
    ).toThrow(/can be resolved by an operator from/);
    expect(decide('AMBIGUOUS_PROVIDER_STATUS', { status: 'FAILED' })).toEqual({
      kind: 'fail',
    });
  });

  it('allows FAILED for every resolvable reason', () => {
    for (const reason of [
      'AMBIGUOUS_PROVIDER_STATUS',
      'AMOUNT_MISMATCH',
    ] as const) {
      expect(decide(reason, { status: 'FAILED' }).kind).toBe('fail');
    }
  });

  it('allows SUCCEEDED only for an equal amount on a PENDING Payment', () => {
    const base = { status: 'SUCCEEDED' as const };
    expect(
      decide('AMBIGUOUS_PROVIDER_STATUS', { ...base, amount: '150000.00' }),
    ).toEqual({ kind: 'succeed' });
    expect(() =>
      decide('AMBIGUOUS_PROVIDER_STATUS', { ...base, amount: '149999' }),
    ).toThrow(/differs/);
    expect(() => decide('AMBIGUOUS_PROVIDER_STATUS', base)).toThrow(/amount/);
    expect(() =>
      decide('AMBIGUOUS_PROVIDER_STATUS', {
        ...base,
        amount: '150000',
        payment: payment('EXPIRED'),
      }),
    ).toThrow(/needs a PENDING Payment/);
  });

  it('only allows FAILED for AMOUNT_MISMATCH', () => {
    expect(() =>
      decide('AMOUNT_MISMATCH', { status: 'SUCCEEDED', amount: '150000' }),
    ).toThrow(/only be set to FAILED/);
  });

  it('allows only notes for late and duplicate success, at any time', () => {
    for (const reason of [
      'LATE_SUCCESS_ON_CLOSED_PAYMENT',
      'DUPLICATE_SUCCESS',
    ] as const) {
      expect(decide(reason, { now: OPENED })).toEqual({ kind: 'note' });
      expect(() => decide(reason, { status: 'FAILED' })).toThrow(/notes only/);
    }
  });

  it('needs a status for the other reasons', () => {
    expect(() => decide('AMBIGUOUS_PROVIDER_STATUS')).toThrow(/needs a status/);
  });
});
