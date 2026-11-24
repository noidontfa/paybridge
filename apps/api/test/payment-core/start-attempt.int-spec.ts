import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { FakeGatewayPlugin } from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import {
  AttemptInReviewError,
  OpenAttemptExistsError,
  PaymentExpiryPassedError,
  PaymentNotFoundError,
  PaymentNotPendingError,
  UnknownGatewayIdError,
} from '../../src/payment-core/domain/errors.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Payment } from '../../src/payment-core/domain/payment.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  GatewayRejectedError,
  GatewayUnavailableError,
  type InitiateInput,
} from '../../src/payment-core/port/index.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// startAttempt through PaymentService against the migrated test database,
// with the fake Gateway Plugin standing in for the provider.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const RETURN_URL = 'https://shop.example/return';
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;
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

function createPayment(overrides: Record<string, unknown> = {}) {
  return service.createPayment({
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
    ...overrides,
  });
}

function start(payment: Payment, overrides: Record<string, unknown> = {}) {
  return service.startAttempt({
    paymentId: payment.id,
    gatewayId: fake.gatewayId,
    returnUrl: RETURN_URL,
    ...overrides,
  });
}

/**
 * Runs `check` from inside the fake gateway's `initiate`, then answers with
 * the default accepted result.
 */
function duringInitiate(check: (input: InitiateInput) => Promise<void>) {
  fake.scriptInitiate(async (input) => {
    await check(input);
    return {
      nextAction: {
        type: 'REDIRECT',
        url: `https://pay.test/${input.attemptKey}`,
      },
      providerMetadata: { session: 's-1' },
      rawPayload: { ok: true },
    };
  });
}

