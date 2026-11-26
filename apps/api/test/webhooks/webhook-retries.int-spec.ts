import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { FakeClock } from '../../src/payment-core/domain/services/clock.js';
import { OutboxRelay } from '../../src/payment-core/infrastructure/queue/outbox-relay.js';
import { WebhookDeliverySweep } from '../../src/webhooks/application/sweeps/webhook-delivery-sweep.js';
import {
  RetryJitter,
  WebhooksClock,
} from '../../src/webhooks/domain/services/ports.js';
import {
  WEBHOOK_DELIVERY_OPTIONS,
  type WebhookDeliveryOptions,
} from '../../src/webhooks/infrastructure/config/delivery-options.js';
import { WEBHOOK_QUEUES } from '../../src/webhooks/infrastructure/queue/webhook-queues.js';
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
        (await prisma.webhookDelivery.findFirst({
          where: { lockedAt: null },
        }))?.attempts,
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
});
