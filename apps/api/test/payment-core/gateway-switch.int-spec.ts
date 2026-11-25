import { Logger, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Payment } from '../../src/payment-core/domain/payment.js';
import { canTransitionAttempt } from '../../src/payment-core/domain/rules/attempt-transitions.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { fixedPlugin } from '../../src/payment-core/gateway-manager/gateway-plugin-factory.js';
import { GATEWAY_PLUGINS } from '../../src/payment-core/gateway-manager/gateway-plugins.token.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  GatewayRejectedError,
  GatewayUnavailableError,
  OutcomeUnknownError,
  type CancelInput,
} from '../../src/payment-core/port/index.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Gateway switch (ticket 16): a new attempt on the same Payment cancels the
// open one in the same locked step, then cancels it at the provider
// best-effort. Two fake gateways: `alpha` supports cancel, `beta` does not.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const RETURN_URL = 'https://shop.example/return';
const alpha = new FakeGatewayPlugin({ gatewayId: 'alpha' });
const beta = new FakeGatewayPlugin({
  gatewayId: 'beta',
  supportsCancel: false,
});

@Module({
  providers: [
    {
      provide: GATEWAY_PLUGINS,
      useValue: [fixedPlugin(alpha), fixedPlugin(beta)],
    },
  ],
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

async function trail(attemptId: string) {
  const rows = await repos.statusTransitions.listForEntity(
    'PAYMENT_TRANSACTION',
    attemptId,
  );
  return rows.map((t) => ({
    from: t.fromStatus,
    to: t.toStatus,
    trigger: t.trigger,
    actor: t.actor,
  }));
}

describe('Gateway switch: the local cancel', () => {
  it('cancels a PENDING attempt and opens the new one, leaving one open attempt', async () => {
    const payment = await createPayment();
    const first = await start(payment, 'alpha');
    expect(first.attempt.status).toBe('PENDING');

    const second = await start(payment, 'beta');

    expect(second.attempt).toMatchObject({
      gatewayId: 'beta',
      status: 'PENDING',
    });
    const stored = await repos.payments.findById(payment.id);
    expect(stored?.status).toBe('PENDING');
    const byId = new Map(stored?.attempts.map((a) => [a.id, a.status]));
    expect(byId.get(first.attempt.id)).toBe('CANCELLED');
    expect(byId.get(second.attempt.id)).toBe('PENDING');
  });

  it('cancels a CREATED attempt', async () => {
    const payment = await createPayment();
    // Leaves the attempt CREATED (ticket 22); the queued query runs later.
    alpha.scriptInitiate(new OutcomeUnknownError('timeout'));
    await start(payment, 'alpha');
    const [created] = (await repos.payments.findById(payment.id))!.attempts;
    expect(created?.status).toBe('CREATED');

    const second = await start(payment, 'beta');

    const stored = await repos.payments.findById(payment.id);
    const byId = new Map(stored?.attempts.map((a) => [a.id, a.status]));
    expect(byId.get(created!.id)).toBe('CANCELLED');
    expect(byId.get(second.attempt.id)).toBe('PENDING');
  });

  it('commits the cancel and the new attempt together, before either gateway is called', async () => {
    const payment = await createPayment();
    const first = await start(payment, 'alpha');
    let seen: { status: string }[] = [];
    beta.scriptInitiate(async (input) => {
      seen = await prisma.paymentTransaction.findMany({
        where: { paymentId: payment.id },
        orderBy: { id: 'asc' },
        select: { id: true, status: true },
      });
      return {
        nextAction: {
          type: 'REDIRECT',
          url: `https://pay.test/${input.attemptKey}`,
        },
        providerMetadata: {},
        rawPayload: {},
      };
    });

    const second = await start(payment, 'beta');

    expect(seen).toEqual([
      { id: first.attempt.id, status: 'CANCELLED' },
      { id: second.attempt.id, status: 'CREATED' },
    ]);
  });

  it('records the transitions of both attempts', async () => {
    const payment = await createPayment();
    const first = await start(payment, 'alpha');

    const second = await start(payment, 'beta');

    expect(await trail(first.attempt.id)).toEqual([
      {
        from: null,
        to: 'CREATED',
        trigger: 'start_attempt',
        actor: 'customer',
      },
      {
        from: 'CREATED',
        to: 'PENDING',
        trigger: 'gateway_accepted',
        actor: 'system',
      },
      {
        from: 'PENDING',
        to: 'CANCELLED',
        trigger: 'gateway_switch',
        actor: 'customer',
      },
    ]);
    expect(await trail(second.attempt.id)).toEqual([
      {
        from: null,
        to: 'CREATED',
        trigger: 'start_attempt',
        actor: 'customer',
      },
      {
        from: 'CREATED',
        to: 'PENDING',
        trigger: 'gateway_accepted',
        actor: 'system',
      },
    ]);
  });

  it('switches to the same gateway too', async () => {
    const payment = await createPayment();
    const first = await start(payment, 'alpha');

    const second = await start(payment, 'alpha');

    const stored = await repos.payments.findById(payment.id);
    const byId = new Map(stored?.attempts.map((a) => [a.id, a.status]));
    expect(byId.get(first.attempt.id)).toBe('CANCELLED');
    expect(byId.get(second.attempt.id)).toBe('PENDING');
  });

  it('keeps the old attempt provider data, so a late success can still be matched (ticket 21)', async () => {
    const payment = await createPayment();
    alpha.scriptInitiate({
      providerRef: 'alpha-ref',
      nextAction: { type: 'REDIRECT', url: 'https://alpha.test/pay' },
      providerMetadata: { session: 'a-1' },
      rawPayload: {},
    });
    const first = await start(payment, 'alpha');

    await start(payment, 'beta');

    const old = (await repos.payments.findById(payment.id))!.attempts.find(
      (a) => a.id === first.attempt.id,
    );
    expect(old).toMatchObject({
      status: 'CANCELLED',
      providerRef: 'alpha-ref',
      providerMetadata: { session: 'a-1' },
    });
    expect(canTransitionAttempt('CANCELLED', 'SUCCEEDED')).toBe(true);
    expect(canTransitionAttempt('CANCELLED', 'REQUIRES_REVIEW')).toBe(true);
  });
});

describe('Gateway switch: the provider cancel', () => {
  it('asks the old provider to cancel after commit, with the attempt key and metadata', async () => {
    const payment = await createPayment();
    alpha.scriptInitiate({
      nextAction: { type: 'REDIRECT', url: 'https://alpha.test/pay' },
      providerMetadata: { session: 'a-1' },
      rawPayload: {},
    });
    const first = await start(payment, 'alpha');
    let statusAtCancel: string | undefined;
    alpha.scriptCancel(async (input: CancelInput) => {
      const row = await prisma.paymentTransaction.findUnique({
        where: { id: input.attemptKey },
      });
      statusAtCancel = row?.status;
      return { rawPayload: { cancelled: true } };
    });

    await start(payment, 'beta');

    expect(alpha.calls.cancel).toEqual([
      { attemptKey: first.attempt.id, providerMetadata: { session: 'a-1' } },
    ]);
    expect(statusAtCancel).toBe('CANCELLED');
    const raw = await repos.gatewayRawResponses.listForAttempt(
      first.attempt.id,
    );
    expect(raw.map((r) => [r.operation, r.payload])).toEqual([
      ['initiate', {}],
      ['cancel', { cancelled: true }],
    ]);
  });

  it('keeps the local cancel when the provider cancel fails', async () => {
    const payment = await createPayment();
    const first = await start(payment, 'alpha');
    alpha.scriptCancel(new GatewayUnavailableError('cancel down'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const second = await start(payment, 'beta');

    expect(second.attempt.status).toBe('PENDING');
    const stored = await repos.payments.findById(payment.id);
    const byId = new Map(stored?.attempts.map((a) => [a.id, a.status]));
    expect(byId.get(first.attempt.id)).toBe('CANCELLED');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(first.attempt.id),
    );
  });

  it('skips the provider cancel and logs a defensive error when the plugin does not support cancel', async () => {
    const payment = await createPayment();
    const first = await start(payment, 'beta');
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    await start(payment, 'alpha');

    expect(alpha.calls.cancel).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`supportsCancel.*${first.attempt.id}`)),
    );
    const stored = await repos.payments.findById(payment.id);
    expect(
      stored?.attempts.find((a) => a.id === first.attempt.id)?.status,
    ).toBe('CANCELLED');
  });

  it('does not call cancel when there was no open attempt', async () => {
    const payment = await createPayment();
    alpha.scriptInitiate(new GatewayRejectedError('no'));
    await start(payment, 'alpha');

    await start(payment, 'alpha');

    expect(alpha.calls.cancel).toEqual([]);
  });
});
