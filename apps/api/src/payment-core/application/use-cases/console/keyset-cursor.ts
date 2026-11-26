import { validate as isUuid } from 'uuid';
import type { z } from 'zod';

/**
 * The opaque keyset cursor every operator list returns and accepts (ADR 0005).
 * On the wire it is base64url of a JSON array `[tag, value, id]`: the tag
 * names the ordering the cursor belongs to (so it cannot be replayed under
 * another list or sort), then the sort-key value and the id of the last row
 * of the page (the id is the tiebreaker). Clients treat it as opaque.
 *
 * Each list defines its cursor once with `keysetCursor`, so the tag, the
 * sort key and the check of a decoded value sit in one place for both
 * directions.
 */
export interface KeysetCursor<Row> {
  /**
   * Reads `?cursor=` inside a Zod `.transform`. Returns `undefined` for no
   * cursor; for an invalid one it adds a `cursor` issue to `ctx` and returns
   * `null` (the caller then returns `z.NEVER`).
   */
  parse(ctx: z.RefinementCtx, cursor: string | undefined): KeysetTail | undefined | null;
  /** Turns `limit + 1` fetched rows into a page with the next cursor. */
  page(rows: readonly Row[], limit: number): Page<Row>;
}

/** The decoded cursor: sort-key value and id of the last row already shown. */
export interface KeysetTail {
  readonly value: string;
  readonly id: string;
}

/** A page of a keyset-paginated list. */
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export interface KeysetCursorSpec<Row> {
  /** Names the list and ordering, for example `'callbacks'` or `'amount:desc'`. */
  readonly tag: string;
  /** The sort-key value of a row, as the string stored in the cursor. */
  readonly valueOf: (row: Row) => string;
  /** Whether a decoded value is a valid sort-key value for this list. */
  readonly isValue: (value: string) => boolean;
  /** The message on the `cursor` issue when it does not belong here. */
  readonly invalidMessage?: string;
}

export function keysetCursor<Row extends { readonly id: string }>(
  spec: KeysetCursorSpec<Row>,
): KeysetCursor<Row> {
  return {
    parse(ctx, cursor) {
      if (cursor === undefined) return undefined;
      const parts = decode(cursor);
      if (parts?.length === 3) {
        const [tag, value, id] = parts as [string, string, string];
        if (tag === spec.tag && spec.isValue(value) && isUuid(id)) {
          return { value, id };
        }
      }
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: spec.invalidMessage ?? 'is not valid for this list',
      });
      return null;
    },
    page(rows, limit) {
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encode([spec.tag, spec.valueOf(last), last.id])
            : null,
      };
    },
  };
}

/** An ISO-8601 instant exactly as `Date#toISOString` writes it. */
export const isIsoTime = (value: string) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

function encode(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function decode(cursor: string): string[] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((part) => typeof part === 'string')
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}
