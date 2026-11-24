import {
  INITIAL_ATTEMPT_STATUS,
  canTransitionAttempt,
  isOpenAttempt,
} from './attempt-transitions.js';

// The attempt state table from the spec (Payment states and rules). Guards
// that depend on the Payment, amounts or the provider belong to use cases.

describe('Attempt transitions', () => {
  it('stores every new attempt as CREATED', () => {
    expect(INITIAL_ATTEMPT_STATUS).toBe('CREATED');
  });

  it.each([
    ['CREATED', 'PENDING'],
    ['CREATED', 'FAILED'],
    ['CREATED', 'SUCCEEDED'],
    ['CREATED', 'REQUIRES_REVIEW'],
    ['CREATED', 'CANCELLED'],
    ['PENDING', 'SUCCEEDED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'REQUIRES_REVIEW'],
    ['PENDING', 'EXPIRED'],
    ['PENDING', 'CANCELLED'],
    ['FAILED', 'SUCCEEDED'],
    ['FAILED', 'REQUIRES_REVIEW'],
    ['EXPIRED', 'SUCCEEDED'],
    ['EXPIRED', 'REQUIRES_REVIEW'],
    ['CANCELLED', 'SUCCEEDED'],
    ['CANCELLED', 'REQUIRES_REVIEW'],
    ['REQUIRES_REVIEW', 'SUCCEEDED'],
    ['REQUIRES_REVIEW', 'FAILED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionAttempt(from, to)).toBe(true);
  });

  it.each([
    ['CREATED', 'EXPIRED'],
    ['PENDING', 'CREATED'],
    ['FAILED', 'PENDING'],
    ['CANCELLED', 'PENDING'],
    ['EXPIRED', 'FAILED'],
    ['REQUIRES_REVIEW', 'PENDING'],
    ['SUCCEEDED', 'FAILED'],
    ['SUCCEEDED', 'REQUIRES_REVIEW'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionAttempt(from, to)).toBe(false);
  });

  it('treats only CREATED and PENDING as open', () => {
    expect(isOpenAttempt('CREATED')).toBe(true);
    expect(isOpenAttempt('PENDING')).toBe(true);
    expect(isOpenAttempt('FAILED')).toBe(false);
    expect(isOpenAttempt('REQUIRES_REVIEW')).toBe(false);
  });
});
