import { GatewayManager } from '../../src/payment-core/gateway-manager/gateway-manager.js';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import {
  FakeGatewayPlugin,
  type FakeCallbackPayload,
} from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { WebhookIntake } from '../../src/payment-core/application/webhook-intake.js';
import { ProcessWebhook } from '../../src/payment-core/application/workers/process-webhook.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { AttemptInReviewError } from '../../src/payment-core/domain/errors.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Payment } from '../../src/payment-core/domain/payment.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 19: a stored webhook is applied to its attempt and Payment by the
// ProcessWebhook worker service, against the migrated test database with the
// fake Gateway Plugin.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;
let worker: ProcessWebhook;
let repos: Repositories;
let fake: FakeGatewayPlugin;

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
    .compile();
  await moduleRef.init();
  service = moduleRef.get(PaymentService);
  worker = moduleRef.get(ProcessWebhook);
  repos = moduleRef.get(TransactionRunner).repositories;
  fake = moduleRef
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  fake.reset();
  await resetDatabase(prisma);
});

async function pendingAttempt(): Promise<{
  payment: Payment;
  attemptId: string;
}> {
  const { payment } = await service.createPayment(defaultScope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  const { attempt } = await service.startAttempt(defaultScope, {
    paymentId: payment.id,
    gatewayId: fake.gatewayId,
    returnUrl: 'https://shop.example/return',
  });
  expect(attempt.status).toBe('PENDING');
  return { payment, attemptId: attempt.id };
}

/** A verified callback stored in the inbox, as intake would store it. */
async function storeCallback(
  payload: Partial<FakeCallbackPayload> & { attemptKey: string },
): Promise<string> {
  const callback = fake.signedCallback({
    status: 'SUCCEEDED',
    amount: '150000',
    ...payload,
  });
  const { entry } = await repos.webhookInbox.record(defaultScope, {
    gatewayId: fake.gatewayId,
    dedupeKey: newId(),
    attemptKey: payload.attemptKey,
    rawBody: callback.rawBody,
    headers: callback.headers,
    query: callback.query,
  });
  return entry.id;
}

const attemptRow = (id: string) =>
  prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id } });
const inboxRow = (id: string) =>
  prisma.webhookInbox.findUniqueOrThrow({ where: { id } });
const events = (paymentId: string) =>
  prisma.outboxEvent
    .findMany({ where: { paymentId }, orderBy: { id: 'asc' } })
    .then((rows) => rows.map((r) => r.eventType));
const transitions = (entityId: string) =>
  prisma.statusTransition.findMany({
    where: { entityId },
    orderBy: { createdAt: 'asc' },
  });

describe('a stored row that re-parses as ignored', () => {
  it('is marked PROCESSED with no state change and no error', async () => {
    const { payment, attemptId } = await pendingAttempt();
    const callback = fake.signedCallback({ ignored: true });
    const { entry } = await repos.webhookInbox.record(defaultScope, {
      gatewayId: fake.gatewayId,
      dedupeKey: newId(),
      rawBody: callback.rawBody,
      headers: callback.headers,
      query: callback.query,
    });

    expect(await worker.execute(entry.id)).toBe('processed');

    expect(await inboxRow(entry.id)).toMatchObject({
      status: 'PROCESSED',
      processedAt: NOW,
      lockedAt: null,
      lastError: null,
    });
    expect((await attemptRow(attemptId)).status).toBe('PENDING');
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect(await events(payment.id)).toEqual(['PaymentCreated']);
  });
});

