/**
 * The mocked Overview endpoint: computed from the fixture store relative to its
 * fixed "now". See `@/lib/api/overview-schema` for the definitions.
 */
import type { Overview } from '@/lib/api/overview-schema';
import { PAYMENT_STATUSES, type PaymentStatus } from '@/lib/api/schemas';
import type { OverviewRange } from '@/lib/overview-range';
import type { MockPayment, MockStore } from './store';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RECENT_COUNT = 8;
const SCALE = 6;

const RANGES: Record<OverviewRange, { span: number; bucket: number }> = {
  '24h': { span: DAY, bucket: HOUR },
  '7d': { span: 7 * DAY, bucket: DAY },
  '30d': { span: 30 * DAY, bucket: DAY },
};

// Money is summed as scaled integers, never as floats.
function toScaled(amount: string): bigint {
  const [integer = '0', fraction = ''] = amount.split('.');
  return BigInt(integer + fraction.padEnd(SCALE, '0').slice(0, SCALE));
}

function fromScaled(value: bigint): string {
  const digits = value.toString().padStart(SCALE + 1, '0');
  const integer = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
}

function successRate(payments: MockPayment[]): number | null {
  const succeeded = payments.filter((p) => p.status === 'SUCCEEDED').length;
  const closed = payments.filter((p) => p.status !== 'PENDING').length;
  return closed === 0 ? null : succeeded / closed;
}

function volumeOf(payments: MockPayment[]): bigint {
  return payments.filter((p) => p.status === 'SUCCEEDED').reduce((sum, p) => sum + toScaled(p.amount), 0n);
}

export function computeOverview(store: MockStore, range: OverviewRange): Overview {
  const { span, bucket } = RANGES[range];
  const to = store.now.getTime();
  const from = to - span;
  const inRange = store.payments.filter((p) => {
    const created = new Date(p.createdAt).getTime();
    return created >= from && created <= to;
  });

  const buckets = Array.from({ length: span / bucket }, () => [] as MockPayment[]);
  for (const payment of inRange) {
    const index = Math.min(buckets.length - 1, Math.floor((new Date(payment.createdAt).getTime() - from) / bucket));
    buckets[index]!.push(payment);
  }

  const gatewayOf = (payment: MockPayment): string | null => store.attemptsOf(payment.id).at(-1)?.gatewayId ?? null;
  const byGateway = new Map<string, MockPayment[]>();
  for (const payment of inRange) {
    const gatewayId = gatewayOf(payment);
    if (gatewayId) byGateway.set(gatewayId, [...(byGateway.get(gatewayId) ?? []), payment]);
  }

  const countOf = (status: PaymentStatus) => inRange.filter((p) => p.status === status).length;

  return {
    range,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    currency: 'VND',
    volume: fromScaled(volumeOf(inRange)),
    paymentCount: inRange.length,
    successRate: successRate(inRange),
    openReviewCount: store.attempts.filter((a) => a.status === 'REQUIRES_REVIEW').length,
    volumeSeries: buckets.map((payments, index) => ({
      start: new Date(from + index * bucket).toISOString(),
      volume: fromScaled(volumeOf(payments)),
    })),
    statusCounts: PAYMENT_STATUSES.map((status) => ({ status, count: countOf(status) })),
    gateways: [...byGateway.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([gatewayId, payments]) => ({
        gatewayId,
        count: payments.length,
        volume: fromScaled(volumeOf(payments)),
        successRate: successRate(payments),
      })),
    recentPayments: [...inRange]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, RECENT_COUNT)
      .map((p) => ({
        id: p.id,
        upstreamReference: p.upstreamReference,
        amount: p.amount,
        status: p.status,
        gatewayId: gatewayOf(p),
        createdAt: p.createdAt,
      })),
  };
}
