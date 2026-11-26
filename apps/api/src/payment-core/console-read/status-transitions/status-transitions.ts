import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../domain/organization-scope.js';
import {
  StatusTransitionsReadRepository,
  type StatusTransitionListQuery,
  type StatusTransitionRow,
} from '../../infrastructure/prisma/console-read/status-transitions-read.repository.js';
import { encodeCursor, toPage, type Page } from '../shared/keyset-cursor.js';

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
    return toPage(rows, query.limit, (last) =>
      encodeCursor([
        'status-transitions',
        last.createdAt.toISOString(),
        last.id,
      ]),
    );
  }
}
