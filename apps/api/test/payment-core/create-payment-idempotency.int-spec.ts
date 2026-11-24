import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import {
  IdempotencyKeyReusedError,
  UpstreamReferenceExistsError,
} from '../../src/payment-core/domain/errors.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Idempotency-Key on createPayment (ticket 13), against the test database.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const coreImports = [
  AppConfigModule,
  PrismaModule,
  GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
  PaymentCoreModule,
];
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: coreImports })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  await moduleRef.init();
  service = moduleRef.get(PaymentService);
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
    ...overrides,
  };
}

async function counts() {
  return {
    payments: await prisma.payment.count(),
    outbox: await prisma.outboxEvent.count(),
    keys: await prisma.idempotencyKey.count(),
  };
}

describe('createPayment with an Idempotency-Key', () => {
  it('returns the stored response for the same key and body, creating one Payment', async () => {
    const input = request();
    const key = `key-${newId()}`;

    const first = await service.createPayment(input, { idempotencyKey: key });
    const second = await service.createPayment(input, { idempotencyKey: key });

    expect(first).toMatchObject({ status: 201, replayed: false });
    expect(second).toMatchObject({ status: 201, replayed: true });
    expect(second.body).toEqual(first.body);
    expect(second.payment.id).toBe(first.payment.id);
    expect(await counts()).toEqual({ payments: 1, outbox: 1, keys: 1 });
  });

  it('replays the original response even after the Payment changed', async () => {
    const input = request();
    const first = await service.createPayment(input, { idempotencyKey: 'k1' });
    await prisma.payment.update({
      where: { id: first.payment.id },
      data: { status: 'CANCELLED' },
    });

    const second = await service.createPayment(input, { idempotencyKey: 'k1' });

    expect(second.body).toEqual(first.body);
    expect(second.body).toMatchObject({ status: 'PENDING' });
  });

  it('rejects the same key with a different body (422) and stores nothing new', async () => {
    const input = request();
    await service.createPayment(input, { idempotencyKey: 'k1' });

    await expect(
      service.createPayment(
        { ...input, amount: '99000' },
        { idempotencyKey: 'k1' },
      ),
    ).rejects.toThrow(IdempotencyKeyReusedError);
    await expect(
      service.createPayment(request(), { idempotencyKey: 'k1' }),
    ).rejects.toThrow(IdempotencyKeyReusedError);

    expect(await counts()).toEqual({ payments: 1, outbox: 1, keys: 1 });
  });

  it('rejects a new key whose upstream reference exists (409) with the existing Payment id', async () => {
    const input = request();
    const first = await service.createPayment(input, { idempotencyKey: 'k1' });

    const error = await service
      .createPayment(input, { idempotencyKey: 'k2' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpstreamReferenceExistsError);
    expect(error).toMatchObject({
      code: 'UPSTREAM_REFERENCE_EXISTS',
      paymentId: first.payment.id,
    });
    expect(await counts()).toEqual({ payments: 1, outbox: 1, keys: 1 });
  });

  it('stores hash, response, Payment id, creation and 24-hour expiry', async () => {
    const result = await service.createPayment(request(), {
      idempotencyKey: 'k1',
    });

    const record = await prisma.idempotencyKey.findUniqueOrThrow({
      where: { key: 'k1' },
    });
    expect(record).toEqual({
      key: 'k1',
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      responseStatus: 201,
      responseBody: result.body,
      paymentId: result.payment.id,
      createdAt: NOW,
      expiresAt: new Date('2026-05-02T10:00:00.000Z'),
    });
  });

  it('treats an expired record as absent: the key may be reused', async () => {
    await service.createPayment(request(), { idempotencyKey: 'k1' });
    clock.set(new Date('2026-05-02T10:00:00.001Z'));

    const reused = await service.createPayment(request(), {
      idempotencyKey: 'k1',
    });

    expect(reused.replayed).toBe(false);
    expect(await counts()).toEqual({ payments: 2, outbox: 2, keys: 1 });
  });

  it('creates exactly one Payment for concurrent requests with the same key', async () => {
    const input = request();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.createPayment(input, { idempotencyKey: 'k1' }),
      ),
    );

    const ids = new Set(results.map((r) => r.payment.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    for (const r of results) expect(r.body).toEqual(results[0]!.body);
    expect(await counts()).toEqual({ payments: 1, outbox: 1, keys: 1 });
  });

  it('accepts a request without a key as an ordinary create, storing no record', async () => {
    const result = await service.createPayment(request());

    expect(result).toMatchObject({ status: 201, replayed: false });
    expect(await counts()).toEqual({ payments: 1, outbox: 1, keys: 0 });
  });

  it('rejects a duplicate upstream reference without a key (409) with the existing id', async () => {
    const input = request();
    const first = await service.createPayment(input);

    await expect(service.createPayment(input)).rejects.toMatchObject({
      code: 'UPSTREAM_REFERENCE_EXISTS',
      paymentId: first.payment.id,
    });
  });
});

describe('createPayment idempotency atomicity', () => {
  /** A real runner whose idempotency write fails inside the transaction. */
  class FailingKeyRunner extends TransactionRunner {
    private readonly real = new PrismaTransactionRunner(prisma);
    readonly repositories = this.real.repositories;

    run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
      return this.real.run((txRepos) =>
        work({
          ...txRepos,
          idempotencyKeys: {
            find: (key) => txRepos.idempotencyKeys.find(key),
            deleteIfExpired: (key, now) =>
              txRepos.idempotencyKeys.deleteIfExpired(key, now),
            create: () => Promise.reject(new Error('key store down')),
          },
        }),
      );
    }
  }

  it('stores neither Payment nor outbox row when the idempotency write fails', async () => {
    const failing = await Test.createTestingModule({ imports: coreImports })
      .overrideProvider(TransactionRunner)
      .useValue(new FailingKeyRunner())
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await failing.init();

    try {
      await expect(
        failing
          .get(PaymentService)
          .createPayment(request(), { idempotencyKey: 'k1' }),
      ).rejects.toThrow('key store down');
      expect(await counts()).toEqual({ payments: 0, outbox: 0, keys: 0 });
    } finally {
      await failing.close();
    }
  });
});
