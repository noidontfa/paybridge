import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import {
  InvalidAmountError,
  InvalidExpiryError,
  InvalidUpstreamReferenceError,
  UnsupportedCurrencyError,
} from '../../src/payment-core/domain/errors.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import type { Repositories } from '../../src/payment-core/infrastructure/prisma/repositories.js';
import {
  PrismaTransactionRunner,
  TransactionRunner,
} from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// createPayment through PaymentService against the migrated test database.

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
let repos: Repositories;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: coreImports,
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

async function storedRowCounts() {
  return {
    payments: await prisma.payment.count(),
    outbox: await prisma.outboxEvent.count(),
    attempts: await prisma.paymentTransaction.count(),
  };
}

describe('PaymentService.createPayment', () => {
  it('creates a PENDING Payment with the requested expiry', async () => {
    const expiresAt = new Date('2026-05-01T12:00:00.000Z');
    const input = request({ expiresAt });

    const { payment: created } = await service.createPayment(input);

    expect(created).toMatchObject({
      status: 'PENDING',
      amount: '150000',
      currency: 'VND',
      merchantOrderId: input.upstreamReference,
      expiresAt,
      attempts: [],
    });
    expect(await repos.payments.findById(created.id)).toMatchObject({
      status: 'PENDING',
      amount: '150000',
      expiresAt,
      attempts: [],
    });
  });

  it('defaults the expiry to 30 minutes after creation', async () => {
    const { payment: created } = await service.createPayment(request());

    expect(created.expiresAt).toEqual(new Date('2026-05-01T10:30:00.000Z'));
  });

  it('writes one PaymentCreated outbox event and no attempt', async () => {
    const { payment: created } = await service.createPayment(request());

    const events = await repos.outbox.listForPayment(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'PaymentCreated',
      paymentId: created.id,
      publishedAt: null,
      payload: {
        paymentId: created.id,
        upstreamReference: created.merchantOrderId,
        amount: '150000',
        currency: 'VND',
        status: 'PENDING',
        expiresAt: '2026-05-01T10:30:00.000Z',
      },
    });
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it('records the creation in the status trail', async () => {
    const { payment: created } = await service.createPayment(request());

    expect(
      await repos.statusTransitions.listForEntity('PAYMENT', created.id),
    ).toMatchObject([
      { fromStatus: null, toStatus: 'PENDING', actor: 'merchant' },
    ]);
  });

  it('rejects a duplicate upstream reference and stores nothing for it', async () => {
    const input = request();
    await service.createPayment(input);

    await expect(
      service.createPayment({ ...input, amount: '99000' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_REFERENCE_EXISTS' });

    expect(await storedRowCounts()).toEqual({
      payments: 1,
      outbox: 1,
      attempts: 0,
    });
  });

  it.each([
    ['zero amount', { amount: '0' }, InvalidAmountError],
    ['negative amount', { amount: '-1' }, InvalidAmountError],
    ['fractional dong', { amount: '1000.5' }, InvalidAmountError],
    ['another currency', { currency: 'USD' }, UnsupportedCurrencyError],
    [
      'empty upstream reference',
      { upstreamReference: '' },
      InvalidUpstreamReferenceError,
    ],
    [
      'blank upstream reference',
      { upstreamReference: '   ' },
      InvalidUpstreamReferenceError,
    ],
    [
      'expiry under 30 minutes',
      { expiresAt: new Date('2026-05-01T10:29:00.000Z') },
      InvalidExpiryError,
    ],
    [
      'expiry over 24 hours',
      { expiresAt: new Date('2026-05-02T10:01:00.000Z') },
      InvalidExpiryError,
    ],
  ])('rejects a %s and stores nothing', async (_label, overrides, error) => {
    await expect(service.createPayment(request(overrides))).rejects.toThrow(
      error,
    );
    expect(await storedRowCounts()).toEqual({
      payments: 0,
      outbox: 0,
      attempts: 0,
    });
  });
});

describe('createPayment atomicity', () => {
  /** A real runner whose outbox write fails inside the transaction. */
  class FailingOutboxRunner extends TransactionRunner {
    private readonly real = new PrismaTransactionRunner(prisma);
    readonly repositories = this.real.repositories;

    run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
      return this.real.run((txRepos) =>
        work({
          ...txRepos,
          outbox: {
            ...txRepos.outbox,
            add: () => Promise.reject(new Error('outbox down')),
          },
        }),
      );
    }
  }

  it('stores neither the Payment nor the event when the outbox write fails', async () => {
    const failing = await Test.createTestingModule({
      imports: coreImports,
    })
      .overrideProvider(TransactionRunner)
      .useValue(new FailingOutboxRunner())
      .compile();
    await failing.init();

    try {
      await expect(
        failing.get(PaymentService).createPayment(request()),
      ).rejects.toThrow('outbox down');
      expect(await storedRowCounts()).toEqual({
        payments: 0,
        outbox: 0,
        attempts: 0,
      });
    } finally {
      await failing.close();
    }
  });
});