describe('a success with the Payment amount', () => {
  it('moves the attempt and the Payment to SUCCEEDED, writes PaymentSucceeded and marks the row PROCESSED', async () => {
    const { payment, attemptId } = await pendingAttempt();
    const inboxId = await storeCallback({
      attemptKey: attemptId,
      providerRef: 'prov-1',
    });

    expect(await worker.execute(inboxId)).toBe('processed');

    expect(await attemptRow(attemptId)).toMatchObject({
      status: 'SUCCEEDED',
      providerRef: 'prov-1',
      refundRequired: false,
      reviewReason: null,
    });
    expect((await paymentRow(payment.id)).status).toBe('SUCCEEDED');
    expect(await events(payment.id)).toEqual([
      'PaymentCreated',
      'PaymentSucceeded',
    ]);
    const succeeded = await prisma.outboxEvent.findFirstOrThrow({
      where: { paymentId: payment.id, eventType: 'PaymentSucceeded' },
    });
    expect(succeeded.payload).toMatchObject({
      paymentId: payment.id,
      attemptId,
      gatewayId: 'fake',
      amount: '150000',
      currency: 'VND',
      status: 'SUCCEEDED',
    });
    expect(
      (await transitions(attemptId)).map((t) => [
        t.fromStatus,
        t.toStatus,
        t.trigger,
      ]),
    ).toEqual([
      [null, 'CREATED', 'start_attempt'],
      ['CREATED', 'PENDING', 'gateway_accepted'],
      ['PENDING', 'SUCCEEDED', 'webhook'],
    ]);
    expect(
      (await transitions(payment.id)).map((t) => [
        t.fromStatus,
        t.toStatus,
        t.trigger,
      ]),
    ).toEqual([
      [null, 'PENDING', expect.any(String)],
      ['PENDING', 'SUCCEEDED', 'webhook'],
    ]);
    expect(await inboxRow(inboxId)).toMatchObject({
      status: 'PROCESSED',
      processedAt: NOW,
      lockedAt: null,
      attempts: 1,
      lastError: null,
    });
  });

  it('is accepted for an attempt still in CREATED', async () => {
    const { payment } = await service.createPayment(defaultScope, {
      amount: '150000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    });
    const attemptId = newId();
    await moduleRef.get(TransactionRunner).run((tx) =>
      tx.payments.createAttempt(defaultScope, {
        id: attemptId,
        paymentId: payment.id,
        gatewayId: 'fake',
        status: 'CREATED',
      }),
    );
    const inboxId = await storeCallback({ attemptKey: attemptId });

    await worker.execute(inboxId);

    expect((await attemptRow(attemptId)).status).toBe('SUCCEEDED');
    expect((await paymentRow(payment.id)).status).toBe('SUCCEEDED');
  });

  it('locks the Payment row first: processing waits for another holder of the lock', async () => {
    const { payment, attemptId } = await pendingAttempt();
    const inboxId = await storeCallback({ attemptKey: attemptId });

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core_payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      locked();
      await released;
    });
    await isLocked;

    const processing = worker.execute(inboxId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await attemptRow(attemptId)).status).toBe('PENDING');
    expect((await inboxRow(inboxId)).status).toBe('PROCESSING');

    release();
    await holder;
    expect(await processing).toBe('processed');
    expect((await attemptRow(attemptId)).status).toBe('SUCCEEDED');
    expect((await inboxRow(inboxId)).status).toBe('PROCESSED');
  });
});

describe('a clear failure', () => {
  it('fails the attempt only: the Payment stays PENDING and no event is written', async () => {
    const { payment, attemptId } = await pendingAttempt();
    const inboxId = await storeCallback({
      attemptKey: attemptId,
      status: 'FAILED',
      amount: null,
    });

    await worker.execute(inboxId);

    expect((await attemptRow(attemptId)).status).toBe('FAILED');
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect(await events(payment.id)).toEqual(['PaymentCreated']);
    expect((await inboxRow(inboxId)).status).toBe('PROCESSED');
  });
});

describe('a result that goes to review', () => {
  it.each([
    [
      'a success with another amount',
      { status: 'SUCCEEDED', amount: '149000' },
      'AMOUNT_MISMATCH',
    ],
    [
      'an ambiguous result',
      { status: 'REQUIRES_REVIEW', amount: '150000' },
      'AMBIGUOUS_PROVIDER_STATUS',
    ],
  ] as const)(
    '%s: attempt REQUIRES_REVIEW with reason, review time, refund flag; Payment not promoted; PaymentRequiresReview',
    async (_name, result, reason) => {
      const { payment, attemptId } = await pendingAttempt();
      const inboxId = await storeCallback({ attemptKey: attemptId, ...result });

      await worker.execute(inboxId);

      expect(await attemptRow(attemptId)).toMatchObject({
        status: 'REQUIRES_REVIEW',
        reviewReason: reason,
        reviewOpenedAt: NOW,
        refundRequired: true,
      });
      expect((await paymentRow(payment.id)).status).toBe('PENDING');
      expect(await events(payment.id)).toEqual([
        'PaymentCreated',
        'PaymentRequiresReview',
      ]);
      const review = await prisma.outboxEvent.findFirstOrThrow({
        where: { paymentId: payment.id, eventType: 'PaymentRequiresReview' },
      });
      expect(review.payload).toMatchObject({
        paymentId: payment.id,
        attemptId,
        reviewReason: reason,
        refundRequired: true,
        status: 'PENDING',
      });
      expect((await transitions(attemptId)).at(-1)).toMatchObject({
        fromStatus: 'PENDING',
        toStatus: 'REQUIRES_REVIEW',
        reason,
      });
    },
  );

  it('blocks new attempts on the Payment', async () => {
    const { payment, attemptId } = await pendingAttempt();
    await worker.execute(
      await storeCallback({ attemptKey: attemptId, status: 'REQUIRES_REVIEW' }),
    );

    await expect(
      service.startAttempt(defaultScope, {
        paymentId: payment.id,
        gatewayId: fake.gatewayId,
        returnUrl: 'https://shop.example/return',
      }),
    ).rejects.toBeInstanceOf(AttemptInReviewError);
  });
});

