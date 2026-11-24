import { InvalidExpiryError } from './errors.js';

const MINUTE_MS = 60_000;

/** Payment Expiry bounds, relative to creation (spec: Payment states and rules). */
export const MIN_PAYMENT_EXPIRY_MS = 30 * MINUTE_MS;
export const MAX_PAYMENT_EXPIRY_MS = 24 * 60 * MINUTE_MS;
export const DEFAULT_PAYMENT_EXPIRY_MS = MIN_PAYMENT_EXPIRY_MS;

/**
 * The Payment Expiry for a Payment created at `now`: the requested time, or
 * 30 minutes after `now` when none is requested. The requested time must lie
 * between 30 minutes and 24 hours after `now`, both inclusive.
 */
export function resolvePaymentExpiry(
  requested: Date | undefined,
  now: Date,
): Date {
  if (requested === undefined) {
    return new Date(now.getTime() + DEFAULT_PAYMENT_EXPIRY_MS);
  }
  const offset = requested.getTime() - now.getTime();
  if (
    Number.isNaN(offset) ||
    offset < MIN_PAYMENT_EXPIRY_MS ||
    offset > MAX_PAYMENT_EXPIRY_MS
  ) {
    throw new InvalidExpiryError(
      'expiresAt must be between 30 minutes and 24 hours after creation',
    );
  }
  return new Date(requested);
}
