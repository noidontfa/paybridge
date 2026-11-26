import { PAYMENT_STATUSES, type PaymentStatus } from '../statuses.js';

// The Payment state table (spec: Payment states and rules). PENDING is the
// only non-terminal state; a Payment never leaves SUCCEEDED, CANCELLED or
// EXPIRED. Guards that depend on attempts, amounts or the deadline belong to
// the use cases that make each transition.

/** Every Payment is created in this state. */
export const INITIAL_PAYMENT_STATUS: PaymentStatus = 'PENDING';

const ALLOWED: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ['SUCCEEDED', 'CANCELLED', 'EXPIRED'],
  SUCCEEDED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/** The final states: a Payment in one of them is closed and never changes again. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] =
  PAYMENT_STATUSES.filter((status) => ALLOWED[status].length === 0);
