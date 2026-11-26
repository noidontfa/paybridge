import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { OutboxRelay } from '../../src/payment-core/infrastructure/queue/outbox-relay.js';
import {
  WEBHOOK_DELIVERY_OPTIONS,
  type WebhookDeliveryOptions,
} from '../../src/webhooks/infrastructure/config/delivery-options.js';
import { bearer, createApiKey } from '../setup/api-keys.js';
import {
  DEFAULT_ORGANIZATION_ID,
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 01, seam 2: Webhook delivery over real HTTP. A local receiver stands
// in for the Organization's system; Payments are driven through the public
// API, and the test asserts what the receiver gets.

const prisma = createTestPrismaClient();
let moduleRef: TestingModule;
let app: INestApplication;
/** Changed by the SSRF and timeout tests; the module reads it at each call. */
const options: {
  -readonly [K in keyof WebhookDeliveryOptions]: WebhookDeliveryOptions[K];
} = {
  protection: false,
  timeoutMs: 10_000,
  responseBodyLimit: 1024,
};

interface Received {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let receiver: Server;
let receiverUrl: string;
let received: Received[] = [];
/** How the receiver answers a path; default 200 "ok". */
let answer: (path: string, res: ServerResponse) => void;
const ok = (_path: string, res: ServerResponse) => res.end('ok');

beforeAll(async () => {
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      answer(req.url ?? '', res);
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WEBHOOK_DELIVERY_OPTIONS)
    .useValue(options)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
  await ensureOtherOrganization(prisma);
});
afterAll(async () => {
  await app.close();
  receiver.closeAllConnections();
  await new Promise((r) => receiver.close(r));
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  received = [];
  answer = ok;
  options.protection = false;
  options.timeoutMs = 10_000;
});

const admin = (
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<SignedInHttp> =>
  signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN', organizationId });

async function registerEndpoint(
  http: SignedInHttp,
  path: string,
  eventKinds: string[] = ['payment.created', 'payment.cancelled'],
): Promise<{ id: string; secret: string }> {
  const res = await http
    .post('/internal/webhook-endpoints')
    .send({ url: `${receiverUrl}${path}`, eventKinds })
    .expect(201);
  return res.body as { id: string; secret: string };
}

async function createPayment(
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<{ id: string; upstreamReference: string }> {
  const key = await createApiKey(prisma, organizationId);
  const res = await request(app.getHttpServer())
    .post('/api/payments')
    .set(bearer(key))
    .send({
      amount: '150000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    })
    .expect(201);
  return res.body as { id: string; upstreamReference: string };
}

async function cancelPayment(id: string): Promise<void> {
  const key = await createApiKey(prisma);
  await request(app.getHttpServer())
    .post(`/api/payments/${id}/cancel`)
    .set(bearer(key))
    .expect(200);
}

/** Publishes the outbox (the relay loop is off in tests). */
async function publish(): Promise<void> {
  await moduleRef.get(OutboxRelay).publishPending();
}

async function waitForRequests(count: number): Promise<Received[]> {
  await expect
    .poll(() => received.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(count);
  return received;
}

/** Waits until every delivery has had an attempt, then returns them. */
async function settledDeliveries(count: number) {
  await expect
    .poll(
      () =>
        prisma.webhookDelivery.count({ where: { status: { not: 'PENDING' } } }),
      { timeout: 10_000 },
    )
    .toBe(count);
  return prisma.webhookDelivery.findMany({
    include: { attemptRows: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** A receiver's check, written from the documented scheme. */
function verifies(secret: string, header: string, body: string): boolean {
  const parts = header.split(',');
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  return parts
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const given = Buffer.from(p.slice(3), 'hex');
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    });
}

describe('delivering a Payment Event', () => {
  it('POSTs a signed JSON envelope with the Payment Event as Core wrote it', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http, '/hook');
    const payment = await createPayment();
    const outbox = await prisma.outboxEvent.findFirstOrThrow({
      where: { paymentId: payment.id },
    });

    await publish();
    const [delivery] = await waitForRequests(1);

    expect(delivery!.path).toBe('/hook');
    expect(delivery!.headers['content-type']).toBe('application/json');
    const signature = delivery!.headers['paybridge-signature'] as string;
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifies(endpoint.secret, signature, delivery!.body)).toBe(true);
    expect(verifies('whsec_pb_wrong', signature, delivery!.body)).toBe(false);
    const t = Number(/t=(\d+)/.exec(signature)![1]);
    expect(Math.abs(t - Date.now() / 1000)).toBeLessThan(60);
    expect(JSON.parse(delivery!.body)).toEqual({
      id: outbox.id,
      type: 'payment.created',
      createdAt: outbox.createdAt.toISOString(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      data: outbox.payload,
    });
    expect(JSON.parse(delivery!.body).data).toMatchObject({
      paymentId: payment.id,
      upstreamReference: payment.upstreamReference,
      amount: '150000',
      currency: 'VND',
      status: 'PENDING',
    });
  });

  it('records the attempt: time, HTTP status, duration and the start of the body', async () => {
    const http = await admin();
    await registerEndpoint(http, '/hook');
    answer = (_p, res) => res.end('x'.repeat(5000));
    await createPayment();

    await publish();
    const [delivery] = await settledDeliveries(1);

    expect(delivery!.status).toBe('SUCCEEDED');
    expect(delivery!.attempts).toBe(1);
    const [attempt] = delivery!.attemptRows;
    expect(attempt).toMatchObject({
      succeeded: true,
      httpStatus: 200,
      error: null,
    });
    expect(attempt!.durationMs).toBeGreaterThanOrEqual(0);
    expect(attempt!.attemptedAt).toBeInstanceOf(Date);
    expect(attempt!.responseBody).toBe('x'.repeat(1024));
  });

  it('fans out to every subscribed endpoint of the Organization', async () => {
    const http = await admin();
    const a = await registerEndpoint(http, '/a');
    const b = await registerEndpoint(http, '/b');
    await createPayment();

    await publish();
    const requests = await waitForRequests(2);

    expect(requests.map((r) => r.path).sort()).toEqual(['/a', '/b']);
    const byPath = Object.fromEntries(requests.map((r) => [r.path, r]));
    expect(
      verifies(
        a.secret,
        byPath['/a']!.headers['paybridge-signature'] as string,
        byPath['/a']!.body,
      ),
    ).toBe(true);
    expect(
      verifies(
        b.secret,
        byPath['/b']!.headers['paybridge-signature'] as string,
        byPath['/b']!.body,
      ),
    ).toBe(true);
    expect(JSON.parse(byPath['/a']!.body).id).toBe(
      JSON.parse(byPath['/b']!.body).id,
    );
  });

  it('sends each endpoint only the kinds it subscribes to', async () => {
    const http = await admin();
    await registerEndpoint(http, '/created', ['payment.created']);
    await registerEndpoint(http, '/cancelled', ['payment.cancelled']);
    const payment = await createPayment();
    await cancelPayment(payment.id);

    await publish();
    await settledDeliveries(2);

    const byPath = [...received].sort((a, b) => a.path.localeCompare(b.path));
    expect(byPath.map((r) => [r.path, JSON.parse(r.body).type])).toEqual([
      ['/cancelled', 'payment.cancelled'],
      ['/created', 'payment.created'],
    ]);
  });

  it("never delivers to another Organization's endpoints", async () => {
    await registerEndpoint(await admin(), '/mine');
    await registerEndpoint(await admin(OTHER_ORGANIZATION_ID), '/theirs');
    await createPayment(OTHER_ORGANIZATION_ID);

    await publish();
    await settledDeliveries(1);

    expect(received.map((r) => r.path)).toEqual(['/theirs']);
    expect(JSON.parse(received[0]!.body).organizationId).toBe(
      OTHER_ORGANIZATION_ID,
    );
  });

  it('skips a disabled endpoint', async () => {
    const http = await admin();
    await registerEndpoint(http, '/on');
    const off = await registerEndpoint(http, '/off');
    await http
      .post(`/internal/webhook-endpoints/${off.id}/disable`)
      .expect(200);
    await createPayment();

    await publish();
    await settledDeliveries(1);

    expect(received.map((r) => r.path)).toEqual(['/on']);
  });

  it('delivers a Payment Event once per endpoint even if it is consumed twice', async () => {
    const http = await admin();
    await registerEndpoint(http, '/hook');
    await createPayment();
    await publish();
    await settledDeliveries(1);

    // The same Payment Event arrives again as a new job, as after the relay
    // re-adds a row whose earlier job has expired from Redis.
    await prisma.outboxEvent.updateMany({ data: { publishedAt: null } });
    await moduleRef
      .get<Queue>(getQueueToken('core-outbox'))
      .obliterate({ force: true });
    await publish();
    await new Promise((r) => setTimeout(r, 500));

    expect(received).toHaveLength(1);
    expect(await prisma.webhookDelivery.count()).toBe(1);
  });
});

describe('a failed attempt', () => {
  it('records a non-2xx answer as a failure', async () => {
    const http = await admin();
    await registerEndpoint(http, '/broken');
    answer = (_p, res) => {
      res.statusCode = 500;
      res.end('boom');
    };
    await createPayment();

    await publish();
    const [delivery] = await settledDeliveries(1);

    expect(delivery!.status).toBe('FAILED');
    expect(delivery!.attemptRows[0]).toMatchObject({
      succeeded: false,
      httpStatus: 500,
      responseBody: 'boom',
    });
  });

  it('does not follow a redirect', async () => {
    const http = await admin();
    await registerEndpoint(http, '/moved');
    answer = (path, res) => {
      if (path === '/moved') {
        res.writeHead(302, { location: `${receiverUrl}/elsewhere` });
      }
      res.end();
    };
    await createPayment();

    await publish();
    const [delivery] = await settledDeliveries(1);

    expect(received.map((r) => r.path)).toEqual(['/moved']);
    expect(delivery!.attemptRows[0]).toMatchObject({
      succeeded: false,
      httpStatus: 302,
    });
    expect(delivery!.attemptRows[0]!.error).toMatch(/redirect/);
  });

  it('gives up after the timeout', async () => {
    const http = await admin();
    await registerEndpoint(http, '/slow');
    options.timeoutMs = 300;
    answer = () => {
      /* never answers */
    };
    await createPayment();

    await publish();
    const [delivery] = await settledDeliveries(1);

    expect(delivery!.attemptRows[0]).toMatchObject({
      succeeded: false,
      httpStatus: null,
    });
    expect(delivery!.attemptRows[0]!.error).toMatch(/Timed out after 300 ms/);
    expect(delivery!.attemptRows[0]!.durationMs).toBeLessThan(5_000);
  });
});

describe('SSRF protection', () => {
  it('refuses to save a private, loopback or plain-HTTP URL when it is on', async () => {
    options.protection = true;
    const http = await admin();

    for (const url of [
      `${receiverUrl}/hook`,
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/hook',
      'https://localhost/hook',
    ]) {
      const res = await http
        .post('/internal/webhook-endpoints')
        .send({ url, eventKinds: ['payment.created'] });
      expect([url, res.status, res.body.code]).toEqual([
        url,
        400,
        'INVALID_WEBHOOK_URL',
      ]);
    }
  });

  it('records a delivery to a refused address as a failed attempt, and never connects', async () => {
    const http = await admin();
    // Saved while protection was off (e.g. before it was turned on).
    await registerEndpoint(http, '/hook');
    await prisma.webhookEndpoint.updateMany({
      data: { url: `https://127.0.0.1:${new URL(receiverUrl).port}/hook` },
    });
    options.protection = true;
    await createPayment();

    await publish();
    const [delivery] = await settledDeliveries(1);

    expect(received).toEqual([]);
    expect(delivery!.status).toBe('FAILED');
    expect(delivery!.attemptRows[0]).toMatchObject({
      succeeded: false,
      httpStatus: null,
    });
    expect(delivery!.attemptRows[0]!.error).toMatch(/127\.0\.0\.1 is loopback/);
  });

  it('refuses plain HTTP at delivery when it is on', async () => {
    const http = await admin();
    await registerEndpoint(http, '/hook');
    options.protection = true;
    await createPayment();

    await publish();
    const [delivery] = await settledDeliveries(1);

    expect(received).toEqual([]);
    expect(delivery!.attemptRows[0]!.error).toMatch(/HTTPS/);
  });
});
