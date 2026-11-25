/**
 * The opaque keyset cursor every operator list endpoint returns and accepts.
 * It is base64url of a JSON array of strings: a tag naming the ordering the
 * cursor belongs to (for example the sort column and direction), then the
 * sort-key values of the last row of the page (the id last, as tiebreaker).
 * Clients must treat it as opaque.
 *
 * Shared by every operator list (ADR 0005). Each endpoint decides what its
 * values mean and validates them; this helper only does the encoding.
 */
export function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** The parts of a cursor, or `null` when it is not one this helper produced. */
export function decodeCursor(cursor: string): string[] | null {
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

/** A page of a keyset-paginated list. */
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only says there
 * is more, and the cursor is built from the last row that is returned.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (last: T) => string,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  };
}
