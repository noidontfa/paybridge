import { describe, expect, it } from 'vitest';
import { overviewSchema } from '@/lib/api/overview-schema';
import { computeOverview } from './overview';
import { createSeededStore } from './seed';
import { MockStore, type MockAttempt, type MockPayment } from './store';

const NOW = new Date('2026-11-25T03:00:00.000Z');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function pay(id: string, status: MockPayment['status'], amount: string, hoursAgo: number): MockPayment {
  return {
    id,
    upstreamReference: `order-${id}`,
    amount,
    currency: 'VND',
    status,
    expiresAt: ago(hoursAgo - 1),
    createdAt: ago(hoursAgo),
    updatedAt: ago(hoursAgo),
  };
}

function att(id: string, paymentId: string, gatewayId: string, status: MockAttempt['status'], hoursAgo: number): MockAttempt {
  return { id, paymentId, gatewayId, status, providerRef: null, refundRequired: false, createdAt: ago(hoursAgo), updatedAt: ago(hoursAgo) };
}

function fixture() {
  const store = new MockStore(NOW);
  store.payments.push(
    pay('a', 'SUCCEEDED', '100000', 2), // 24h, stripe
    pay('b', 'SUCCEEDED', '50000', 30), // 7d, fake
    pay('c', 'CANCELLED', '70000', 3), // 24h, stripe
    pay('d', 'PENDING', '20000', 1), // 24h, no attempt
    pay('e', 'EXPIRED', '10000', 24 * 10), // 30d only, fake
    pay('f', 'SUCCEEDED', '1', 24 * 40), // outside every range
  );
  store.attempts.push(
    att('a1', 'a', 'stripe', 'SUCCEEDED', 2),
    att('b0', 'b', 'stripe', 'FAILED', 31),
    att('b1', 'b', 'fake', 'SUCCEEDED', 30),
    att('c1', 'c', 'stripe', 'CANCELLED', 3),
    att('e1', 'e', 'fake', 'EXPIRED', 24 * 10),
    att('r1', 'c', 'stripe', 'REQUIRES_REVIEW', 2.5),
    att('r2', 'b', 'fake', 'REQUIRES_REVIEW', 5),
  );
  return store;
}

describe('computeOverview', () => {
  it('sums volume of succeeded Payments, counts Payments and computes success over closed', () => {
    const o = computeOverview(fixture(), '24h');
    expect(o.volume).toBe('100000');
    expect(o.paymentCount).toBe(3);
    expect(o.successRate).toBe(0.5); // 1 succeeded / (1 succeeded + 1 cancelled); pending is not closed
    expect(o.openReviewCount).toBe(2);
    expect(o.statusCounts).toEqual([
      { status: 'PENDING', count: 1 },
      { status: 'SUCCEEDED', count: 1 },
      { status: 'CANCELLED', count: 1 },
      { status: 'EXPIRED', count: 0 },
    ]);
  });

  it('widens with the range', () => {
    const week = computeOverview(fixture(), '7d');
    expect(week.volume).toBe('150000');
    expect(week.paymentCount).toBe(4);
    expect(week.successRate).toBeCloseTo(2 / 3);

    const month = computeOverview(fixture(), '30d');
    expect(month.paymentCount).toBe(5);
    expect(month.successRate).toBe(0.5);
  });

  it('breaks down per PaymentGateway of the latest PaymentTransaction', () => {
    const o = computeOverview(fixture(), '30d');
    expect(o.gateways).toEqual([
      { gatewayId: 'fake', count: 2, volume: '50000', successRate: 0.5 },
      { gatewayId: 'stripe', count: 2, volume: '100000', successRate: 0.5 },
    ]);
  });

  it('buckets volume hourly for 24h and daily for 7d and 30d, summing to the total', () => {
    const day = computeOverview(fixture(), '24h');
    expect(day.volumeSeries).toHaveLength(24);
    expect(day.volumeSeries.find((b) => b.volume !== '0')).toEqual({ start: ago(2), volume: '100000' });
    const week = computeOverview(fixture(), '7d');
    expect(week.volumeSeries).toHaveLength(7);
    expect(week.volumeSeries.at(-1)!.volume).toBe('100000');
    expect(computeOverview(fixture(), '30d').volumeSeries).toHaveLength(30);
  });

  it('lists the most recent Payments first', () => {
    const o = computeOverview(fixture(), '30d');
    expect(o.recentPayments.map((p) => p.id)).toEqual(['d', 'a', 'c', 'b', 'e']);
    expect(o.recentPayments[0]).toMatchObject({ gatewayId: null, status: 'PENDING', amount: '20000' });
  });

  it('has no success rate when nothing is closed, and no figures for an empty range', () => {
    const o = computeOverview(new MockStore(NOW), '24h');
    expect(o).toMatchObject({ volume: '0', paymentCount: 0, successRate: null, gateways: [], recentPayments: [] });
  });

  it('is valid for the copied schema over the seeded store', () => {
    const store = createSeededStore();
    for (const range of ['24h', '7d', '30d'] as const) {
      const parsed = overviewSchema.parse(computeOverview(store, range));
      expect(parsed.paymentCount).toBeGreaterThan(0);
    }
  });
});
