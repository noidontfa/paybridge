import { runSeed } from '../../../seed/seed.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import { overviewSchema } from '../../contract/console/overview-schema.js';
import {
  ATTEMPT_STATUSES,
  PAYMENT_STATUSES,
} from '../../contract/console/schemas.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';
import { DEFAULT_ORGANIZATION_ID } from '../../setup/organizations.js';

// Ticket 05: GET /internal/overview over HTTP on real PostgreSQL. Every
// success response is parsed with the Console's copied schema (getValid).
// Data is created relative to the real clock, half an hour inside a bucket, so
// the few milliseconds a test takes never move a Payment across a boundary.

const prisma = createTestPrismaClient();
let api: ConsoleApp;

beforeAll(async () => {
  api = await createConsoleApp();
});
afterAll(async () => {
  await api.app.close();
  await prisma.$disconnect();
});
beforeEach(() => resetDatabase(prisma));

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface PaymentInput {
  status: (typeof PAYMENT_STATUSES)[number];
  amount?: string;
  /** How long before now the Payment was created. */
  ago: number;
  attempts?: {
    gatewayId: string;
    status?: (typeof ATTEMPT_STATUSES)[number];
  }[];
}

let seq = 0;
async function insertPayment(input: PaymentInput): Promise<string> {
  const id = newId();
  const createdAt = new Date(Date.now() - input.ago);
  await prisma.payment.create({
    data: {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      merchantOrderId: `OV-${++seq}`,
      amount: new Prisma.Decimal(input.amount ?? '1000'),
      currency: 'VND',
      status: input.status,
      expiresAt: new Date(createdAt.getTime() + HOUR),
      createdAt,
      updatedAt: createdAt,
    },
  });
  for (const [i, attempt] of (input.attempts ?? []).entries()) {
    await prisma.paymentTransaction.create({
      data: {
        id: newId(),
        organizationId: DEFAULT_ORGANIZATION_ID,
        paymentId: id,
        gatewayId: attempt.gatewayId,
        status: attempt.status ?? 'FAILED',
        createdAt: new Date(createdAt.getTime() + i),
        updatedAt: createdAt,
      },
    });
  }
  return id;
}

const overview = (range: string) =>
  api.getValid(`/internal/overview?range=${range}`, overviewSchema);

describe('seeded data', () => {
  it('returns data for every range', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    for (const range of ['24h', '7d', '30d'] as const) {
      const o = await overview(range);
      expect(o.range).toBe(range);
      expect(o.paymentCount, range).toBeGreaterThan(0);
      expect(o.recentPayments.length, range).toBeGreaterThan(0);
      expect(o.gateways.length, range).toBeGreaterThan(0);
      expect(o.openReviewCount, range).toBeGreaterThan(0);
    }
    const all = await overview('30d');
    expect(all.paymentCount).toBe(22);
    expect(new Set(all.statusCounts.map((s) => s.status))).toEqual(
      new Set(PAYMENT_STATUSES),
    );
    expect(all.statusCounts.reduce((n, s) => n + s.count, 0)).toBe(22);
  });
});

describe('buckets and window', () => {
  it('returns 24 hourly buckets for 24h and 24-hour buckets for 7d and 30d', async () => {
    const h = await overview('24h');
    expect(h.volumeSeries).toHaveLength(24);
    expect(Date.parse(h.to) - Date.parse(h.from)).toBe(DAY);
    const starts = h.volumeSeries.map((b) => Date.parse(b.start));
    expect(starts[0]).toBe(Date.parse(h.from));
    expect(starts.map((s, i) => (i ? s - starts[i - 1]! : HOUR))).toEqual(
      Array(24).fill(HOUR),
    );

    const d7 = await overview('7d');
    expect(d7.volumeSeries).toHaveLength(7);
    expect(Date.parse(d7.to) - Date.parse(d7.from)).toBe(7 * DAY);
    const d30 = await overview('30d');
    expect(d30.volumeSeries).toHaveLength(30);
    expect(Date.parse(d30.volumeSeries[1]!.start) - Date.parse(d30.from)).toBe(
      DAY,
    );
  });

  it('sums succeeded volume into the bucket counted back from the end', async () => {
    await insertPayment({
      status: 'SUCCEEDED',
      amount: '1500.5',
      ago: 30 * MIN,
    });
    await insertPayment({
      status: 'SUCCEEDED',
      amount: '500',
      ago: 40 * MIN,
    });
    await insertPayment({
      status: 'SUCCEEDED',
      amount: '250',
      ago: 5 * HOUR + 30 * MIN,
    });
    await insertPayment({ status: 'PENDING', amount: '9999', ago: 30 * MIN });

    const o = await overview('24h');
    expect(o.volume).toBe('2250.5');
    const volumes = o.volumeSeries.map((b) => b.volume);
    expect(volumes[23]).toBe('2000.5');
    expect(volumes[18]).toBe('250');
    expect(volumes.filter((v) => v !== '0')).toHaveLength(2);
  });

  it('leaves out Payments older than the range', async () => {
    await insertPayment({ status: 'SUCCEEDED', ago: 25 * HOUR });
    await insertPayment({ status: 'SUCCEEDED', ago: 2 * DAY });
    await insertPayment({ status: 'SUCCEEDED', ago: 8 * DAY });
    expect((await overview('24h')).paymentCount).toBe(0);
    expect((await overview('7d')).paymentCount).toBe(2);
    expect((await overview('30d')).paymentCount).toBe(3);
  });
});

