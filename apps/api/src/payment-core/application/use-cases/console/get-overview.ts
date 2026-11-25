import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../domain/clock.js';
import {
  OverviewReadRepository,
  type OverviewData,
} from '../../../infrastructure/prisma/console-read/overview-read.repository.js';

export const OVERVIEW_RANGES = ['24h', '7d', '30d'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Rolling windows counted back from `to`: no calendar days, no time zone. */
const WINDOWS: Record<OverviewRange, { span: number; bucket: number }> = {
  '24h': { span: DAY, bucket: HOUR },
  '7d': { span: 7 * DAY, bucket: DAY },
  '30d': { span: 30 * DAY, bucket: DAY },
};

export interface OverviewView {
  readonly range: OverviewRange;
  readonly from: Date;
  readonly to: Date;
  readonly bucketStarts: readonly Date[];
  readonly data: OverviewData;
  readonly successRate: number | null;
}

/** Succeeded over closed Payments, or null when none is closed. */
export function successRate(succeeded: number, closed: number): number | null {
  return closed === 0 ? null : succeeded / closed;
}

/**
 * The operator Overview (`GET /internal/overview`). Read only: no
 * transaction, no writes (ADR 0005).
 */
@Injectable()
export class GetOverview {
  constructor(
    @Inject(OverviewReadRepository)
    private readonly overview: OverviewReadRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async execute(range: OverviewRange): Promise<OverviewView> {
    const { span, bucket } = WINDOWS[range];
    const to = this.clock.now();
    const from = new Date(to.getTime() - span);
    const bucketCount = span / bucket;
    const data = await this.overview.overview({
      from,
      to,
      bucketMs: bucket,
      bucketCount,
    });
    return {
      range,
      from,
      to,
      bucketStarts: Array.from(
        { length: bucketCount },
        (_, i) => new Date(from.getTime() + i * bucket),
      ),
      data,
      successRate: successRate(data.succeeded, data.closed),
    };
  }
}
