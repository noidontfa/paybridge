import type { ReadScope } from '../organization-scope.js';

export const CALLBACK_STATUSES = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export interface GatewayCallbackHealth {
  /** Callbacks received since the cutoff, by status (every status present). */
  readonly counts: Record<CallbackStatus, number>;
  /** Latest `receivedAt` among Callbacks since the cutoff, or null when none. */
  readonly lastCallbackAt: Date | null;
}

/** Read side of the operator Gateways endpoints (ADR 0005). */
export abstract class GatewaysReadRepository {
  /** Gateway ids that appear on any PaymentTransaction or stored Callback. */
  abstract gatewayIdsWithData(scope: ReadScope): Promise<string[]>;

  /** Gateway Connection ids in scope, by gateway id. */
  abstract connectionIds(scope: ReadScope): Promise<Map<string, string[]>>;

  abstract callbackHealth(
    scope: ReadScope,
    gatewayId: string,
    since: Date,
  ): Promise<GatewayCallbackHealth>;
}