describe('PaymentService.startAttempt: before the gateway call', () => {
  it('stores the attempt as CREATED with its attempt key before the gateway is called', async () => {
    const payment = await createPayment();
    let seen: { id: string; status: string; gatewayId: string } | null = null;
    duringInitiate(async (input) => {
      seen = await prisma.paymentTransaction.findUnique({
        where: { id: input.attemptKey },
        select: { id: true, status: true, gatewayId: true },
      });
    });

    const { attempt } = await start(payment);

    expect(seen).toEqual({
      id: attempt.id,
      status: 'CREATED',
      gatewayId: 'fake',
    });
    // UUID v7: version nibble 7.
    expect(attempt.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('PaymentService.startAttempt: the gateway call', () => {
  it('holds no database transaction or lock while the gateway is called', async () => {
    const payment = await createPayment();
    let lockedFromOutside: unknown[] = [];
    duringInitiate(async (input) => {
      // Fails at once (55P03) if any transaction still holds either row.
      lockedFromOutside = [
        ...(await prisma.$queryRaw<unknown[]>`
          SELECT id FROM core_payments WHERE id = ${payment.id}::uuid FOR UPDATE NOWAIT`),
        ...(await prisma.$queryRaw<unknown[]>`
          SELECT id FROM core_payment_transactions WHERE id = ${input.attemptKey}::uuid FOR UPDATE NOWAIT`),
      ];
    });

    await start(payment);

    expect(lockedFromOutside).toHaveLength(2);
  });

  it('sends the attempt key, whole-dong amount, currency, expiry, return URL and description', async () => {
    const expiresAt = new Date('2026-05-01T12:00:00.000Z');
    const payment = await createPayment({
      amount: '150000.00',
      upstreamReference: 'order-42',
      expiresAt,
    });

    const { attempt } = await start(payment, { description: 'Order 42' });

    expect(fake.calls.initiate).toEqual([
      {
        attemptKey: attempt.id,
        amount: '150000',
        currency: 'VND',
        expiresAt,
        returnUrl: RETURN_URL,
        description: 'Order 42',
      },
    ]);
  });

  it('defaults the description to the upstream reference', async () => {
    const payment = await createPayment({ upstreamReference: 'order-43' });

    await start(payment);

    expect(fake.calls.initiate[0]?.description).toBe('Payment order-43');
  });
});

describe('PaymentService.startAttempt: gateway accepts', () => {
  it('moves the attempt to PENDING with provider reference, next action, metadata and raw response', async () => {
    const payment = await createPayment();
    fake.scriptInitiate((input) => ({
      providerRef: 'prov-123',
      nextAction: { type: 'QR_CODE', payload: `qr:${input.attemptKey}` },
      providerMetadata: { session: 'abc' },
      rawPayload: { provider: 'says', code: '00' },
    }));

    const result = await start(payment);

    const expected = {
      id: result.attempt.id,
      paymentId: payment.id,
      gatewayId: 'fake',
      status: 'PENDING',
      providerRef: 'prov-123',
      nextAction: { type: 'QR_CODE', payload: `qr:${result.attempt.id}` },
      providerMetadata: { session: 'abc' },
    };
    expect(result.attempt).toMatchObject(expected);
    expect(result.payment.status).toBe('PENDING');
    expect(result.payment.attempts).toEqual([result.attempt]);
    const stored = await repos.payments.findById(payment.id);
    expect(stored?.attempts).toEqual([expect.objectContaining(expected)]);
    expect(
      await repos.gatewayRawResponses.listForAttempt(result.attempt.id),
    ).toEqual([
      expect.objectContaining({
        operation: 'initiate',
        payload: { provider: 'says', code: '00' },
      }),
    ]);
    expect(
      (
        await repos.statusTransitions.listForEntity(
          'PAYMENT_TRANSACTION',
          result.attempt.id,
        )
      ).map((t) => [t.fromStatus, t.toStatus, t.trigger]),
    ).toEqual([
      [null, 'CREATED', 'start_attempt'],
      ['CREATED', 'PENDING', 'gateway_accepted'],
    ]);
  });

  it('leaves the provider reference empty when the gateway gives none', async () => {
    const payment = await createPayment();

    const { attempt } = await start(payment);

    expect(attempt.status).toBe('PENDING');
    expect(attempt.providerRef).toBeNull();
    expect(attempt.nextAction).toEqual({
      type: 'REDIRECT',
      url: `https://fake-gateway.test/pay/${attempt.id}`,
    });
  });
});

describe('PaymentService.startAttempt: gateway rejects', () => {
  it('moves the attempt to FAILED, keeps the Payment PENDING, and allows another attempt', async () => {
    const payment = await createPayment();
    fake.scriptInitiate(new GatewayRejectedError('card scheme said no'));

    const rejected = await start(payment);

    expect(rejected.attempt.status).toBe('FAILED');
    expect(rejected.attempt.nextAction).toBeNull();
    expect(rejected.payment.status).toBe('PENDING');
    expect(
      (
        await repos.statusTransitions.listForEntity(
          'PAYMENT_TRANSACTION',
          rejected.attempt.id,
        )
      ).map((t) => [t.fromStatus, t.toStatus, t.trigger, t.reason]),
    ).toEqual([
      [null, 'CREATED', 'start_attempt', null],
      ['CREATED', 'FAILED', 'gateway_rejected', 'card scheme said no'],
    ]);

    const retry = await start(payment);

    expect(retry.attempt.status).toBe('PENDING');
    expect(retry.payment.attempts.map((a) => a.status)).toEqual([
      'FAILED',
      'PENDING',
    ]);
  });
});

describe('PaymentService.startAttempt: rejected before the gateway call', () => {
  it.each(['SUCCEEDED', 'CANCELLED', 'EXPIRED'] as const)(
    'rejects a %s Payment',
    async (status) => {
      const payment = await createPayment();
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status },
      });

      await expect(start(payment)).rejects.toBeInstanceOf(
        PaymentNotPendingError,
      );
      expect(fake.calls.initiate).toEqual([]);
      expect(await prisma.paymentTransaction.count()).toBe(0);
    },
  );

  it('rejects a Payment whose expiry has passed', async () => {
    const payment = await createPayment();
    clock.set(new Date(payment.expiresAt.getTime() + 1));

    await expect(start(payment)).rejects.toBeInstanceOf(
      PaymentExpiryPassedError,
    );
    expect(fake.calls.initiate).toEqual([]);
  });

  it('rejects an unknown Payment', async () => {
    await expect(
      service.startAttempt({
        paymentId: newId(),
        gatewayId: 'fake',
        returnUrl: RETURN_URL,
      }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('rejects a gateway with no registered plugin', async () => {
    const payment = await createPayment();

    await expect(
      start(payment, { gatewayId: 'no-such-gateway' }),
    ).rejects.toBeInstanceOf(UnknownGatewayIdError);
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it.each(['CREATED', 'PENDING'] as const)(
    'rejects a new attempt while another is %s (until the gateway switch)',
    async (status) => {
      const payment = await createPayment();
      const first = await start(payment);
      await prisma.paymentTransaction.update({
        where: { id: first.attempt.id },
        data: { status },
      });

      await expect(start(payment)).rejects.toBeInstanceOf(
        OpenAttemptExistsError,
      );
      expect(fake.calls.initiate).toHaveLength(1);
      expect(await prisma.paymentTransaction.count()).toBe(1);
    },
  );

  it('rejects a new attempt while an attempt is in review', async () => {
    const payment = await createPayment();
    const first = await start(payment);
    await prisma.paymentTransaction.update({
      where: { id: first.attempt.id },
      data: { status: 'REQUIRES_REVIEW', reviewReason: 'AMOUNT_MISMATCH' },
    });

    await expect(start(payment)).rejects.toBeInstanceOf(AttemptInReviewError);
  });
});

describe('PaymentService.startAttempt: state changed during the gateway call', () => {
  it('does not change a Payment cancelled during the call, nor its cancelled attempt', async () => {
    const payment = await createPayment();
    fake.scriptInitiate(async (input) => {
      // What a merchant cancel (ticket 17) commits meanwhile.
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELLED' },
      });
      await prisma.paymentTransaction.update({
        where: { id: input.attemptKey },
        data: { status: 'CANCELLED' },
      });
      return {
        providerRef: 'prov-late',
        nextAction: { type: 'REDIRECT', url: 'https://pay.test/late' },
        providerMetadata: { session: 'late' },
        rawPayload: { late: true },
      };
    });

    const result = await start(payment);

    expect(result.payment.status).toBe('CANCELLED');
    expect(result.attempt).toMatchObject({
      status: 'CANCELLED',
      nextAction: null,
      // Kept for a later query or cancel at the provider.
      providerRef: 'prov-late',
      providerMetadata: { session: 'late' },
    });
    expect(
      await repos.gatewayRawResponses.listForAttempt(result.attempt.id),
    ).toHaveLength(1);
    const trail = await repos.statusTransitions.listForEntity(
      'PAYMENT_TRANSACTION',
      result.attempt.id,
    );
    expect(trail.map((t) => t.toStatus)).toEqual(['CREATED']);
  });

  it('does not change a Payment that expired during the call', async () => {
    const payment = await createPayment();
    fake.scriptInitiate(async () => {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'EXPIRED' },
      });
      return {
        nextAction: { type: 'REDIRECT', url: 'https://pay.test/x' },
        providerMetadata: {},
        rawPayload: {},
      };
    });

    const result = await start(payment);

    expect(result.payment.status).toBe('EXPIRED');
    expect(result.attempt.status).toBe('CREATED');
    expect(result.attempt.nextAction).toBeNull();
  });

  it('does not fail an attempt rejected after the Payment was cancelled', async () => {
    const payment = await createPayment();
    fake.scriptInitiate(async () => {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELLED' },
      });
      throw new GatewayRejectedError('too late');
    });

    const result = await start(payment);

    expect(result.payment.status).toBe('CANCELLED');
    expect(result.attempt.status).toBe('CREATED');
  });
});

describe('PaymentService.startAttempt: other gateway errors (ticket 22)', () => {
  it('leaves the attempt CREATED and passes the error on', async () => {
    const payment = await createPayment();
    const outage = new GatewayUnavailableError('provider down');
    fake.scriptInitiate(outage);

    await expect(start(payment)).rejects.toBe(outage);
    const stored = await repos.payments.findById(payment.id);
    expect(stored?.attempts.map((a) => a.status)).toEqual(['CREATED']);
  });
});
