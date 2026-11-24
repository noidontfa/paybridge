import type { ProviderMetadata } from '../port/index.js';
import type { RefundStatus } from './statuses.js';

/** Fields only in Phase 1: there is no write path and no repository. */
export interface Refund {
  /** The refund key. */
  readonly id: string;
  readonly attemptId: string;
  readonly amount: string;
  readonly status: RefundStatus;
  readonly providerRef: string | null;
  readonly providerMetadata: ProviderMetadata | null;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
