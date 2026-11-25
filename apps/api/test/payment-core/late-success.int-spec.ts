import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import {
  FakeGatewayPlugin,
  type FakeCallbackPayload,
} from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { ProcessWebhook } from '../../src/payment-core/application/workers/process-webhook.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type {
  AttemptStatus,
  PaymentStatus,
} from '../../src/payment-core/domain/statuses.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// Ticket 21: a success on a FAILED, EXPIRED or CANCELLED attempt is promoted
// only when safe, else it goes to review. Expiry itself is built later, so
// the closed states are seeded directly.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;
let worker: ProcessWebhook;
let runner: TransactionRunner;
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
  runner = moduleRef.get(TransactionRunner);
  repos = runner.repositories;
  fake = moduleRef.get(FakeGatewayPlugin, { strict: false });
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

/** A Payment with one closed attempt and optional extra seeded attempts. */
async function seed(options: {
  attempt: AttemptStatus;
  payment?: PaymentStatus;
  others?: AttemptStatus[];
}) {
  const { payment } = await service.createPayment(defaultScope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  const attemptId = newId();
  const otherIds: string[] = [];
  await runner.run(async (tx) => {
    await tx.payments.createAttempt(defaultScope, {
      id: attemptId,
      paymentId: payment.id,
      gatewayId: 'fake',
      status: options.attempt,
    });
    for (const status of options.others ?? []) {
      const id = newId();
      otherIds.push(id);
      await tx.payments.createAttempt(defaultScope, {
        id,
        paymentId: payment.id,
        gatewayId: 'fake',
        status,
      });
    }
    if (options.payment) {
      await tx.payments.update(defaultScope, payment.id, {
        status: options.payment,
      });
    }
  });
  return { paymentId: payment.id, attemptId, otherIds };
}

async function deliver(
  attemptKey: string,
  payload: Partial<FakeCallbackPayload> = {},
) {
  const callback = fake.signedCallback({
    status: 'SUCCEEDED',
    amount: '150000',
    ...payload,
    attemptKey,
  });
  const { entry } = await repos.webhookInbox.record(defaultScope, {
    gatewayId: fake.gatewayId,
    dedupeKey: newId(),
    attemptKey,
    rawBody: callback.rawBody,
    headers: callback.headers,
    query: callback.query,
  });
  expect(await worker.execute(entry.id)).toBe('processed');
}

const attemptRow = (id: string) =>
  prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id } });
const events = (paymentId: string) =>
  prisma.outboxEvent
    .findMany({ where: { paymentId }, orderBy: { id: 'asc' } })
    .then((rows) => rows.map((r) => r.eventType));

describe('a late success that is safe', () => {
  it.each(['FAILED', 'EXPIRED', 'CANCELLED'] as const)(
    'promotes a %s attempt and its PENDING Payment, and cancels other open attempts',
    async (status) => {
      const { paymentId, attemptId, otherIds } = await seed({
        attempt: status,
        others: ['PENDING'],
      });

      await deliver(attemptId);

      expect(await attemptRow(attemptId)).toMatchObject({
        status: 'SUCCEEDED',
        refundRequired: false,
        reviewReason: null,
      });
      expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
      expect((await attemptRow(otherIds[0]!)).status).toBe('CANCELLED');
      expect(await events(paymentId)).toEqual([
        'PaymentCreated',
        'PaymentSucceeded',
      ]);
    },
  );
});

describe('a late success that goes to review', () => {
  it.each(['EXPIRED', 'CANCELLED'] as const)(
    'on a %s Payment: LATE_SUCCESS_ON_CLOSED_PAYMENT, Payment unchanged',
    async (payment) => {
      const { paymentId, attemptId } = await seed({
        attempt: payment,
        payment,
      });

      await deliver(attemptId);

      expect(await attemptRow(attemptId)).toMatchObject({
        status: 'REQUIRES_REVIEW',
        reviewReason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT',
        reviewOpenedAt: NOW,
        refundRequired: true,
      });
      expect((await paymentRow(paymentId)).status).toBe(payment);
      expect(await events(paymentId)).toEqual([
        'PaymentCreated',
        'PaymentRequiresReview',
      ]);
    },
  );

  it('with another SUCCEEDED attempt: DUPLICATE_SUCCESS', async () => {
    const { paymentId, attemptId } = await seed({
      attempt: 'FAILED',
      payment: 'SUCCEEDED',
      others: ['SUCCEEDED'],
    });

    await deliver(attemptId);

    expect(await attemptRow(attemptId)).toMatchObject({
      status: 'REQUIRES_REVIEW',
      reviewReason: 'DUPLICATE_SUCCESS',
      reviewOpenedAt: NOW,
      refundRequired: true,
    });
    expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
  });

  it('with another amount: AMOUNT_MISMATCH, Payment not promoted', async () => {
    const { paymentId, attemptId } = await seed({ attempt: 'EXPIRED' });

    await deliver(attemptId, { amount: '100' });

    expect(await attemptRow(attemptId)).toMatchObject({
      status: 'REQUIRES_REVIEW',
      reviewReason: 'AMOUNT_MISMATCH',
      refundRequired: true,
    });
    expect((await paymentRow(paymentId)).status).toBe('PENDING');
  });

  it('an attempt cancelled by a late promotion that then succeeds', async () => {
    const { paymentId, attemptId, otherIds } = await seed({
      attempt: 'EXPIRED',
      others: ['PENDING'],
    });
    await deliver(attemptId);

    await deliver(otherIds[0]!);

    expect(await attemptRow(otherIds[0]!)).toMatchObject({
      status: 'REQUIRES_REVIEW',
      reviewReason: 'DUPLICATE_SUCCESS',
      refundRequired: true,
    });
    expect((await paymentRow(paymentId)).status).toBe('SUCCEEDED');
  });

  it('writes PaymentRequiresReview once: a repeat changes nothing', async () => {
    const { paymentId, attemptId } = await seed({
      attempt: 'CANCELLED',
      payment: 'CANCELLED',
    });
    await deliver(attemptId);
    await deliver(attemptId);

    expect(await events(paymentId)).toEqual([
      'PaymentCreated',
      'PaymentRequiresReview',
    ]);
  });
});
