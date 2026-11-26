import { z } from 'zod';

/** Header name the merchant sends on `POST /payments`. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Response header set when the body is a stored response being replayed. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/**
 * The `Idempotency-Key` header: optional (no key → ordinary create); when
 * present, 1 to 255 characters (the column is VARCHAR(255)).
 */
export const idempotencyKeySchema = z
  .string()
  .min(1, `${IDEMPOTENCY_KEY_HEADER} must not be empty`)
  .max(255, `${IDEMPOTENCY_KEY_HEADER} must be at most 255 characters`)
  .optional();
