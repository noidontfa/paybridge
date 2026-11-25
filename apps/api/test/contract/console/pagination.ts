// COPIED BY HAND from apps/console/src/lib/api/pagination.ts (client functions left out). Keep in sync: ADR 0004, ADR 0005.
// Tickets 03-07: do not edit this copy; add your own file next to it.
/**
 * The cursor-paginated list envelope every list endpoint returns:
 * `{ items, nextCursor }`, with `nextCursor` null on the last page. Later list
 * tickets wrap their item schema with `listPageSchema`.
 */
import { z } from 'zod';

export function listPageSchema<S extends z.ZodType>(item: S) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Query params every list endpoint takes besides its own filters. */
export interface ListQuery {
  cursor?: string;
  limit?: number;
}