describe('repeats', () => {
  it('a second success for a succeeded attempt changes nothing and writes no second event', async () => {
    const { payment, attemptId } = await pendingAttempt();
    await worker.execute(await storeCallback({ attemptKey: attemptId }));
    const before = await transitions(attemptId);

    const again = await storeCallback({ attemptKey: attemptId });
    expect(await worker.execute(again)).toBe('processed');

    expect(await transitions(attemptId)).toHaveLength(before.length);
    expect(await events(payment.id)).toEqual([
      'PaymentCreated',
      'PaymentSucceeded',
    ]);
    expect((await inboxRow(again)).status).toBe('PROCESSED');
  });

  it('a second ambiguous result keeps the review as it was and writes no second event', async () => {
    const { payment, attemptId } = await pendingAttempt();
    await worker.execute(
      await storeCallback({ attemptKey: attemptId, status: 'REQUIRES_REVIEW' }),
    );
    clock.advance(60_000);
    await worker.execute(
      await storeCallback({ attemptKey: attemptId, status: 'REQUIRES_REVIEW' }),
    );

    expect((await attemptRow(attemptId)).reviewOpenedAt).toEqual(NOW);
    expect(await events(payment.id)).toEqual([
      'PaymentCreated',
      'PaymentRequiresReview',
    ]);
  });

  it('a row already PROCESSED is skipped', async () => {
    const { attemptId } = await pendingAttempt();
    const inboxId = await storeCallback({ attemptKey: attemptId });
    await worker.execute(inboxId);

    expect(await worker.execute(inboxId)).toBe('skipped');
    expect((await inboxRow(inboxId)).attempts).toBe(1);
  });
});

describe('a row that cannot be applied', () => {
  it('for an attempt Core does not know is marked FAILED with the error, and changes nothing', async () => {
    const inboxId = await storeCallback({ attemptKey: newId() });

    expect(await worker.execute(inboxId)).toBe('failed');

    expect(await inboxRow(inboxId)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lockedAt: null,
      lastError: expect.stringMatching(/attempt/i),
    });
  });

  it('that no longer verifies is marked FAILED and changes nothing', async () => {
    const { attemptId } = await pendingAttempt();
    const callback = fake.signedCallback({
      attemptKey: attemptId,
      status: 'SUCCEEDED',
      amount: '150000',
    });
    const { entry } = await repos.webhookInbox.record(defaultScope, {
      gatewayId: 'fake',
      dedupeKey: newId(),
      attemptKey: attemptId,
      rawBody: callback.rawBody,
      headers: { ...callback.headers, 'x-fake-signature': 'tampered' },
      query: {},
    });

    expect(await worker.execute(entry.id)).toBe('failed');

    expect((await attemptRow(attemptId)).status).toBe('PENDING');
    expect((await inboxRow(entry.id)).status).toBe('FAILED');
  });

  it('a FAILED row can be processed again', async () => {
    const { attemptId } = await pendingAttempt();
    const inboxId = await storeCallback({ attemptKey: attemptId });
    await prisma.webhookInbox.update({
      where: { id: inboxId },
      data: { status: 'FAILED', attempts: 1, lastError: 'earlier' },
    });

    expect(await worker.execute(inboxId)).toBe('processed');
    expect(await inboxRow(inboxId)).toMatchObject({
      status: 'PROCESSED',
      attempts: 2,
      lastError: null,
    });
  });
});

describe('dispatch', () => {
  it('a callback received by intake is processed from the webhook queue', async () => {
    const { payment, attemptId } = await pendingAttempt();
    const callback = fake.signedCallback({
      attemptKey: attemptId,
      status: 'SUCCEEDED',
      amount: '150000',
    });

    await moduleRef
      .get(WebhookIntake)
      .receive(defaultScope, { gatewayId: 'fake', ...callback });

    await vi.waitFor(
      async () => {
        expect((await paymentRow(payment.id)).status).toBe('SUCCEEDED');
      },
      { timeout: 10_000, interval: 100 },
    );
    const [row] = await prisma.webhookInbox.findMany();
    await vi.waitFor(async () => {
      expect((await inboxRow(row!.id)).status).toBe('PROCESSED');
    });
  });
});
