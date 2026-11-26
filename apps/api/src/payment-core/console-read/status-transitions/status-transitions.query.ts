import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import { STATUS_TRANSITION_ENTITY_TYPES } from '../shared/developer-views.vocab.js';
import {
  isIsoTime,
  optionalParam,
  pagingShape,
  parseKeysetCursor,
} from '../shared/list-query.js';

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
    const after = parseKeysetCursor(ctx, query.cursor, 'status-transitions', isIsoTime);
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
