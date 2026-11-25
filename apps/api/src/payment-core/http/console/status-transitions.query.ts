import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import { STATUS_TRANSITION_ENTITY_TYPES } from './developer-views.vocab.js';
import { optionalParam, pagingShape, readKeysetCursor } from './list-query.js';

const isIsoTime = (value: string) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

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
    const after = readKeysetCursor(
      query.cursor,
      'status-transitions',
      isIsoTime,
    );
    if (after === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'is not valid for this list',
      });
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
