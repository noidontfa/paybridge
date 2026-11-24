import { Logger, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import {
  PaymentNotFoundError,
  PaymentNotPendingError,
} from '../../src/payment-core/domain/errors.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Payment } from '../../src/payment-core/domain/payment.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { GATEWAY_PLUGINS } from '../../src/payment-core/gateway-manager/gateway-plugins.token.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  GatewayUnavailableError,
  OutcomeUnknownError,
} from '../../src/payment-core/port/index.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Merchant cancel (ticket 17): one transaction cancels the Payment and its
// open attempts and writes `PaymentCancelled`; providers are asked after
// commit, only when they declare supportsCancel. Two fake gateways: `alpha`
// supports cancel, `beta` does not.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const RETURN_URL = 'https://shop.example/return';
const alpha = new FakeGatewayPlugin({ gatewayId: 'alpha' });
const beta = new FakeGatewayPlugin({
  gatewayId: 'beta',
  supportsCancel: false,
});

@Module({
  providers: [{ provide: GATEWAY_PLUGINS, useValue: [alpha, beta] }],
  exports: [GATEWAY_PLUGINS],
})
class TwoGatewaysModule {}

const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;
let repos: Repositories;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [TwoGatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  await moduleRef.init();
  service = moduleRef.get(PaymentService);
  repos = moduleRef.get(TransactionRunner).repositories;
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  alpha.reset();
  beta.reset();
  vi.restoreAllMocks();
  await resetDatabase(prisma);
});

