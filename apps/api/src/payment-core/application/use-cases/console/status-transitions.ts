import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import {
  StatusTransitionsReadRepository,
  type StatusTransitionListQuery,
  type StatusTransitionRow,
} from '../../../domain/repositories/console-read/status-transitions-read.repository.js';
import { isIsoTime, keysetCursor, type Page } from './keyset-cursor.js';

/** The audit log cursor: newest first by `createdAt`. */
export const statusTransitionsCursor = keysetCursor<StatusTransitionRow>({
  tag: 'status-transitions',
  valueOf: (row) => row.createdAt.toISOString(),
  isValue: isIsoTime,
});

/** The operator audit log (`GET /internal/status-transitions`). Read only (ADR 0005). */
@Injectable()
export class ListStatusTransitions {
  constructor(
    @Inject(StatusTransitionsReadRepository)
    private readonly transitions: StatusTransitionsReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    query: StatusTransitionListQuery,
  ): Promise<Page<StatusTransitionRow>> {
    const rows = await this.transitions.list(scope, query);
    return statusTransitionsCursor.page(rows, query.limit);
  }
}
