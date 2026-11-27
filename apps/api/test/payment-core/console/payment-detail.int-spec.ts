import { runSeed } from '../../../seed/seed.js';
import { paymentListSchema } from '../../contract/console/payments-list.js';
import {
  apiErrorBodySchema,
  operatorPaymentSchema,
} from '../../contract/console/schemas.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';

// Ticket 03: GET /internal/payments/:id over HTTP on real PostgreSQL, on the
// seeded data. Every success response is parsed with the Console's copied
// schema (getValid).

const prisma = createTestPrismaClient();
let api: ConsoleApp;

beforeAll(async () => {
  api = await createConsoleApp();
});
afterAll(async () => {
  await api.app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed({
    databaseUrl: testDatabaseUrl(),
    nodeEnv: 'test',
    now: new Date(),
  });
});

const detail = (id: string) =>
  api.getValid(`/internal/payments/${id}`, operatorPaymentSchema);

async function allDetails() {
  const list = await api.getValid(
    '/internal/payments?limit=100',
    paymentListSchema,
  );
  return Promise.all(list.items.map((p) => detail(p.id)));
}

describe('GET /internal/payments/:id', () => {
  it('returns every seeded Payment in the Console contract', async () => {
    const payments = await allDetails();
    expect(payments).toHaveLength(22 + 3); // API and checkout Payments
  });

  it('shows both attempts of the gateway-switch Payment, oldest first', async () => {
    const payments = await allDetails();
    const switched = payments.find((p) =>
      p.attempts.some((a) =>
        a.transitions.some((t) => t.trigger === 'gateway_switch'),
      ),
    )!;
    expect(switched.status).toBe('SUCCEEDED');
    expect(switched.attempts.map((a) => [a.gatewayId, a.status])).toEqual([
      ['stripe', 'CANCELLED'],
      ['fake', 'SUCCEEDED'],
    ]);
    const cancel = switched.attempts[0].transitions.at(-1)!;
    expect(cancel).toMatchObject({
      entityType: 'PAYMENT_TRANSACTION',
      entityId: switched.attempts[0].id,
      fromStatus: 'PENDING',
      toStatus: 'CANCELLED',
      trigger: 'gateway_switch',
      actor: 'customer',
      reason: 'customer chose another gateway',
    });
    const times = switched.attempts[0].transitions.map((t) => t.createdAt);
    expect([...times].sort()).toEqual(times);
  });

  it('carries Provider Reference and NextAction of each attempt', async () => {
    const payments = await allDetails();
    const attempts = payments.flatMap((p) => p.attempts);
    expect(
      new Set(
        attempts.flatMap((a) => (a.nextAction ? [a.nextAction.type] : [])),
      ),
    ).toEqual(new Set(['REDIRECT', 'QR_CODE', 'CLIENT_SDK', 'VOUCHER']));
    expect(attempts.some((a) => a.providerRef !== null)).toBe(true);
  });

  it('carries Review fields, with the provider-reported amount on AMOUNT_MISMATCH', async () => {
    const attempts = (await allDetails()).flatMap((p) => p.attempts);
    const mismatch = attempts.find(
      (a) => a.reviewReason === 'AMOUNT_MISMATCH',
    )!;
    expect(mismatch.providerReportedAmount).toBe('1250000');
    expect(mismatch.reviewOpenedAt).toBeDefined();
    expect(
      new Set(
        attempts.flatMap((a) => (a.reviewReason ? [a.reviewReason] : [])),
      ),
    ).toEqual(
      new Set([
        'AMBIGUOUS_PROVIDER_STATUS',
        'AMOUNT_MISMATCH',
        'LATE_SUCCESS_ON_CLOSED_PAYMENT',
        'DUPLICATE_SUCCESS',
      ]),
    );
    expect(attempts.some((a) => a.refundRequired)).toBe(true);
    const others = attempts.filter((a) => a.reviewReason !== 'AMOUNT_MISMATCH');
    expect(others.every((a) => a.providerReportedAmount === undefined)).toBe(
      true,
    );
  });

  it('lists the Payment Events of the Payment', async () => {
    const payments = await allDetails();
    const withEvents = payments.filter((p) => p.events.length > 0);
    expect(withEvents.length).toBeGreaterThan(0);
    for (const p of withEvents) {
      for (const e of p.events) expect(e.paymentId).toBe(p.id);
      const times = p.events.map((e) => e.createdAt);
      expect([...times].sort()).toEqual(times);
    }
    expect(
      withEvents.some((p) => p.events.some((e) => e.publishedAt === null)),
    ).toBe(true);
  });

  it('lists a Payment with no attempt', async () => {
    const payments = await allDetails();
    expect(payments.some((p) => p.attempts.length === 0)).toBe(true);
  });

  it.each([
    ['an unknown id', '00000000-0000-4000-8000-000000000000'],
    ['a non-UUID id', 'not-a-uuid'],
  ])('returns 404 with the standard error for %s', async (_name, id) => {
    const res = await api.get(`/internal/payments/${id}`);
    expect(res.status).toBe(404);
    expect(apiErrorBodySchema.parse(res.body).statusCode).toBe(404);
  });
});
