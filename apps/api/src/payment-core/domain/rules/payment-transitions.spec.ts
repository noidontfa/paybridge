import {
  INITIAL_PAYMENT_STATUS,
  canTransitionPayment,
} from './payment-transitions.js';

describe('Payment transitions', () => {
  it('starts every Payment as PENDING', () => {
    expect(INITIAL_PAYMENT_STATUS).toBe('PENDING');
  });

  it.each(['SUCCEEDED', 'CANCELLED', 'EXPIRED'] as const)(
    'allows PENDING -> %s',
    (to) => {
      expect(canTransitionPayment('PENDING', to)).toBe(true);
    },
  );

  it.each(['SUCCEEDED', 'CANCELLED', 'EXPIRED'] as const)(
    'never leaves the terminal state %s',
    (from) => {
      for (const to of [
        'PENDING',
        'SUCCEEDED',
        'CANCELLED',
        'EXPIRED',
      ] as const) {
        expect(canTransitionPayment(from, to)).toBe(false);
      }
    },
  );
});
