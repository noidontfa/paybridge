import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/organization-scope.js';
import {
  CallbacksReadRepository,
  type CallbackDetailRow,
  type CallbackListQuery,
  type CallbackListRow,
} from '../../../domain/console-read/callbacks-read.repository.js';
import { isIsoTime, keysetCursor, type Page } from './keyset-cursor.js';

/** The Callbacks list cursor: newest first by `receivedAt`. */
export const callbacksCursor = keysetCursor<CallbackListRow>({
  tag: 'callbacks',
  valueOf: (row) => row.receivedAt.toISOString(),
  isValue: isIsoTime,
});

/** The operator Callbacks list (`GET /internal/callbacks`). Read only (ADR 0005). */
@Injectable()
export class ListCallbacks {
  constructor(
    @Inject(CallbacksReadRepository)
    private readonly callbacks: CallbacksReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    query: CallbackListQuery,
  ): Promise<Page<CallbackListRow>> {
    const rows = await this.callbacks.list(scope, query);
    return callbacksCursor.page(rows, query.limit);
  }
}

/** One Callback (`GET /internal/callbacks/:id`); null when no Callback has that id. */
@Injectable()
export class GetCallback {
  constructor(
    @Inject(CallbacksReadRepository)
    private readonly callbacks: CallbacksReadRepository,
  ) {}

  execute(scope: ReadScope, id: string): Promise<CallbackDetailRow | null> {
    return this.callbacks.findById(scope, id);
  }
}
