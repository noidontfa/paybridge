import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import type { StatusTransitionRow } from '../../infrastructure/prisma/console-read/status-transitions-read.repository.js';
import { STATUS_TRANSITION_ENTITY_TYPES } from '../../domain/records.js';
import { isIsoTime, keysetCursor } from '../shared/keyset-cursor.js';
import { optionalParam, pagingShape } from '../shared/list-query.js';

/** Newest first by `createdAt`. */
export const statusTransitionsCursor = keysetCursor<StatusTransitionRow>({
  tag: 'status-transitions',
  valueOf: (row) => row.createdAt.toISOString(),
  isValue: isIsoTime,
});

export const statusTransitionsListQuerySchema = z
  .object({
    ...pagingShape,
    entityType: optionalParam(z.enum(STATUS_TRANSITION_ENTITY_TYPES)),
    entityId: optionalParam(
      z.string().refine(isUuid, 'must be a UUID').transform((v) => v.toLowerCase()),
    ),
    trigger: optionalParam(z.string().max(100)),
    actor: optionalParam(z.string().max(200)),
    q: optionalParam(z.string().trim().max(200)),
  })
  .transform((query, ctx) => {
    const after = statusTransitionsCursor.parse(ctx, query.cursor);
    if (after === null) {
      return z.NEVER;
    }
    return {
      limit: query.limit,
      after,
      filters: {
        entityType: query.entityType,
        entityId: query.entityId,
        trigger: query.trigger,
        actor: query.actor,
        q: query.q || undefined,
      },
    };
  });

export type StatusTransitionsListQuery = z.output<
  typeof statusTransitionsListQuerySchema
>;