describe('figures', () => {
  it('computes success rate over closed Payments', async () => {
    await insertPayment({ status: 'SUCCEEDED', ago: HOUR });
    await insertPayment({ status: 'SUCCEEDED', ago: HOUR });
    await insertPayment({ status: 'CANCELLED', ago: HOUR });
    await insertPayment({ status: 'EXPIRED', ago: HOUR });
    await insertPayment({ status: 'PENDING', ago: HOUR });
    const o = await overview('24h');
    expect(o.paymentCount).toBe(5);
    expect(o.successRate).toBe(0.5);
    expect(o.statusCounts).toEqual([
      { status: 'PENDING', count: 1 },
      { status: 'SUCCEEDED', count: 2 },
      { status: 'CANCELLED', count: 1 },
      { status: 'EXPIRED', count: 1 },
    ]);
  });

  it('returns zeros and a null success rate for a range with no Payments', async () => {
    const o = await overview('24h');
    expect(o).toMatchObject({
      paymentCount: 0,
      volume: '0',
      successRate: null,
      openReviewCount: 0,
      gateways: [],
      recentPayments: [],
    });
    expect(o.volumeSeries.every((b) => b.volume === '0')).toBe(true);
    expect(o.statusCounts.every((s) => s.count === 0)).toBe(true);
  });

  it('has a null success rate while only pending Payments exist', async () => {
    await insertPayment({ status: 'PENDING', ago: HOUR });
    expect((await overview('24h')).successRate).toBeNull();
  });

  it('counts attempts waiting for review as open Reviews', async () => {
    await insertPayment({
      status: 'PENDING',
      ago: HOUR,
      attempts: [{ gatewayId: 'stripe', status: 'REQUIRES_REVIEW' }],
    });
    await insertPayment({
      status: 'PENDING',
      ago: HOUR,
      attempts: [{ gatewayId: 'stripe', status: 'PENDING' }],
    });
    expect((await overview('24h')).openReviewCount).toBe(1);
  });

  it('lists the newest Payments first, at most eight', async () => {
    for (let i = 1; i <= 10; i++) {
      await insertPayment({ status: 'PENDING', ago: i * 10 * MIN });
    }
    const o = await overview('24h');
    expect(o.recentPayments).toHaveLength(8);
    const times = o.recentPayments.map((p) => Date.parse(p.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(o.recentPayments.every((p) => p.gatewayId === null)).toBe(true);
  });
});

describe('gateway attribution', () => {
  it('counts a Payment once, under the gateway of its latest attempt', async () => {
    await insertPayment({
      status: 'SUCCEEDED',
      amount: '1000',
      ago: HOUR,
      attempts: [
        { gatewayId: 'stripe', status: 'CANCELLED' },
        { gatewayId: 'fake', status: 'SUCCEEDED' },
      ],
    });
    await insertPayment({
      status: 'SUCCEEDED',
      amount: '300',
      ago: HOUR,
      attempts: [{ gatewayId: 'stripe', status: 'SUCCEEDED' }],
    });
    await insertPayment({
      status: 'CANCELLED',
      amount: '9',
      ago: HOUR,
      attempts: [{ gatewayId: 'stripe', status: 'CANCELLED' }],
    });
    await insertPayment({ status: 'PENDING', amount: '7', ago: HOUR });

    const o = await overview('24h');
    expect(o.gateways).toEqual([
      { gatewayId: 'fake', count: 1, volume: '1000', successRate: 1 },
      { gatewayId: 'stripe', count: 2, volume: '300', successRate: 0.5 },
    ]);
    expect(o.gateways.reduce((n, g) => n + g.count, 0)).toBe(3);
    const switched = o.recentPayments.find((p) => p.amount === '1000');
    expect(switched?.gatewayId).toBe('fake');
  });

  it('gives a gateway with only pending Payments a null success rate', async () => {
    await insertPayment({
      status: 'PENDING',
      ago: HOUR,
      attempts: [{ gatewayId: 'stripe', status: 'PENDING' }],
    });
    expect((await overview('24h')).gateways).toEqual([
      { gatewayId: 'stripe', count: 1, volume: '0', successRate: null },
    ]);
  });
});

describe('errors', () => {
  it.each(['', '?range=1y', '?range=', '?range=7D'])(
    'rejects an invalid range (%s)',
    async (query) => {
      await api.expectRejected(`/internal/overview${query}`);
    },
  );
});
