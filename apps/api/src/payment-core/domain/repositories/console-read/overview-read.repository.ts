import type { ReadScope } from '../../value-objects/organization-scope.js';
import type { PaymentStatus } from '../../statuses.js';

export interface OverviewWindow {
  readonly from: Date;
  readonly to: Date;
  /** Bucket width in milliseconds; `bucketCount` buckets cover the window. */
  readonly bucketMs: number;
  readonly bucketCount: number;
}

export interface OverviewData {
  readonly currency: string;
  /** Sum of succeeded Amounts, decimal string. */
  readonly volume: string;
  readonly paymentCount: number;
  readonly succeeded: number;
  readonly closed: number;
  readonly openReviewCount: number;
  /** One decimal string per bucket, oldest first. */
  readonly volumeSeries: readonly string[];
  readonly statusCounts: ReadonlyArray<{
    status: PaymentStatus;
    count: number;
  }>;
  readonly gateways: ReadonlyArray<{
    gatewayId: string;
    count: number;
    volume: string;
    succeeded: number;
    closed: number;
  }>;
  readonly recent: ReadonlyArray<{
    id: string;
    upstreamReference: string;
    amount: string;
    status: PaymentStatus;
    gatewayId: string | null;
    createdAt: Date;
  }>;
}

/** Read model behind the operator Overview (ADR 0005). Read only. */
export abstract class OverviewReadRepository {
  abstract overview(
    scope: ReadScope,
    window: OverviewWindow,
  ): Promise<OverviewData>;
}
