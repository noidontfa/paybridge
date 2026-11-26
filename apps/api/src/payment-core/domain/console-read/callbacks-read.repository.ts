import type { ReadScope } from '../organization-scope.js';
import type { WebhookInboxStatus } from '../records.js';

export interface CallbackListFilters {
  readonly gatewayId?: string;
  readonly status?: WebhookInboxStatus;
  /** Callback id or Attempt Key (exact), Provider Event id, Payment id or Upstream Reference. */
  readonly q?: string;
}

export interface CallbackListQuery {
  readonly filters: CallbackListFilters;
  /** `receivedAt` and id of the last row of the previous page. */
  readonly after?: { readonly value: string; readonly id: string };
  readonly limit: number;
}

export interface CallbackListRow {
  readonly id: string;
  readonly gatewayId: string;
  readonly providerEventId: string | null;
  readonly attemptKey: string | null;
  readonly status: WebhookInboxStatus;
  readonly attempts: number;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface CallbackDetailRow extends CallbackListRow {
  readonly headers: Record<string, string>;
  readonly query: Record<string, string>;
  /** The body exactly as received, decoded as UTF-8 text. */
  readonly rawBody: string;
  readonly lastError: string | null;
  /** Payment of the PaymentTransaction the Attempt Key names, if one exists. */
  readonly paymentId: string | null;
}

/** Read model behind the operator Callbacks pages. Read only. */
export abstract class CallbacksReadRepository {
  /** Up to `limit + 1` rows, newest first, so the caller can tell whether another page exists. */
  abstract list(
    scope: ReadScope,
    query: CallbackListQuery,
  ): Promise<CallbackListRow[]>;

  abstract findById(
    scope: ReadScope,
    id: string,
  ): Promise<CallbackDetailRow | null>;
}
