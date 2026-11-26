import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  createServer as createNetServer,
  Socket,
  type AddressInfo,
  type Server as NetServer,
} from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { FakeClock } from '../../src/payment-core/domain/services/clock.js';
import { OutboxRelay } from '../../src/payment-core/infrastructure/queue/outbox-relay.js';
import { WebhookDeliverySweep } from '../../src/webhooks/application/sweeps/webhook-delivery-sweep.js';
import { WebhookRetention } from '../../src/webhooks/application/sweeps/webhook-retention.js';
import { DeliverWebhook } from '../../src/webhooks/application/workers/deliver-webhook.js';
import { WebhooksTransactionRunner } from '../../src/webhooks/domain/repositories/transaction-runner.js';
import {
  RetryJitter,
  SecretCipher,
  WebhooksClock,
  WebhookSender,
} from '../../src/webhooks/domain/services/ports.js';
import {
  WEBHOOK_DELIVERY_OPTIONS,
  type WebhookDeliveryOptions,
} from '../../src/webhooks/infrastructure/config/delivery-options.js';
import {
  BullDeliveryDispatcher,
  WEBHOOK_QUEUES,
} from '../../src/webhooks/infrastructure/queue/webhook-queues.js';
import { bearer, createApiKey } from '../setup/api-keys.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp } from '../setup/users.js';

// Ticket 02: retries of a Webhook delivery. A local receiver stands in for the
// Organization's system and `FakeClock` moves the webhooks module's time; the
// delivery sweep (run by hand here, every minute in the app) hands due
// retries to the worker, as BullMQ's own delayed jobs wait in real time.

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = new Date();
const clock = new FakeClock(START);
const prisma = createTestPrismaClient();
let moduleRef: TestingModule;
let app: INestApplication;
let deliveryQueue: Queue;
const options: {
  -readonly [K in keyof WebhookDeliveryOptions]: WebhookDeliveryOptions[K];
} = { protection: false, timeoutMs: 10_000, responseBodyLimit: 1024 };

interface Received {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let receiver: Server;
let receiverUrl: string;
let received: Received[] = [];
/** How the receiver answers its n-th request (0-based); default 200 "ok". */
let answer: (n: number, path: string, res: ServerResponse) => void;
const ok = (_n: number, _path: string, res: ServerResponse) => res.end('ok');
const status =
  (code: number) => (_n: number, _path: string, res: ServerResponse) => {
    res.statusCode = code;
    res.end(`status ${code}`);
  };

beforeAll(async () => {
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const n = received.length;
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      answer(n, req.url ?? '', res);
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WEBHOOK_DELIVERY_OPTIONS)
    .useValue(options)
    .overrideProvider(WebhooksClock)
    .useValue(clock)
    // No jitter, so every wait is exactly the documented schedule.
    .overrideProvider(RetryJitter)
    .useValue({ next: () => 0.5 })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
  deliveryQueue = moduleRef.get<Queue>(getQueueToken(WEBHOOK_QUEUES.delivery));
});
afterAll(async () => {
  await app.close();
  receiver.closeAllConnections();
  await new Promise((r) => receiver.close(r));
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await deliveryQueue.obliterate({ force: true });
  clock.set(START);
  received = [];
  answer = ok;
  options.timeoutMs = 10_000;
});

async function registerEndpoint(path: string): Promise<{ id: string }> {
  const http = await signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN' });
  const res = await http
    .post('/internal/webhook-endpoints')
    .send({ url: `${receiverUrl}${path}`, eventKinds: ['payment.created'] })
    .expect(201);
  return res.body as { id: string };
}

