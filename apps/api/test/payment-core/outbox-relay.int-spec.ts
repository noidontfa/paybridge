import { createServer, Socket, type Server } from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import {
  Clock,
  FakeClock,
} from '../../src/payment-core/domain/services/clock.js';
import type { OutboxEventType } from '../../src/payment-core/domain/records.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager.module.js';
import { TransactionRunner } from '../../src/payment-core/domain/repositories/transaction-runner.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import {
  DEFAULT_OUTBOX_RELAY_OPTIONS,
  OUTBOX_JOB_OPTIONS,
  OutboxRelay,
  type OutboxJobData,
  type OutboxRelayOptions,
} from '../../src/payment-core/infrastructure/queue/outbox-relay.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { defaultScope } from '../setup/organizations.js';

// The outbox relay against the migrated test database and the compose Redis.
// "Redis unavailable" is simulated with a TCP proxy in front of Redis that the
// test can cut and restore, so the same Queue sees the outage and the return.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;
let runner: TransactionRunner;
let relay: OutboxRelay;
let queue: Queue;

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
  relay = moduleRef.get(OutboxRelay);
  queue = moduleRef.get<Queue>(getQueueToken(QUEUES.outbox));
});

afterAll(async () => {
  await queue.obliterate({ force: true });
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(prisma);
  await queue.obliterate({ force: true });
});

