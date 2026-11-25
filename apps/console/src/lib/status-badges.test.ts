import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATUSES, PAYMENT_STATUSES, REVIEW_REASONS } from '@/lib/api/schemas';
import { CALLBACK_STATUSES } from '@/lib/api/callbacks';
import { statusBadge } from './status-badges';

describe('statusBadge', () => {
  it('gives every Payment status, PaymentTransaction status and review reason a label, tone and icon', () => {
    for (const status of PAYMENT_STATUSES) expect(statusBadge('payment', status).icon).toBeDefined();
    for (const status of ATTEMPT_STATUSES) expect(statusBadge('transaction', status).icon).toBeDefined();
    for (const reason of REVIEW_REASONS) expect(statusBadge('review', reason).label.length).toBeGreaterThan(0);
  });

  it('labels in plain words', () => {
    expect(statusBadge('payment', 'SUCCEEDED').label).toBe('Succeeded');
    expect(statusBadge('transaction', 'REQUIRES_REVIEW').label).toBe('In review');
    expect(statusBadge('review', 'LATE_SUCCESS_ON_CLOSED_PAYMENT').label).toBe('Late success');
  });

  it('uses the same tone for the same meaning across kinds', () => {
    expect(statusBadge('payment', 'SUCCEEDED').tone).toBe('success');
    expect(statusBadge('transaction', 'SUCCEEDED').tone).toBe('success');
    expect(statusBadge('payment', 'PENDING').tone).toBe(statusBadge('transaction', 'PENDING').tone);
    expect(statusBadge('transaction', 'FAILED').tone).toBe('danger');
    expect(statusBadge('transaction', 'REQUIRES_REVIEW').tone).toBe('warning');
    expect(statusBadge('review', 'AMOUNT_MISMATCH').tone).toBe('warning');
  });

  it('maps every Callback status, with failed in the danger tone', () => {
    expect(CALLBACK_STATUSES.map((s) => statusBadge('callback', s).label)).toEqual(['Received', 'Processing', 'Processed', 'Failed']);
    expect(statusBadge('callback', 'PROCESSED').tone).toBe('success');
    expect(statusBadge('callback', 'FAILED').tone).toBe('danger');
  });

  it('falls back to a neutral badge for a value the Console does not know', () => {
    const badge = statusBadge('payment', 'REFUNDED');
    expect(badge).toMatchObject({ label: 'Refunded', tone: 'neutral' });
  });
});
