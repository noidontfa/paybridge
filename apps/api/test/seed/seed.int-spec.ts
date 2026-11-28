import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { hashApiKey } from '../../src/identity/application/api-key-secret.js';
import { runSeed, SeedRefusedError } from '../../seed/seed.js';
import { DEVELOPMENT_CREDENTIAL_KEYS } from '../../src/config/env.schema.js';
import { AesCredentialCipher } from '../../src/payment-core/infrastructure/crypto/credential-cipher.js';
import { testDatabaseUrl } from '../setup/test-database.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { DEFAULT_ORGANIZATION_ID } from '../setup/organizations.js';

// Ticket 01: the seed command. Its observable behaviour is what it leaves in
// the database (the operator endpoints arrive in later tickets) and when it
// refuses to run.

const prisma = createTestPrismaClient();
const DATABASE_URL = testDatabaseUrl();
const NOW = new Date('2026-06-15T12:00:00.000Z');

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('seed safety', () => {
  it('refuses to run under NODE_ENV=production and writes nothing', async () => {
    await expect(
      runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'production', now: NOW }),
    ).rejects.toBeInstanceOf(SeedRefusedError);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('refuses a non-local database host without the force flag', async () => {
    await expect(
      runSeed({
        databaseUrl: 'postgresql://u:p@db.example.invalid:5432/app',
        nodeEnv: 'development',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(SeedRefusedError);
  });

  it('with the force flag a non-local host is let through to connecting', async () => {
    const run = runSeed({
      databaseUrl: 'postgresql://u:p@db.example.invalid:5432/app',
      nodeEnv: 'development',
      force: true,
      now: NOW,
    });
    await expect(run).rejects.not.toBeInstanceOf(SeedRefusedError);
  });

  it.each(['localhost', '127.0.0.1'])(
    'runs against host %s without force',
    async (host) => {
      const url = new URL(DATABASE_URL);
      url.hostname = host;
      await runSeed({ databaseUrl: url.toString(), nodeEnv: 'test', now: NOW });
      expect(await prisma.payment.count()).toBeGreaterThan(0);
    },
  );
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seed(extra: { bulk?: number; now?: Date } = {}) {
  return runSeed({
    databaseUrl: DATABASE_URL,
    nodeEnv: 'test',
    now: NOW,
    ...extra,
  });
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

describe('seed contents', () => {
  beforeEach(() => seed());

  it('creates 25 API Payments (22 in the default Organization, 3 in a second one) and 3 checkout Payments, all with the SEED- Upstream Reference prefix', async () => {
    const payments = await prisma.payment.findMany();
    const api = payments.filter((p) => p.pricingPlanId === null);
    expect(api.length).toBe(25);
    expect(payments.length).toBe(28);
    expect(
      api.filter((p) => p.organizationId === DEFAULT_ORGANIZATION_ID),
    ).toHaveLength(22);
    expect(payments.every((p) => p.merchantOrderId.startsWith('SEED-'))).toBe(
      true,
    );
  });

  it('covers every Payment status and PaymentTransaction status', async () => {
    expect(
      distinct((await prisma.payment.findMany()).map((p) => p.status)),
    ).toEqual(['CANCELLED', 'EXPIRED', 'PENDING', 'SUCCEEDED']);
    expect(
      distinct(
        (await prisma.paymentTransaction.findMany()).map((t) => t.status),
      ),
    ).toEqual([
      'CANCELLED',
      'CREATED',
      'EXPIRED',
      'FAILED',
      'PENDING',
      'REQUIRES_REVIEW',
      'SUCCEEDED',
    ]);
  });

  it('covers all four review reasons and all four NextAction types', async () => {
    const attempts = await prisma.paymentTransaction.findMany();
    expect(
      distinct(attempts.map((a) => a.reviewReason).filter(Boolean)),
    ).toEqual([
      'AMBIGUOUS_PROVIDER_STATUS',
      'AMOUNT_MISMATCH',
      'DUPLICATE_SUCCESS',
      'LATE_SUCCESS_ON_CLOSED_PAYMENT',
    ]);
    const types = attempts
      .map((a) => (a.nextAction as { type?: string } | null)?.type)
      .filter(Boolean);
    expect(distinct(types)).toEqual([
      'CLIENT_SDK',
      'QR_CODE',
      'REDIRECT',
      'VOUCHER',
    ]);
  });

  it('has Reviews open over and under 72 hours, plus closed ones', async () => {
    const open = await prisma.paymentTransaction.findMany({
      where: { status: 'REQUIRES_REVIEW' },
    });
    const ages = open.map((a) => NOW.getTime() - a.reviewOpenedAt!.getTime());
    expect(ages.some((age) => age > 72 * HOUR)).toBe(true);
    expect(ages.some((age) => age < 72 * HOUR)).toBe(true);
    const closed = await prisma.paymentTransaction.findMany({
      where: {
        reviewReason: { not: null },
        status: { not: 'REQUIRES_REVIEW' },
      },
    });
    expect(closed.map((a) => a.status).sort()).toEqual([
      'FAILED',
      'FAILED',
      'SUCCEEDED',
    ]);
    const withNote = await prisma.statusTransition.findMany({
      where: { trigger: 'operator_resolution', reason: { not: null } },
    });
    expect(withNote.length).toBeGreaterThan(0);
  });

  it('records the provider-reported amount of the AMOUNT_MISMATCH Review', async () => {
    const mismatch = await prisma.paymentTransaction.findFirstOrThrow({
      where: { reviewReason: 'AMOUNT_MISMATCH' },
      include: { payment: true },
    });
    const reported = (
      mismatch.providerMetadata as { providerReportedAmount?: string }
    ).providerReportedAmount;
    expect(reported).toBeDefined();
    expect(reported).not.toBe(mismatch.payment.amount.toFixed(0));
  });

  it('has a Payment that switched gateway and a Payment with a failed attempt still pending', async () => {
    const switched = await prisma.payment.findMany({
      where: {
        status: 'SUCCEEDED',
        transactions: { some: { gatewayId: 'stripe', status: 'CANCELLED' } },
      },
      include: { transactions: true },
    });
    expect(switched).toHaveLength(1);
    expect(
      switched[0]!.transactions.some(
        (t) => t.gatewayId === 'fake' && t.status === 'SUCCEEDED',
      ),
    ).toBe(true);
    expect(
      await prisma.payment.count({
        where: {
          status: 'PENDING',
          transactions: { some: { status: 'FAILED' } },
        },
      }),
    ).toBeGreaterThan(0);
  });

  it('uses only the stripe and fake gateways and creates no Refunds', async () => {
    expect(
      distinct(
        (await prisma.paymentTransaction.findMany()).map((t) => t.gatewayId),
      ),
    ).toEqual(['fake', 'stripe']);
    expect(
      distinct((await prisma.webhookInbox.findMany()).map((t) => t.gatewayId)),
    ).toEqual(['fake', 'stripe']);
    expect(await prisma.refund.count()).toBe(0);
  });

  it('has six Callbacks covering every status, a missing event id and an unknown Attempt Key', async () => {
    const callbacks = await prisma.webhookInbox.findMany({
      where: { organizationId: DEFAULT_ORGANIZATION_ID },
    });
    expect(callbacks).toHaveLength(6);
    expect(distinct(callbacks.map((c) => c.status))).toEqual([
      'FAILED',
      'PROCESSED',
      'PROCESSING',
      'RECEIVED',
    ]);
    expect(
      callbacks.find((c) => c.status === 'FAILED')?.lastError,
    ).toBeTruthy();
    expect(callbacks.some((c) => c.providerEventId === null)).toBe(true);
    const keys = new Set(
      (await prisma.paymentTransaction.findMany()).map((t) => t.id),
    );
    expect(
      callbacks.some((c) => c.attemptKey !== null && !keys.has(c.attemptKey)),
    ).toBe(true);
  });

  it('has six Payment Events of all five types for API Payments, at least one unpublished', async () => {
    const events = await prisma.outboxEvent.findMany({
      where: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        payment: { pricingPlanId: null },
      },
    });
    expect(events).toHaveLength(6);
    expect(distinct(events.map((e) => e.eventType))).toEqual([
      'PaymentCancelled',
      'PaymentCreated',
      'PaymentExpired',
      'PaymentRequiresReview',
      'PaymentSucceeded',
    ]);
    expect(events.some((e) => e.publishedAt === null)).toBe(true);
    expect(events.some((e) => e.publishedAt !== null)).toBe(true);
  });

  it('covers every status-transition trigger', async () => {
    expect(
      distinct(
        (await prisma.statusTransition.findMany()).map((t) => t.trigger),
      ),
    ).toEqual([
      'create_payment',
      'expiry',
      'gateway_accepted',
      'gateway_rejected',
      'gateway_switch',
      'merchant_cancel',
      'operator_note',
      'operator_resolution',
      'start_attempt',
      'status_query',
      'webhook',
    ]);
  });

  it('spreads Payments over 30 days so the 24h, 7d and 30d ranges have data', async () => {
    const ages = (await prisma.payment.findMany()).map(
      (p) => NOW.getTime() - p.createdAt.getTime(),
    );
    expect(ages.every((age) => age >= 0 && age <= 30 * DAY)).toBe(true);
    expect(ages.filter((age) => age <= DAY).length).toBeGreaterThan(0);
    expect(
      ages.filter((age) => age > DAY && age <= 7 * DAY).length,
    ).toBeGreaterThan(0);
    expect(ages.filter((age) => age > 7 * DAY).length).toBeGreaterThan(0);
  });
});

describe('seed organizations', () => {
  beforeEach(() => seed());

  it('creates its scenarios inside at least two Organizations', async () => {
    const organizations = await prisma.organization.findMany({
      where: { payments: { some: {} } },
    });
    expect(organizations.length).toBeGreaterThanOrEqual(2);
    expect(organizations.map((o) => o.id)).toContain(DEFAULT_ORGANIZATION_ID);
  });

  it('creates Gateway Connections, one of them disabled, with encrypted credentials', async () => {
    const connections = await prisma.gatewayConnection.findMany();
    expect(connections.some((c) => !c.enabled)).toBe(true);
    expect(connections.some((c) => c.enabled)).toBe(true);
    const withCredentials = connections.filter((c) => c.credentialsCiphertext);
    expect(withCredentials.length).toBeGreaterThan(0);
    for (const c of withCredentials) {
      expect(c.credentialsCiphertext).not.toContain('sk_test');
      expect(c.credentialsKeyId).toBeTruthy();
    }
    await seed();
    expect(await prisma.gatewayConnection.count()).toBe(connections.length);
  });

  it('lets the default Organization take QR payments with the fake gateway', async () => {
    const qr = await prisma.gatewayConnection.findFirst({
      where: { organizationId: DEFAULT_ORGANIZATION_ID, gatewayId: 'fake-qr' },
    });
    expect(qr?.enabled).toBe(true);
  });

  it('keeps every row of a Payment in the Payment own Organization', async () => {
    const payments = await prisma.payment.findMany({
      include: { transactions: true, outboxEvents: true },
    });
    for (const payment of payments) {
      for (const attempt of payment.transactions) {
        expect(attempt.organizationId, attempt.id).toBe(payment.organizationId);
      }
      for (const event of payment.outboxEvents) {
        expect(event.organizationId, event.id).toBe(payment.organizationId);
      }
    }
    const transitions = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM core_status_transitions st
      WHERE st.entity_type = 'PAYMENT' AND st.organization_id <>
        (SELECT p.organization_id FROM core_payments p WHERE p.id = st.entity_id)`;
    expect(Number(transitions[0]?.n)).toBe(0);
  });

  it('uses one Upstream Reference in two Organizations', async () => {
    const same = await prisma.payment.findMany({
      where: { merchantOrderId: 'SEED-P01' },
    });
    expect(new Set(same.map((p) => p.organizationId)).size).toBe(2);
  });

  it('includes a suspended Organization whose admin cannot sign in', async () => {
    const suspended = await prisma.organization.findMany({
      where: { name: 'Dormant Goods' },
      include: { users: true },
    });
    expect(suspended).toHaveLength(1);
    expect(suspended[0]!.status).toBe('SUSPENDED');
    expect(suspended[0]!.users.length).toBeGreaterThan(0);
  });

  it('leaves the Organizations in place on a re-run', async () => {
    const before = await prisma.organization.count();
    await seed();
    expect(await prisma.organization.count()).toBe(before);
  });
});

describe('seed API Keys', () => {
  it('creates working, revoked and per-Organization keys, kept across re-runs', async () => {
    const first = await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test', now: NOW });
    await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test', now: NOW });

    const keys = await prisma.apiKey.findMany({
      where: { label: { startsWith: 'Seed:' } },
      orderBy: { label: 'asc' },
    });
    expect(keys.length).toBe(first.apiKeys.length);
    expect(new Set(keys.map((k) => k.organizationId)).size).toBeGreaterThanOrEqual(2);
    expect(keys.some((k) => k.revokedAt)).toBe(true);
    for (const issued of first.apiKeys) {
      const row = keys.find((k) => k.label === issued.label)!;
      expect(row.keyHash).toBe(hashApiKey(issued.key));
      expect(issued.key.startsWith(row.prefix)).toBe(true);
    }
  });
});

describe('seed Pricing Plans', () => {
  it('creates Pricing Plans in two Organizations, one archived, kept across re-runs', async () => {
    const first = await seed();
    await seed();

    const plans = await prisma.pricingPlan.findMany();
    expect(plans).toHaveLength(first.pricingPlans);
    expect(new Set(plans.map((p) => p.organizationId)).size).toBe(2);
    expect(plans.filter((p) => p.status === 'ARCHIVED')).toHaveLength(1);
    expect(plans.some((p) => p.allowedGatewayIds.length === 0)).toBe(true);
  });
});

describe('seed Pricing Tables', () => {
  it('creates a Pricing Table with three Pricing Plans, one recommended, kept across re-runs', async () => {
    const first = await seed();
    await seed();

    expect(first.pricingTables).toHaveLength(1);
    const table = await prisma.pricingTable.findUniqueOrThrow({
      where: { id: first.pricingTables[0]!.id },
      include: { plans: { orderBy: { position: 'asc' } } },
    });
    expect(table.plans).toHaveLength(3);
    expect(table.plans.filter((p) => p.recommended)).toHaveLength(1);
    const plans = await prisma.pricingPlan.findMany({
      where: { id: { in: table.plans.map((p) => p.pricingPlanId) } },
    });
    expect(plans.every((p) => p.organizationId === table.organizationId)).toBe(
      true,
    );
  });
});

describe('seed Webhook Endpoint', () => {
  it('points a Webhook Endpoint of the default Organization at a local receiver, kept across re-runs', async () => {
    const first = await runSeed({
      databaseUrl: DATABASE_URL,
      nodeEnv: 'test',
      now: NOW,
    });
    await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test', now: NOW });

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId: DEFAULT_ORGANIZATION_ID },
    });
    expect(endpoints).toHaveLength(1);
    const [endpoint] = endpoints;
    expect(endpoint).toMatchObject({
      url: 'http://localhost:9998/webhooks',
      status: 'ENABLED',
      deletedAt: null,
    });
    expect([...endpoint!.eventKinds].sort()).toEqual([
      'payment.cancelled',
      'payment.created',
      'payment.expired',
      'payment.requires_review',
      'payment.succeeded',
    ]);
    const cipher = AesCredentialCipher.fromConfig(DEVELOPMENT_CREDENTIAL_KEYS);
    expect(
      cipher.decrypt({
        ciphertext: endpoint!.secretCiphertext,
        keyId: endpoint!.secretKeyId,
      }),
    ).toBe(first.webhookEndpoint.secret);
    expect(
      first.webhookEndpoint.secret.startsWith(endpoint!.secretPrefix),
    ).toBe(true);
  });
});

describe('seed checkout activity', () => {
  it('creates checkout Payments with their Pricing Plan, Customer Reference, email and session, kept across re-runs', async () => {
    await seed();
    await seed();

    const payments = await prisma.payment.findMany({
      where: { pricingPlanId: { not: null } },
      orderBy: { merchantOrderId: 'asc' },
    });
    expect(
      payments.map((p) => [
        p.merchantOrderId,
        p.status,
        p.pricingPlanName,
        p.customerRef,
        p.customerEmail,
      ]),
    ).toEqual([
      ['SEED-CHK-1', 'SUCCEEDED', 'Pro', 'cus_1001', 'linh.nguyen@example.com'],
      ['SEED-CHK-2', 'PENDING', 'Basic', 'cus_1002', null],
      ['SEED-CHK-3', 'EXPIRED', 'Basic', null, 'an.tran@example.com'],
    ]);
    const plans = await prisma.pricingPlan.findMany({
      where: { id: { in: payments.map((p) => p.pricingPlanId!) } },
    });
    expect(plans.map((p) => p.name).sort()).toEqual(['Basic', 'Pro']);
    const sessions = await prisma.checkoutSession.findMany();
    expect(sessions.map((s) => s.paymentId).sort()).toEqual(
      payments.map((p) => p.id).sort(),
    );
  });

  it('creates Webhook deliveries that succeeded, still retry and failed, kept across re-runs', async () => {
    await seed();
    await seed();

    const deliveries = await prisma.webhookDelivery.findMany({
      include: { attemptRows: true },
    });
    expect(distinct(deliveries.map((d) => d.status))).toEqual([
      'FAILED',
      'PENDING',
      'SUCCEEDED',
    ]);
    for (const d of deliveries) {
      expect(d.attemptRows.length).toBeGreaterThan(0);
      expect(d.paymentId).not.toBeNull();
      expect(
        d.attemptRows.filter((a) => a.triggeredByUserId === null),
      ).toHaveLength(d.attempts);
    }
    const failed = deliveries.find((d) => d.status === 'FAILED')!;
    expect(failed.attempts).toBe(12);
    expect(
      deliveries.some((d) => d.attemptRows.some((a) => a.triggeredByName)),
    ).toBe(true);
    const events = await prisma.outboxEvent.findMany({
      where: { id: { in: deliveries.map((d) => d.eventId) } },
    });
    expect(events).toHaveLength(deliveries.length);
  });
});

describe('seed Publishable Keys', () => {
  it('creates a key for the default Organization allowing a local origin, kept across re-runs', async () => {
    const first = await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test', now: NOW });
    await runSeed({ databaseUrl: DATABASE_URL, nodeEnv: 'test', now: NOW });

    expect(first.publishableKeys.length).toBeGreaterThanOrEqual(1);
    for (const issued of first.publishableKeys) {
      const row = await prisma.publishableKey.findUniqueOrThrow({
        where: { key: issued.key },
      });
      expect(issued.key).toMatch(/^pb_pk_seed_/);
      expect(row.revokedAt).toBeNull();
      expect(row.allowedOrigins).toEqual(issued.allowedOrigins);
    }
    const primary = first.publishableKeys.find(
      (k) => k.organization === 'primary',
    )!;
    expect(primary.allowedOrigins).toContain('http://localhost:5173');
  });
});

describe('seed users', () => {
  it('includes a deactivated User next to active ones', async () => {
    await seed();
    const former = await prisma.user.findUniqueOrThrow({
      where: { email: 'former.operator@default.paybridge.dev' },
    });
    expect(former).toMatchObject({ active: false, role: 'OPERATOR' });
    expect(
      await prisma.user.count({
        where: { organizationId: former.organizationId, active: true },
      }),
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('seed timestamps and ids', () => {
  it('uses fixed offsets from the run time and deterministic ids', async () => {
    await seed();
    const first = await prisma.payment.findMany({ orderBy: { id: 'asc' } });
    await seed({ now: new Date(NOW.getTime() + 3 * DAY) });
    const second = await prisma.payment.findMany({ orderBy: { id: 'asc' } });
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
    for (const [i, p] of second.entries()) {
      expect(p.createdAt.getTime() - first[i]!.createdAt.getTime()).toBe(
        3 * DAY,
      );
    }
  });
});

describe('seed re-runs', () => {
  it('replaces only its own rows and leaves other data untouched', async () => {
    await seed();
    const other = await prisma.payment.create({
      data: {
        id: '00000000-0000-7000-8000-00000000abcd',
        organizationId: DEFAULT_ORGANIZATION_ID,
        merchantOrderId: 'REAL-1',
        amount: '5000',
        currency: 'VND',
        status: 'PENDING',
        expiresAt: new Date(NOW.getTime() + DAY),
        transactions: {
          create: {
            id: '00000000-0000-7000-8000-00000000abce',
            organizationId: DEFAULT_ORGANIZATION_ID,
            gatewayId: 'stripe',
            status: 'CREATED',
          },
        },
        outboxEvents: {
          create: {
            id: '00000000-0000-7000-8000-00000000abcf',
            organizationId: DEFAULT_ORGANIZATION_ID,
            eventType: 'PaymentCreated',
            payload: {},
          },
        },
      },
    });
    const counts = async () => ({
      payments: await prisma.payment.count(),
      attempts: await prisma.paymentTransaction.count(),
      transitions: await prisma.statusTransition.count(),
      callbacks: await prisma.webhookInbox.count(),
      events: await prisma.outboxEvent.count(),
    });
    const before = await counts();
    await seed();
    expect(await counts()).toEqual(before);
    expect(
      await prisma.payment.findUnique({ where: { id: other.id } }),
    ).not.toBeNull();
    expect(
      await prisma.outboxEvent.count({ where: { paymentId: other.id } }),
    ).toBe(1);
  });
});

describe('seed command line', () => {
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync('pnpm', ['exec', 'tsx', 'seed/main.ts', ...args], {
      cwd: join(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL, ...env },
      encoding: 'utf8',
    });

  it('exits non-zero under NODE_ENV=production and writes nothing', async () => {
    const result = run([], { NODE_ENV: 'production' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_ENV=production');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('seeds the database and honours --bulk', async () => {
    const result = run(['--bulk', '3'], { NODE_ENV: 'test' });
    expect(result.status).toBe(0);
    expect(await prisma.payment.count()).toBe(28 + 3); // + checkout Payments
  });
});

describe('seed bulk flag', () => {
  it('adds no bulk Payments by default and N more with the flag, replaced on re-run', async () => {
    // 25 API Payments and 3 checkout Payments without the flag.
    await seed();
    expect(await prisma.payment.count()).toBe(28);
    await seed({ bulk: 150 });
    expect(await prisma.payment.count()).toBe(178);
    await seed();
    expect(await prisma.payment.count()).toBe(28);
  });

  it('keeps bulk Payments within 30 days', async () => {
    await seed({ bulk: 60 });
    const bulk = await prisma.payment.findMany({
      where: { merchantOrderId: { startsWith: 'SEED-BULK-' } },
    });
    expect(bulk).toHaveLength(60);
    expect(
      bulk.every((p) => NOW.getTime() - p.createdAt.getTime() <= 30 * DAY),
    ).toBe(true);
  });
});
