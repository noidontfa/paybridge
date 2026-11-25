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
