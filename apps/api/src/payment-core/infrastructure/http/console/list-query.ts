import { z } from 'zod';

// Query-string building blocks shared by every operator list endpoint
// (ADR 0005). Validate with `new ZodValidationPipe(schema)` on `@Query()`.
// Each list's cursor is defined with `keysetCursor`, next to the use case
// that pages the list (application/use-cases/console/).

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** An empty value (`?status=`) means "no filter", as the Console sends it. */
export function optionalParam<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}

/** `limit` and `cursor`, the two params every list takes besides its own. */
export const pagingShape = {
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: optionalParam(z.string()),
};

/** `YYYY-MM-DD` that is a real calendar day. */
export const dayParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD')
  .refine(
    (day) =>
      !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) &&
      new Date(`${day}T00:00:00.000Z`).toISOString().startsWith(day),
    'must be a real date',
  );
