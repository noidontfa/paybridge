import { createHash, createHmac } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  FakeGatewayPlugin,
  type FakeCallbackPayload,
} from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { QUEUES } from '../../src/payment-core/infrastructure/queue/queue.constants.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import type { CallbackInput } from '../../src/payment-core/port/index.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 18: a provider callback is verified, stored in the webhook inbox and
// acknowledged at once. Processing is dispatched to the webhook queue.

const ROUTE = `/${GLOBAL_PREFIX}/webhooks/fake`;

/** Stand-in for the BullMQ queue: records adds; can be made to hang. */
class RecordingQueue {
  /**
   * Read by @nestjs/bullmq to build the webhook worker (ticket 19), which then
   * listens on the real (empty) queue while adds are only recorded here.
   */
  get opts() {
    // Read lazily: the config module loads .env.test after this file runs.
    return {
      connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null },
      prefix: process.env.QUEUE_PREFIX,
    };
  }
  readonly added: { name: string; data: unknown; jobId?: string }[] = [];
  hang = false;
  add(name: string, data: unknown, opts: { jobId?: string } = {}) {
    this.added.push({ name, data, jobId: opts.jobId });
    if (this.hang) return new Promise(() => {});
    return Promise.resolve({ id: opts.jobId });
  }
}

let app: INestApplication;
let prisma: PrismaClient;
let fake: FakeGatewayPlugin;
const queue = new RecordingQueue();

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(getQueueToken(QUEUES.webhookInbox))
    .useValue(queue)
    .compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
  fake = app.get(FakeGatewayPlugin);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  fake.reset();
  queue.added.length = 0;
  queue.hang = false;
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

function payload(overrides: Partial<FakeCallbackPayload> = {}) {
  return {
    attemptKey: newId(),
    status: 'SUCCEEDED' as const,
    amount: '10000',
    ...overrides,
  };
}

function post(callback: CallbackInput, path = ROUTE) {
  let req = request(app.getHttpServer()).post(path);
  for (const [name, value] of Object.entries(callback.headers)) {
    if (typeof value === 'string') req = req.set(name, value);
  }
  // A string is sent as-is; superagent would JSON-encode a Buffer.
  return req.send(new TextDecoder().decode(callback.rawBody));
}

const inboxRows = () =>
  prisma.webhookInbox.findMany({ orderBy: { receivedAt: 'asc' } });

describe('a valid callback', () => {
  it('is stored as RECEIVED with raw body, allow-listed headers, query, gateway, keys', async () => {
    const body = payload({ eventId: 'evt-1' });
    const callback = fake.signedCallback(body);

    const res = await post(callback, `${ROUTE}?foo=bar`)
      .set('x-unrelated', 'secret-cookie-ish')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    const rows = await inboxRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      gatewayId: 'fake',
      dedupeKey: 'evt-1',
      providerEventId: 'evt-1',
      attemptKey: body.attemptKey,
      status: 'RECEIVED',
      query: { foo: 'bar' },
    });
    expect(Buffer.from(row.rawBody)).toEqual(Buffer.from(callback.rawBody));
    expect(row.headers).toMatchObject({
      'content-type': 'application/json',
      'x-fake-signature': callback.headers['x-fake-signature'],
    });
    expect(row.headers).not.toHaveProperty('x-unrelated');
  });

  it('keeps the exact request bytes, even when JSON parsing would change them', async () => {
    // Odd spacing and key order: re-serialising the parsed body would differ.
    const raw = `{ "status":"SUCCEEDED",  "amount":"10000","attemptKey":"${newId()}" }`;
    const rawBody = new TextEncoder().encode(raw);
    const signed = fake.signedCallback(payload());
    const signature = createHmacHex(rawBody);
    await post({
      ...signed,
      rawBody,
      headers: { ...signed.headers, 'x-fake-signature': signature },
    }).expect(200);

    const [row] = await inboxRows();
    expect(Buffer.from(row!.rawBody).toString('utf8')).toBe(raw);
  });

  it('keeps the raw bytes of a content type the JSON parser does not handle', async () => {
    const callback = fake.signedCallback(payload());
    await post({
      ...callback,
      headers: { ...callback.headers, 'content-type': 'text/plain' },
    }).expect(200);

    const [row] = await inboxRows();
    expect(Buffer.from(row!.rawBody)).toEqual(Buffer.from(callback.rawBody));
  });

  it('uses the SHA-256 of the raw body as dedupe key when there is no event id', async () => {
    const callback = fake.signedCallback(payload());
    await post(callback).expect(200);

    const [row] = await inboxRows();
    expect(row!.dedupeKey).toBe(
      createHash('sha256').update(callback.rawBody).digest('hex'),
    );
    expect(row!.providerEventId).toBeNull();
  });

  it('stores no attempt key when the plugin derives none that is a UUID', async () => {
    const callback = fake.signedCallback(payload({ attemptKey: 'not-a-uuid' }));
    await post(callback).expect(200);

    const [row] = await inboxRows();
    expect(row!.attemptKey).toBeNull();
  });

  it('stores an attempt key Core does not know (no foreign key)', async () => {
    const callback = fake.signedCallback(payload({ attemptKey: newId() }));
    await post(callback).expect(200);
    expect(await inboxRows()).toHaveLength(1);
  });

  it('dispatches the stored row to the webhook queue with the inbox id as job id', async () => {
    await post(fake.signedCallback(payload())).expect(200);

    const [row] = await inboxRows();
    expect(queue.added).toEqual([
      expect.objectContaining({ jobId: row!.id, data: { inboxId: row!.id } }),
    ]);
  });

  it('is acknowledged without waiting for processing or dispatch', async () => {
    queue.hang = true;
    await post(fake.signedCallback(payload())).expect(200);
    expect(await inboxRows()).toHaveLength(1);
  });
});

