import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import { decodeCursor } from './keyset-cursor.js';

// Query-string building blocks shared by every operator list endpoint
// (ADR 0005). Validate with `new ZodValidationPipe(schema)` on `@Query()`.

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

export interface KeysetTail {
  readonly value: string;
  readonly id: string;
}

/**
 * Decodes a cursor made by `encodeCursor([tag, value, id])`. `tag` names the
 * ordering the request asks for, so a cursor cannot be replayed under another
 * sort. Returns `undefined` for no cursor and `null` for an invalid one.
 */
export function readKeysetCursor(
  cursor: string | undefined,
  tag: string,
  isValue: (value: string) => boolean,
): KeysetTail | undefined | null {
  if (cursor === undefined) return undefined;
  const parts = decodeCursor(cursor);
  if (parts?.length !== 3) return null;
  const [cursorTag, value, id] = parts;
  return cursorTag === tag && isValue(value) && isUuid(id)
    ? { value, id }
    : null;
}

export const isIsoTime = (value: string) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

/**
 * `readKeysetCursor` for use inside a schema `.transform`: an invalid cursor
 * adds the `cursor` issue to `ctx` and returns `null` (the caller then returns
 * `z.NEVER`).
 */
export function parseKeysetCursor(
  ctx: z.RefinementCtx,
  cursor: string | undefined,
  tag: string,
  isValue: (value: string) => boolean,
  message = 'is not valid for this list',
): KeysetTail | undefined | null {
  const after = readKeysetCursor(cursor, tag, isValue);
  if (after === null) {
    ctx.addIssue({ code: 'custom', path: ['cursor'], message });
  }
  return after;
}
