import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { RetentionProcessor } from '../../src/payment-core/reliability/processors/retention.processor.js';
import { RetentionCleanup } from '../../src/payment-core/reliability/retention.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 27: scheduled cleanup deletes only the rows the spec lets expire.
// The worker is switched off here so the test drives each cleanup run.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let runner: TransactionRunner;
let cleanup: RetentionCleanup;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(RetentionProcessor)
    .useValue({})
    .compile();
  await moduleRef.init();
  runner = moduleRef.get(TransactionRunner);
  cleanup = moduleRef.get(RetentionCleanup);
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
});

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

async function givenPayment(): Promise<string> {
  const id = newId();
  await runner.run((tx) =>
    tx.payments.create(defaultScope, {
      id,
      merchantOrderId: `order-${id}`,
      amount: '1000',
      currency: 'VND',
      status: 'PENDING',
      expiresAt: new Date(NOW.getTime() + HOUR),
    }),
  );
  return id;
}

async function givenIdempotencyKey(expiresAt: Date): Promise<string> {
  const key = `key-${newId()}`;
  await runner.repositories.idempotencyKeys.create(defaultScope, {
    key,
    requestHash: 'hash',
    responseStatus: 201,
    responseBody: {},
    paymentId: null,
    expiresAt,
  });
  return key;
}

async function idempotencyKeyExists(key: string): Promise<boolean> {
  return (
    (await runner.repositories.idempotencyKeys.find(defaultScope, key)) !== null
  );
}

describe('retention cleanup: idempotency records', () => {
  it('deletes a record 24 hours after its expiry time, not before', async () => {
    const due = await givenIdempotencyKey(ago(DAY));
    const almost = await givenIdempotencyKey(ago(DAY - 1000));
    const live = await givenIdempotencyKey(new Date(NOW.getTime() + HOUR));

    await cleanup.run();

    expect(await idempotencyKeyExists(due)).toBe(false);
    expect(await idempotencyKeyExists(almost)).toBe(true);
    expect(await idempotencyKeyExists(live)).toBe(true);
  });
});

async function givenOutboxEvent(
  paymentId: string,
  publishedAt: Date | null,
): Promise<string> {
  const event = await runner.repositories.outbox.add(defaultScope, {
    eventType: 'PaymentCreated',
    paymentId,
    payload: {},
  });
  if (publishedAt) {
    await runner.repositories.outbox.markPublished(
      defaultScope,
      event.id,
      publishedAt,
    );
  }
  return event.id;
}

async function outboxIds(paymentId: string): Promise<string[]> {
  const events = await runner.repositories.outbox.listForPayment(
    defaultScope,
    paymentId,
  );
  return events.map((e) => e.id);
}

describe('retention cleanup: outbox', () => {
  it('deletes a published row 7 days after publication, not before', async () => {
    const paymentId = await givenPayment();
    await givenOutboxEvent(paymentId, ago(7 * DAY));
    const recent = await givenOutboxEvent(paymentId, ago(7 * DAY - 1000));

    await cleanup.run();

    expect(await outboxIds(paymentId)).toEqual([recent]);
  });

  it('never deletes an unpublished row, however old', async () => {
    const paymentId = await givenPayment();
    const pending = await givenOutboxEvent(paymentId, null);
    await prisma.outboxEvent.update({
      where: { id: pending },
      data: { createdAt: ago(365 * DAY) },
    });
    clock.set(new Date(NOW.getTime() + 365 * DAY));

    await cleanup.run();

    expect(await outboxIds(paymentId)).toEqual([pending]);
  });
});

type InboxStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

async function givenInboxRow(
  receivedAt: Date,
  status: InboxStatus = 'PROCESSED',
): Promise<string> {
  const { entry } = await runner.repositories.webhookInbox.record(
    defaultScope,
    {
      gatewayId: 'fake',
      dedupeKey: newId(),
      rawBody: new TextEncoder().encode('{}'),
      headers: {},
      query: {},
    },
  );
  await prisma.webhookInbox.update({
    where: { id: entry.id },
    data: { receivedAt, status },
  });
  return entry.id;
}

async function inboxRowExists(id: string): Promise<boolean> {
  return (
    (await runner.repositories.webhookInbox.findById(defaultScope, id)) !== null
  );
}

describe('retention cleanup: webhook inbox', () => {
  it('deletes a row 90 days after receipt, not before', async () => {
    const due = await givenInboxRow(ago(90 * DAY));
    const recent = await givenInboxRow(ago(90 * DAY - 1000));

    await cleanup.run();

    expect(await inboxRowExists(due)).toBe(false);
    expect(await inboxRowExists(recent)).toBe(true);
  });

  it('never deletes a FAILED row automatically, however old', async () => {
    const failed = await givenInboxRow(ago(365 * DAY), 'FAILED');

    await cleanup.run();

    expect(await inboxRowExists(failed)).toBe(true);
  });
});

describe('retention cleanup: audit data', () => {
  it('never deletes raw gateway responses or status transitions, however old', async () => {
    const paymentId = await givenPayment();
    const attempt = await runner.run((tx) =>
      tx.payments.createAttempt(defaultScope, {
        id: newId(),
        paymentId,
        gatewayId: 'fake',
        status: 'PENDING',
      }),
    );
    await runner.repositories.gatewayRawResponses.record(defaultScope, {
      attemptId: attempt.id,
      operation: 'initiate',
      payload: { any: 'thing' },
    });
    await runner.repositories.statusTransitions.record(defaultScope, {
      entityType: 'PAYMENT',
      entityId: paymentId,
      fromStatus: null,
      toStatus: 'PENDING',
      trigger: 'create',
      actor: 'merchant',
    });
    const longAgo = ago(10 * 365 * DAY);
    await prisma.gatewayRawResponse.updateMany({
      data: { createdAt: longAgo },
    });
    await prisma.statusTransition.updateMany({ data: { createdAt: longAgo } });

    await cleanup.run();

    expect(
      await runner.repositories.gatewayRawResponses.listForAttempt(
        defaultScope,
        attempt.id,
      ),
    ).toHaveLength(1);
    expect(
      await runner.repositories.statusTransitions.listForEntity(
        defaultScope,
        'PAYMENT',
        paymentId,
      ),
    ).toHaveLength(1);
  });
});