describe('an invalid callback', () => {
  it('gets the error acknowledgement and stores nothing', async () => {
    const callback = fake.signedCallback(payload());
    const res = await post({
      ...callback,
      headers: { ...callback.headers, 'x-fake-signature': 'forged' },
    }).expect(400);

    expect(res.body).toEqual({ ok: false });
    expect(await inboxRows()).toHaveLength(0);
    expect(queue.added).toHaveLength(0);
  });

  it('logs only the rejection reason, never the body', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      const callback = fake.signedCallback(
        payload({ providerRef: 'CARD-4111-SECRET' }),
      );
      await post({
        ...callback,
        headers: { ...callback.headers, 'x-fake-signature': 'forged' },
      }).expect(400);

      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('Invalid fake callback signature');
      expect(logged).not.toContain('CARD-4111-SECRET');
    } finally {
      warn.mockRestore();
    }
  });

  it('stores nothing when the gateway is unknown', async () => {
    await post(
      fake.signedCallback(payload()),
      `/${GLOBAL_PREFIX}/webhooks/nope`,
    ).expect(404);
    expect(await inboxRows()).toHaveLength(0);
  });
});

describe('a duplicate callback', () => {
  it('by event id: success acknowledgement, no second row, not dispatched again', async () => {
    await post(fake.signedCallback(payload({ eventId: 'evt-dup' }))).expect(
      200,
    );
    // Different body (another delivery of the same event), same event id.
    const res = await post(
      fake.signedCallback(payload({ eventId: 'evt-dup', amount: '20000' })),
    ).expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(await inboxRows()).toHaveLength(1);
    expect(queue.added).toHaveLength(1);
  });

  it('by body hash: success acknowledgement and no second row', async () => {
    const callback = fake.signedCallback(payload());
    await post(callback).expect(200);
    await post(callback).expect(200);
    expect(await inboxRows()).toHaveLength(1);
  });

  it('stores one row under concurrent deliveries', async () => {
    const byHash = fake.signedCallback(payload());
    const byEvent = payload({ eventId: 'evt-race' });
    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => post(byHash)),
      ...Array.from({ length: 8 }, (_, i) =>
        post(fake.signedCallback({ ...byEvent, amount: String(1000 + i) })),
      ),
    ]);

    expect(results.map((r) => r.status)).toEqual(Array(16).fill(200));
    expect(await inboxRows()).toHaveLength(2);
    expect(queue.added).toHaveLength(2);
  });
});

function createHmacHex(rawBody: Uint8Array): string {
  // The fake plugin's default secret; its signature scheme is HMAC-SHA256 hex.
  return createHmac('sha256', 'fake-secret').update(rawBody).digest('hex');
}
