import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { resetDatabase } from '../setup/reset-db.js';
import { REQUIRED_INDEXES } from '../../src/database/schema-guard.js';
import {
  DEFAULT_ORGANIZATION_ID,
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';

// Runs against the migrated test database (see test/setup/db.global-setup.ts).
// Proves the init migration enforces what the spec puts in the database.

const prisma = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

const id = () => randomUUID();
const inFuture = () => new Date(Date.now() + 30 * 60_000);

function createPayment(
  overrides: Partial<Prisma.PaymentUncheckedCreateInput> = {},
) {
  return prisma.payment.create({
    data: {
      id: id(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      merchantOrderId: `order-${id()}`,
      amount: new Prisma.Decimal(10_000),
      currency: 'VND',
      status: 'PENDING',
      expiresAt: inFuture(),
      ...overrides,
    },
  });
}

function createAttempt(
  paymentId: string,
  data: Partial<Prisma.PaymentTransactionUncheckedCreateInput> = {},
) {
  return prisma.paymentTransaction.create({
    data: {
      id: id(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      paymentId,
      gatewayId: 'fake',
      status: 'CREATED',
      ...data,
    },
  });
}

/** Postgres constraint/index name carried by a Prisma driver-adapter error. */
async function violatedConstraint(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  return JSON.stringify((error as Prisma.PrismaClientKnownRequestError).meta);
}

describe('init migration', () => {
  it('creates every required partial index with its predicate', async () => {
    const rows = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    for (const index of REQUIRED_INDEXES) {
      expect(byName.get(index.name), index.name).toContain(' WHERE ');
    }
  });

  it('rejects a payment amount of zero', async () => {
    await expect(
      violatedConstraint(createPayment({ amount: new Prisma.Decimal(0) })),
    ).resolves.toContain('core_payments_amount_positive');
  });

  it('rejects a refund amount of zero', async () => {
    const payment = await createPayment();
    const attempt = await createAttempt(payment.id, { status: 'SUCCEEDED' });
    const refund = prisma.$executeRaw`
      INSERT INTO core_refunds (id, organization_id, attempt_id, amount, status, updated_at)
      VALUES (${id()}::uuid, ${DEFAULT_ORGANIZATION_ID}::uuid, ${attempt.id}::uuid, 0, 'PENDING', now())`;
    await expect(violatedConstraint(refund)).resolves.toContain(
      'core_refunds_amount_positive',
    );
  });

  it('stores amounts with four decimal places', async () => {
    const payment = await createPayment({
      amount: new Prisma.Decimal('12.34567'),
    });
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(stored.amount.toString()).toBe('12.3457');
  });

  it('allows at most one open attempt per payment', async () => {
    const payment = await createPayment();
    await createAttempt(payment.id, { status: 'CREATED' });
    await expect(
      violatedConstraint(createAttempt(payment.id, { status: 'PENDING' })),
    ).resolves.toContain('core_payment_transactions_one_open_uq');
  });

  it('allows a new open attempt once the previous one is closed', async () => {
    const payment = await createPayment();
    await createAttempt(payment.id, { status: 'CANCELLED' });
    await createAttempt(payment.id, { status: 'FAILED' });
    await expect(
      createAttempt(payment.id, { status: 'PENDING' }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('allows at most one succeeded attempt per payment', async () => {
    const payment = await createPayment();
    await createAttempt(payment.id, { status: 'SUCCEEDED' });
    await expect(
      violatedConstraint(createAttempt(payment.id, { status: 'SUCCEEDED' })),
    ).resolves.toContain('core_payment_transactions_one_succeeded_uq');
  });

  it('keeps the upstream reference unique within an Organization', async () => {
    await createPayment({ merchantOrderId: 'order-1' });
    await expect(
      violatedConstraint(createPayment({ merchantOrderId: 'order-1' })),
    ).resolves.toContain('core_payments_org_merchant_order_id_uq');
  });

  it('lets two Organizations use the same upstream reference', async () => {
    await ensureOtherOrganization(prisma);
    await createPayment({ merchantOrderId: 'order-1' });
    await expect(
      createPayment({
        merchantOrderId: 'order-1',
        organizationId: OTHER_ORGANIZATION_ID,
      }),
    ).resolves.toMatchObject({ merchantOrderId: 'order-1' });
  });

  it('refuses a Payment with no Organization', async () => {
    await expect(
      violatedConstraint(
        prisma.$executeRaw`
          INSERT INTO core_payments (id, merchant_order_id, amount, currency, status, expires_at, updated_at)
          VALUES (${id()}::uuid, 'no-org', 10, 'VND', 'PENDING', now(), now())`,
      ),
    ).resolves.toContain('organization_id');
  });

  it('refuses a Payment whose Organization does not exist', async () => {
    await expect(
      violatedConstraint(createPayment({ organizationId: id() })),
    ).resolves.toContain('core_payments_organization_id_fkey');
  });

  it('never deletes an Organization that owns Payments', async () => {
    await createPayment();
    await expect(
      violatedConstraint(
        prisma.organization.delete({ where: { id: DEFAULT_ORGANIZATION_ID } }),
      ),
    ).resolves.toContain('core_payments_organization_id_fkey');
  });

  it('creates the default Organization in the migration', async () => {
    await expect(
      prisma.organization.findUniqueOrThrow({
        where: { id: DEFAULT_ORGANIZATION_ID },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('leads each operator list index with the Organization', async () => {
    const rows = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    for (const name of [
      'core_payments_org_created_at_id_idx',
      'core_payments_org_amount_id_idx',
      'core_payment_transactions_org_review_opened_idx',
      'core_outbox_events_org_created_at_id_idx',
      'core_status_transitions_org_created_at_id_idx',
      'core_webhook_inbox_org_received_at_idx',
    ]) {
      expect(byName.get(name), name).toMatch(/\(organization_id, /);
    }
  });

  it('keeps the provider reference unique per gateway only', async () => {
    const first = await createPayment();
    const second = await createPayment();
    await createAttempt(first.id, { providerRef: 'ref-1', gatewayId: 'vnpay' });
    await expect(
      createAttempt(second.id, { providerRef: 'ref-1', gatewayId: 'zalopay' }),
    ).resolves.toBeDefined();
    await expect(
      violatedConstraint(
        createAttempt(second.id, {
          providerRef: 'ref-1',
          gatewayId: 'vnpay',
          status: 'FAILED',
        }),
      ),
    ).resolves.toContain('core_payment_transactions_gateway_provider_ref_uq');
  });

  it('deduplicates webhook inbox rows on gateway and dedupe key', async () => {
    const row = () => ({
      id: id(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      gatewayId: 'vnpay',
      dedupeKey: 'evt-1',
      rawBody: new Uint8Array([1, 2, 3]),
      headers: {},
      query: {},
    });
    await prisma.webhookInbox.create({ data: row() });
    await expect(
      violatedConstraint(prisma.webhookInbox.create({ data: row() })),
    ).resolves.toContain('core_webhook_inbox_org_gateway_dedupe_uq');
  });

  it('restricts deleting a payment that has attempts', async () => {
    const payment = await createPayment();
    await createAttempt(payment.id);
    await expect(
      prisma.payment.delete({ where: { id: payment.id } }),
    ).rejects.toThrow();
  });

  it('stores timestamps with millisecond precision', async () => {
    await createPayment({ merchantOrderId: 'order-ms' });
    await prisma.$executeRaw`
      UPDATE core_payments SET expires_at = '2026-01-01T00:00:00.123456Z'
      WHERE merchant_order_id = 'order-ms'`;
    const [row] = await prisma.$queryRaw<{ us: number }[]>`
      SELECT extract(microseconds FROM expires_at)::int AS us
      FROM core_payments WHERE merchant_order_id = 'order-ms'`;
    expect(row.us).toBe(123_000);
  });
});