/** Creates a Payment and publishes its `payment.created` event. */
async function paymentEvent(): Promise<void> {
  const key = await createApiKey(prisma);
  await request(app.getHttpServer())
    .post('/api/payments')
    .set(bearer(key))
    .send({
      amount: '150000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    })
    .expect(201);
  await moduleRef.get(OutboxRelay).publishPending();
}

/** Waits until the only delivery has had `attempts` attempts, then reads it. */
async function deliveryAfter(attempts: number) {
  await expect
    .poll(
      async () =>
        (
          await prisma.webhookDelivery.findFirst({
            where: { lockedAt: null },
          })
        )?.attempts,
      { timeout: 10_000 },
    )
    .toBe(attempts);
  return prisma.webhookDelivery.findFirstOrThrow({
    include: { attemptRows: { orderBy: { attemptedAt: 'asc' } } },
  });
}

const sweep = () => moduleRef.get(WebhookDeliverySweep).run();

describe('retrying a delivery', () => {
  it('retries a 500 answer after the first backoff and stops once a 2xx arrives', async () => {
    await registerEndpoint('/hook');
    answer = (n, p, res) => (n === 0 ? status(500)(n, p, res) : ok(n, p, res));
    await paymentEvent();

    const failed = await deliveryAfter(1);
    expect(failed.status).toBe('PENDING');
    expect(failed.nextAttemptAt).toEqual(new Date(START.getTime() + MIN));
    expect(failed.attemptRows[0]).toMatchObject({
      succeeded: false,
      httpStatus: 500,
    });

    // Not due yet: the sweep leaves it alone.
    clock.advance(59_000);
    expect((await sweep()).dispatched).toBe(0);

    clock.advance(1_000);
    expect((await sweep()).dispatched).toBe(1);
    const delivered = await deliveryAfter(2);

    expect(delivered.status).toBe('SUCCEEDED');
    expect(delivered.nextAttemptAt).toBeNull();
    expect(delivered.attemptRows.map((a) => a.httpStatus)).toEqual([500, 200]);
    expect(received).toHaveLength(2);
    expect(JSON.parse(received[1]!.body).id).toBe(
      JSON.parse(received[0]!.body).id,
    );
    expect(received[1]!.headers['paybridge-signature']).toMatch(
      new RegExp(`^t=${Math.floor((START.getTime() + MIN) / 1000)},v1=`),
    );

    // A delivered event is never sent again.
    clock.advance(24 * HOUR);
    expect((await sweep()).dispatched).toBe(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(2);
  });

  it('retries an attempt that timed out', async () => {
    await registerEndpoint('/slow');
    options.timeoutMs = 300;
    answer = (n, p, res) => {
      if (n > 0) ok(n, p, res); // the first request is never answered
    };
    await paymentEvent();

    const timedOut = await deliveryAfter(1);
    expect(timedOut.status).toBe('PENDING');
    expect(timedOut.attemptRows[0]!.error).toMatch(/Timed out/);

    clock.advance(MIN);
    await sweep();
    const delivered = await deliveryAfter(2);

    expect(delivered.status).toBe('SUCCEEDED');
    expect(received).toHaveLength(2);
  });

  it('fails the delivery after the twelfth attempt and stops retrying', async () => {
    await registerEndpoint('/down');
    answer = status(503);
    await paymentEvent();
    await deliveryAfter(1);

    const waits: number[] = [];
    for (let attempt = 2; attempt <= 12; attempt += 1) {
      const before = await prisma.webhookDelivery.findFirstOrThrow();
      waits.push(before.nextAttemptAt!.getTime() - clock.now().getTime());
      clock.set(before.nextAttemptAt!);
      expect((await sweep()).dispatched).toBe(1);
      await deliveryAfter(attempt);
    }
    const failed = await prisma.webhookDelivery.findFirstOrThrow({
      include: { attemptRows: true },
    });

    expect(waits).toEqual([
      1 * MIN,
      3 * MIN,
      9 * MIN,
      27 * MIN,
      81 * MIN,
      243 * MIN,
      12 * HOUR,
      12 * HOUR,
      12 * HOUR,
      12 * HOUR,
      12 * HOUR,
    ]);
    expect(failed.status).toBe('FAILED');
    expect(failed.nextAttemptAt).toBeNull();
    expect(failed.attemptRows).toHaveLength(12);
    expect(received).toHaveLength(12);

    clock.advance(7 * 24 * HOUR);
    expect((await sweep()).dispatched).toBe(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(12);
  });

  it('lets only one instance send an attempt, and only once it is due', async () => {
    await registerEndpoint('/hook');
    answer = status(500);
    await paymentEvent();
    const { id } = await deliveryAfter(1);
    // Two instances get the retry's job at the same time.
    answer = (n, p, res) => setTimeout(() => ok(n, p, res), 300);
    const deliver = moduleRef.get(DeliverWebhook);

    expect(await deliver.execute(id)).toBe('skipped'); // not due yet
    clock.advance(MIN);
    const results = await Promise.all([
      deliver.execute(id),
      deliver.execute(id),
    ]);

    expect(results.sort()).toEqual(['skipped', 'succeeded']);
    expect(received).toHaveLength(2);
    expect(await prisma.webhookDeliveryAttempt.count()).toBe(2);
  });

  it('signs each retry with the secrets valid at that attempt (ticket 04 rotation)', async () => {
    const { id } = await registerEndpoint('/hook');
    answer = (n, p, res) => (n < 2 ? status(500) : ok)(n, p, res);
    await paymentEvent();
    await deliveryAfter(1);
    const http = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
    });
    await http
      .post(`/internal/webhook-endpoints/${id}/roll-secret`)
      .send({ previousSecretValidFor: '1h' })
      .expect(200);
    const signatures = (n: number) =>
      (received[n]!.headers['paybridge-signature'] as string)
        .split(',')
        .filter((p) => p.startsWith('v1=')).length;

    clock.advance(MIN); // inside the overlap
    await sweep();
    await deliveryAfter(2);
    clock.set(new Date(START.getTime() + 2 * HOUR)); // the overlap is over
    await sweep();
    await deliveryAfter(3);

    expect([0, 1, 2].map(signatures)).toEqual([1, 2, 1]);
  });
});

describe('a Redis outage', () => {
  it('loses no delivery: PostgreSQL keeps it due and the sweep queues it once Redis is back', async () => {
    await registerEndpoint('/hook');
    answer = status(500);
    await paymentEvent();
    const { id } = await deliveryAfter(1);

    // This instance reaches Redis through a proxy the test can cut.
    const proxy = await startRedisProxy();
    const flaky = new Queue(WEBHOOK_QUEUES.delivery, {
      connection: {
        host: '127.0.0.1',
        port: proxy.port,
        maxRetriesPerRequest: 1,
        retryStrategy: () => 50,
      },
      prefix: process.env.QUEUE_PREFIX,
    });
    const offline = new BullDeliveryDispatcher(flaky, clock);
    const deliverOffline = new DeliverWebhook(
      moduleRef.get(WebhooksTransactionRunner),
      moduleRef.get(SecretCipher),
      moduleRef.get(WebhookSender),
      clock,
      offline,
      moduleRef.get(RetryJitter),
    );
    const sweepOffline = new WebhookDeliverySweep(
      moduleRef.get(WebhooksTransactionRunner),
      clock,
      offline,
    );
    try {
      await flaky.waitUntilReady();
      // Redis loses every queued job, then goes away.
      await deliveryQueue.obliterate({ force: true });
      await proxy.cut();

      // The retry falls due in the outage: the attempt is made and recorded,
      // but the job of the next one cannot be queued.
      clock.advance(MIN);
      expect(await deliverOffline.execute(id)).toBe('retrying');
      expect(
        await prisma.webhookDelivery.findFirstOrThrow({ where: { id } }),
      ).toMatchObject({
        status: 'PENDING',
        attempts: 2,
        nextAttemptAt: new Date(START.getTime() + MIN + 3 * MIN),
        lockedAt: null,
      });
      clock.advance(3 * MIN);
      await expect(sweepOffline.run()).rejects.toThrow();

      await proxy.restore();
      answer = ok;
      await expect
        .poll(
          () =>
            sweepOffline.run().then(
              () => true,
              () => false,
            ),
          { timeout: 5_000, interval: 100 },
        )
        .toBe(true);
      const delivered = await deliveryAfter(3);

      expect(delivered.status).toBe('SUCCEEDED');
      expect(delivered.attemptRows.map((a) => a.httpStatus)).toEqual([
        500, 500, 200,
      ]);
    } finally {
      await flaky.close();
      await proxy.close();
    }
  });
});

describe('retention', () => {
  it('prunes finished deliveries after the retention period and keeps those still retrying', async () => {
    await registerEndpoint('/ok');
    await registerEndpoint('/down');
    answer = (n, p, res) => (p === '/down' ? status(500) : ok)(n, p, res);
    await paymentEvent();
    await expect
      .poll(() =>
        prisma.webhookDelivery.count({
          where: { attempts: 1, lockedAt: null },
        }),
      )
      .toBe(2);
    const retention = moduleRef.get(WebhookRetention);

    // Kept for 7 days (WEBHOOK_DELIVERY_RETENTION_DAYS' default).
    clock.advance(6 * 24 * HOUR);
    expect(await retention.run()).toEqual({ deliveries: 0 });
    clock.advance(24 * HOUR + MIN);
    expect(await retention.run()).toEqual({ deliveries: 1 });

    const left = await prisma.webhookDelivery.findMany({
      include: { endpoint: true, attemptRows: true },
    });
    expect(left.map((d) => [d.endpoint.url, d.status])).toEqual([
      [`${receiverUrl}/down`, 'PENDING'],
    ]);
    expect(await prisma.webhookDeliveryAttempt.count()).toBe(1);
  });
});

/** A TCP proxy to the compose Redis that can be cut (outage) and restored. */
async function startRedisProxy() {
  const target = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const sockets = new Set<Socket>();
  let server: NetServer | undefined;
  let port = 0;

  const listen = () =>
    new Promise<void>((resolve) => {
      server = createNetServer((client) => {
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
