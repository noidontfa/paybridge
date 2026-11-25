import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { ReadScope } from '../../../domain/organization-scope.js';
import {
  CallbacksReadRepository,
  type CallbackDetailRow,
  type CallbackListQuery,
  type CallbackListRow,
} from '../../../infrastructure/prisma/console-read/callbacks-read.repository.js';
import { encodeCursor, toPage, type Page } from './cursor.js';

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
    return toPage(rows, query.limit, (last) =>
      encodeCursor(['callbacks', last.receivedAt.toISOString(), last.id]),
    );
  }
}

/** One Callback (`GET /internal/callbacks/:id`); null when no Callback has that id. */
@Injectable()
export class GetCallback {
  constructor(
    @Inject(CallbacksReadRepository)
    private readonly callbacks: CallbacksReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    id: string,
  ): Promise<CallbackDetailRow | null> {
    return isUuid(id) ? this.callbacks.findById(scope, id.toLowerCase()) : null;
  }
}