async function createPayment(): Promise<string> {
  const { payment } = await service.createPayment(defaultScope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${crypto.randomUUID()}`,
  });
  return payment.id;
}

/** A relay with other options or another queue connection. */
function relayWith(
  options: Partial<OutboxRelayOptions>,
  onQueue: Queue = queue,
): OutboxRelay {
  return new OutboxRelay(runner, onQueue, clock, {
    ...DEFAULT_OUTBOX_RELAY_OPTIONS,
    enabled: false,
    ...options,
  });
}

async function outboxRows() {
  return prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
}

describe('OutboxRelay.publishPending', () => {
  it('adds each unpublished row to the outbox queue with its row id as job id, then sets the published time', async () => {
    const paymentId = await createPayment();
    const [row] = await outboxRows();
    clock.set(new Date('2026-05-01T10:00:05.000Z'));

    const result = await relay.publishPending();

    expect(result).toEqual({ published: 1, failed: false });
    const job = await queue.getJob(row!.id);
    expect(job?.name).toBe('PaymentCreated');
    expect(job?.data).toEqual<OutboxJobData>({
      outboxEventId: row!.id,
      organizationId: row!.organizationId,
      eventType: 'PaymentCreated',
      paymentId,
      payload: row!.payload,
      createdAt: row!.createdAt.toISOString(),
    });
    expect(job?.opts).toMatchObject(OUTBOX_JOB_OPTIONS);
    const [after] = await outboxRows();
    expect(after!.publishedAt).toEqual(new Date('2026-05-01T10:00:05.000Z'));
  });

  it('does not publish a row twice and does not delete published rows', async () => {
    await createPayment();
    await relay.publishPending();

    const second = await relay.publishPending();

    expect(second).toEqual({ published: 0, failed: false });
    expect(await prisma.outboxEvent.count()).toBe(1);
    expect(await queue.getJobCountByTypes('waiting', 'delayed', 'active')).toBe(
      1,
    );
  });

  it('sends every Payment-level event type through the same path', async () => {
    const paymentId = await createPayment();
    const others: OutboxEventType[] = [
      'PaymentSucceeded',
      'PaymentCancelled',
      'PaymentExpired',
      'PaymentRequiresReview',
    ];
    for (const eventType of others) {
      await runner.repositories.outbox.add(defaultScope, {
        eventType,
        paymentId,
        payload: { eventType },
      });
    }

    const result = await relay.publishPending();

    expect(result.published).toBe(5);
    const rows = await outboxRows();
    for (const row of rows) {
      expect(row.publishedAt).not.toBeNull();
      expect((await queue.getJob(row.id))?.name).toBe(row.eventType);
    }
  });

  it('publishes more rows than one batch in a single call', async () => {
    const paymentId = await createPayment();
    const small = relayWith({ batchSize: 2 });
    for (let i = 0; i < 4; i += 1) {
      await runner.repositories.outbox.add(defaultScope, {
        eventType: 'PaymentSucceeded',
        paymentId,
        payload: { i },
      });
    }

    const result = await small.publishPending();

    expect(result).toEqual({ published: 5, failed: false });
    expect(
      await prisma.outboxEvent.count({ where: { publishedAt: null } }),
    ).toBe(0);
  });

  it('re-enqueues a row that was enqueued but not marked published, without a duplicate job', async () => {
    await createPayment();
    const [row] = await outboxRows();
    // The process stopped after the add and before the published time was set.
    await queue.add(
      'PaymentCreated',
      { replay: false },
      {
        ...OUTBOX_JOB_OPTIONS,
        jobId: row!.id,
      },
    );

    const result = await relay.publishPending();

    expect(result).toEqual({ published: 1, failed: false });
    expect(await queue.getJobCountByTypes('waiting', 'delayed', 'active')).toBe(
      1,
    );
    expect((await queue.getJob(row!.id))?.data).toEqual({ replay: false });
    expect((await outboxRows())[0]!.publishedAt).not.toBeNull();
  });

  it('keeps rows unpublished while Redis is unavailable and publishes them when Redis returns', async () => {
    const proxy = await startRedisProxy();
    const flaky = new Queue(QUEUES.outbox, {
      connection: {
        host: '127.0.0.1',
        port: proxy.port,
        maxRetriesPerRequest: null,
        retryStrategy: () => 50,
      },
      prefix: process.env.QUEUE_PREFIX,
    });
    try {
      await flaky.waitUntilReady();
      const offlineRelay = relayWith({ addTimeoutMs: 300 }, flaky);
      await createPayment();

      await proxy.cut();
      const during = await offlineRelay.publishPending();

      expect(during).toEqual({ published: 0, failed: true });
      expect(
        await prisma.outboxEvent.count({ where: { publishedAt: null } }),
      ).toBe(1);

      await proxy.restore();
      await expect
        .poll(async () => (await offlineRelay.publishPending()).failed, {
          timeout: 5_000,
          interval: 100,
        })
        .toBe(false);

      const [row] = await outboxRows();
      expect(row!.publishedAt).not.toBeNull();
      expect((await queue.getJob(row!.id))?.name).toBe('PaymentCreated');
    } finally {
      await flaky.close();
      await proxy.close();
    }
  });
});

describe('OutboxRelay polling', () => {
  it('publishes new rows on its own once started', async () => {
    const polling = relayWith({ pollIntervalMs: 50 });
    await createPayment();

    polling.start();
    try {
      await expect
        .poll(
          () => prisma.outboxEvent.count({ where: { publishedAt: null } }),
          { timeout: 3_000, interval: 50 },
        )
        .toBe(0);
    } finally {
      await polling.stop();
    }
  });
});

/** A TCP proxy to the compose Redis that can be cut (outage) and restored. */
async function startRedisProxy() {
  const target = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  let port = 0;

  const listen = () =>
    new Promise<void>((resolve) => {
      server = createServer((client) => {
        const upstream = new Socket();
        upstream.connect(Number(target.port || 6379), target.hostname);
        for (const s of [client, upstream]) {
          sockets.add(s);
          s.on('close', () => sockets.delete(s));
          s.on('error', () => s.destroy());
        }
        client.pipe(upstream).pipe(client);
      });
      server.listen(port, '127.0.0.1', () => {
        const address = server!.address();
        if (address && typeof address === 'object') port = address.port;
        resolve();
      });
    });

  const cut = async () => {
    const closed = new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    for (const s of sockets) s.destroy();
    await closed;
    server = undefined;
  };

  await listen();
  return {
    get port() {
      return port;
    },
    cut,
    restore: listen,
    close: cut,
  };
}