async function createPayment(): Promise<Payment> {
  const { payment } = await service.createPayment({
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  return payment;
}

function start(payment: Payment, gatewayId: string) {
  return service.startAttempt({
    paymentId: payment.id,
    gatewayId,
    returnUrl: RETURN_URL,
  });
}

describe('cancelPayment', () => {
  it('cancels a PENDING Payment with no attempt and writes PaymentCancelled', async () => {
    const payment = await createPayment();

    const result = await service.cancelPayment(payment.id);

    expect(result.status).toBe('CANCELLED');
    const stored = await repos.payments.findById(payment.id);
    expect(stored?.status).toBe('CANCELLED');
    const events = await repos.outbox.listForPayment(payment.id);
    expect(events.map((e) => e.eventType)).toEqual([
      'PaymentCreated',
      'PaymentCancelled',
    ]);
    expect(events[1]?.payload).toMatchObject({
      paymentId: payment.id,
      status: 'CANCELLED',
    });
    const trail = await repos.statusTransitions.listForEntity(
      'PAYMENT',
      payment.id,
    );
    expect(trail.at(-1)).toMatchObject({
      fromStatus: 'PENDING',
      toStatus: 'CANCELLED',
      trigger: 'merchant_cancel',
    });
  });

  it('cancels the open attempt with the Payment, then asks the provider', async () => {
    const payment = await createPayment();
    const { attempt } = await start(payment, 'alpha');

    const result = await service.cancelPayment(payment.id);

    expect(result.attempts.map((a) => a.status)).toEqual(['CANCELLED']);
    const trail = await repos.statusTransitions.listForEntity(
      'PAYMENT_TRANSACTION',
      attempt.id,
    );
    expect(trail.at(-1)).toMatchObject({
      fromStatus: 'PENDING',
      toStatus: 'CANCELLED',
      trigger: 'merchant_cancel',
    });
    expect(alpha.calls.cancel).toHaveLength(1);
    expect(alpha.calls.cancel[0]?.attemptKey).toBe(attempt.id);
  });

  it('cancels a CREATED attempt too', async () => {
    const payment = await createPayment();
    // Leaves the attempt CREATED (ticket 22); the queued query runs later.
    alpha.scriptInitiate(new OutcomeUnknownError('timeout'));
    await start(payment, 'alpha');

    const result = await service.cancelPayment(payment.id);

    expect(result.attempts.map((a) => a.status)).toEqual(['CANCELLED']);
  });

  it('commits the local cancel before the provider is called', async () => {
    const payment = await createPayment();
    await start(payment, 'alpha');
    let seen: string | undefined;
    alpha.scriptCancel(async () => {
      seen = (
        await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
      ).status;
      return { rawPayload: {} };
    });

    await service.cancelPayment(payment.id);

    expect(seen).toBe('CANCELLED');
  });

  it('does not call a plugin that lacks supportsCancel', async () => {
    const payment = await createPayment();
    await start(payment, 'beta');

    const result = await service.cancelPayment(payment.id);

    expect(result.status).toBe('CANCELLED');
    expect(beta.calls.cancel).toHaveLength(0);
  });

  it('keeps the local state when the provider cancel fails', async () => {
    const payment = await createPayment();
    await start(payment, 'alpha');
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    alpha.scriptCancel(new GatewayUnavailableError('down'));

    const result = await service.cancelPayment(payment.id);

    expect(result.status).toBe('CANCELLED');
    expect(result.attempts.map((a) => a.status)).toEqual(['CANCELLED']);
  });

  it('is a no-op on an already CANCELLED Payment', async () => {
    const payment = await createPayment();
    await service.cancelPayment(payment.id);

    const again = await service.cancelPayment(payment.id);

    expect(again.status).toBe('CANCELLED');
    const events = await repos.outbox.listForPayment(payment.id);
    expect(
      events.filter((e) => e.eventType === 'PaymentCancelled'),
    ).toHaveLength(1);
  });

  it.each(['SUCCEEDED', 'EXPIRED'] as const)(
    'rejects a %s Payment with PaymentNotPendingError',
    async (status) => {
      const payment = await createPayment();
      await repos.payments.update(payment.id, { status });

      await expect(service.cancelPayment(payment.id)).rejects.toBeInstanceOf(
        PaymentNotPendingError,
      );
      expect((await repos.payments.findById(payment.id))?.status).toBe(status);
    },
  );

  it('rejects an unknown Payment', async () => {
    await expect(service.cancelPayment(newId())).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('blocks a new attempt after the cancel', async () => {
    const payment = await createPayment();
    await service.cancelPayment(payment.id);

    await expect(start(payment, 'alpha')).rejects.toBeInstanceOf(
      PaymentNotPendingError,
    );
  });
});

describe('POST /api/payments/:id/cancel', () => {
  let app: INestApplication;
  let fake: FakeGatewayPlugin;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(new FakeClock(NOW))
      .compile();
    app = ref.createNestApplication({ logger: false });
    app.setGlobalPrefix(GLOBAL_PREFIX);
    await app.init();
    fake = app.get(FakeGatewayPlugin, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => fake.reset());

  async function create(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/payments')
      .send({
        amount: '150000',
        currency: 'VND',
        upstreamReference: `order-${newId()}`,
      })
      .expect(201);
    return res.body.id as string;
  }

  it('200 with the CANCELLED Payment, and 200 again on a repeat', async () => {
    const id = await create();

    const res = await request(app.getHttpServer())
      .post(`/api/payments/${id}/cancel`)
      .expect(200);
    expect(res.body).toMatchObject({ id, status: 'CANCELLED' });

    await request(app.getHttpServer())
      .post(`/api/payments/${id}/cancel`)
      .expect(200);
  });

  it('409 for a SUCCEEDED Payment', async () => {
    const id = await create();
    await prisma.payment.update({
      where: { id },
      data: { status: 'SUCCEEDED' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/payments/${id}/cancel`)
      .expect(409);
    expect(res.body.code).toBe('PAYMENT_NOT_PENDING');
  });

  it('404 for an unknown Payment and 400 for a malformed id', async () => {
    await request(app.getHttpServer())
      .post(`/api/payments/${newId()}/cancel`)
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/payments/not-a-uuid/cancel')
      .expect(400);
  });
});
