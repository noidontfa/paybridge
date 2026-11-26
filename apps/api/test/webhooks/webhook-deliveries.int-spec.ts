import { createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { v7 } from 'uuid';
import type { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import type { UserRole } from '../../src/identity/domain/entities/user.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { apiErrorBodySchema } from '../contract/console/schemas.js';
import {
  webhookDeliveryDetailSchema,
  webhookDeliveryListSchema,
} from '../contract/console/webhook-deliveries.js';
import {
  DEFAULT_ORGANIZATION_ID,
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 03: Webhook deliveries in the Console. Operators see each delivery
// and its attempts and resend one; Organization Admins send test events; an
// endpoint that keeps failing is marked on the Webhook Endpoints page.

const prisma = createTestPrismaClient();
let app: INestApplication;

interface Received {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let receiver: Server;
let receiverUrl: string;
let received: Received[] = [];
/** How the receiver answers; default 200 "ok". */
let answer: (res: ServerResponse) => void;
const ok = (res: ServerResponse) => res.end('ok');

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
      answer(res);
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
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
});

const LIST = '/internal/webhook-deliveries';

const as = (
  role: UserRole,
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<SignedInHttp> => signedInHttp(app, prisma, { role, organizationId });

/** A Super Admin working in one Organization. */
async function superAdminIn(organizationId: string) {
  const http = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
  return {
    get: (path: string) =>
      http.get(path).set('X-Organization-Id', organizationId),
    post: (path: string) =>
      http.post(path).set('X-Organization-Id', organizationId),
  };
}

async function getValid<S extends z.ZodType>(
  http: Pick<SignedInHttp, 'get'>,
  path: string,
  schema: S,
): Promise<z.output<S>> {
  const res = await http.get(path);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return schema.parse(res.body);
}

async function registerEndpoint(
  organizationId = DEFAULT_ORGANIZATION_ID,
  path = '/hook',
): Promise<{ id: string; url: string; secret: string }> {
  const admin = await as('ORGANIZATION_ADMIN', organizationId);
  const res = await admin
    .post('/internal/webhook-endpoints')
    .send({ url: `${receiverUrl}${path}`, eventKinds: ['payment.succeeded'] })
    .expect(201);
  return res.body as { id: string; url: string; secret: string };
}

interface AttemptFixture {
  at: string;
  succeeded: boolean;
  httpStatus?: number | null;
  durationMs?: number;
  responseBody?: string | null;
  error?: string | null;
}

/**
 * A delivery as the delivery worker leaves it (ticket 01 owns that path; the
 * reads here only need its rows).
 */
async function storeDelivery(fixture: {
  endpointId: string;
  organizationId?: string;
  createdAt: string;
  eventKind?: string;
  paymentId?: string | null;
  status?: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts?: AttemptFixture[];
}): Promise<{ id: string; eventId: string }> {
  const organizationId = fixture.organizationId ?? DEFAULT_ORGANIZATION_ID;
  const id = v7();
  const eventId = v7();
  const paymentId = fixture.paymentId === undefined ? v7() : fixture.paymentId;
  const attempts = fixture.attempts ?? [];
  await prisma.webhookDelivery.create({
    data: {
      id,
      organizationId,
      endpointId: fixture.endpointId,
      eventId,
      eventKind: fixture.eventKind ?? 'payment.succeeded',
      eventCreatedAt: new Date(fixture.createdAt),
      paymentId,
      payload: { paymentId, status: 'SUCCEEDED', amount: '150000' },
      status: fixture.status ?? 'SUCCEEDED',
      attempts: attempts.length,
      createdAt: new Date(fixture.createdAt),
    },
  });
  for (const attempt of attempts) {
    await prisma.webhookDeliveryAttempt.create({
      data: {
        id: v7(),
        organizationId,
        deliveryId: id,
        attemptedAt: new Date(attempt.at),
        succeeded: attempt.succeeded,
        httpStatus: attempt.httpStatus ?? null,
        durationMs: attempt.durationMs ?? 12,
        responseBody: attempt.responseBody ?? null,
        error: attempt.error ?? null,
      },
    });
  }
  return { id, eventId };
}

function expectError(res: { status: number; body: unknown }, status: number) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return apiErrorBodySchema.parse(res.body);
}

/** A receiver's signature check, written from the documented scheme. */
function verifies(secret: string, header: string, body: string): boolean {
  const parts = header.split(',');
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const expected = createHmac('sha256', secret)
    .update(`${t}.${body}`)
    .digest('hex');
  return parts.some((p) => p === `v1=${expected}`);
}

describe('listing deliveries', () => {
  it('shows the endpoint, kind, Payment, status, attempts and the last attempt, newest first', async () => {
    const endpoint = await registerEndpoint();
    const older = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'SUCCEEDED',
      attempts: [
        { at: '2026-11-20T10:00:01.000Z', succeeded: true, httpStatus: 200 },
      ],
    });
    const newer = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-21T10:00:00.000Z',
      eventKind: 'payment.created',
      status: 'FAILED',
      attempts: [
        { at: '2026-11-21T10:00:01.000Z', succeeded: false, httpStatus: 500 },
        { at: '2026-11-21T10:05:00.000Z', succeeded: false, httpStatus: 503 },
      ],
    });
    const waiting = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-22T10:00:00.000Z',
      status: 'PENDING',
    });

    const page = await getValid(
      await as('OPERATOR'),
      LIST,
      webhookDeliveryListSchema,
    );

    expect(page.items.map((d) => d.id)).toEqual([
      waiting.id,
      newer.id,
      older.id,
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[1]).toMatchObject({
      endpoint: { id: endpoint.id, url: endpoint.url },
      eventId: newer.eventId,
      eventKind: 'payment.created',
      status: 'FAILED',
      attempts: 2,
      lastAttemptAt: '2026-11-21T10:05:00.000Z',
      lastHttpStatus: 503,
      createdAt: '2026-11-21T10:00:00.000Z',
    });
    expect(page.items[1]!.paymentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(page.items[0]).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastAttemptAt: null,
      lastHttpStatus: null,
    });
  });

  it('filters by endpoint, status, kind and Payment', async () => {
    const first = await registerEndpoint(DEFAULT_ORGANIZATION_ID, '/a');
    const second = await registerEndpoint(DEFAULT_ORGANIZATION_ID, '/b');
    const paymentId = v7();
    const a = await storeDelivery({
      endpointId: first.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'FAILED',
      paymentId,
    });
    const b = await storeDelivery({
      endpointId: second.id,
      createdAt: '2026-11-20T11:00:00.000Z',
      eventKind: 'payment.created',
      paymentId,
    });
    const c = await storeDelivery({
      endpointId: second.id,
      createdAt: '2026-11-20T12:00:00.000Z',
    });
    const operator = await as('OPERATOR');
    const ids = async (query: string) =>
      (
        await getValid(operator, `${LIST}?${query}`, webhookDeliveryListSchema)
      ).items.map((d) => d.id);

    expect(await ids(`endpointId=${second.id}`)).toEqual([c.id, b.id]);
    expect(await ids('status=FAILED')).toEqual([a.id]);
    expect(await ids('kind=payment.created')).toEqual([b.id]);
    expect(await ids(`paymentId=${paymentId}`)).toEqual([b.id, a.id]);
    expect(await ids(`paymentId=${paymentId}&status=`)).toEqual([b.id, a.id]);
  });

  it('pages with an opaque cursor, like the other Console lists', async () => {
    const endpoint = await registerEndpoint();
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = await storeDelivery({
        endpointId: endpoint.id,
        // Two share a time: the id breaks the tie without repeats or gaps.
        createdAt: `2026-11-2${Math.min(i, 3)}T10:00:00.000Z`,
      });
      created.push(d.id);
    }
    const operator = await as('OPERATOR');

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `${LIST}?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = await getValid(operator, path, webhookDeliveryListSchema);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(created));
    expect(seen.slice(0, 2)).toEqual([created[4], created[3]].sort().reverse());
  });

  it.each([
    ['an unknown status', 'status=LOST'],
    ['an unknown kind', 'kind=payment.refunded'],
    ['an endpoint id that is not one', 'endpointId=abc'],
    ['a foreign cursor', 'cursor=WyJjYWxsYmFja3MiLCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCIwMTkzMDAwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiXQ'],
  ])('rejects %s', async (_, query) => {
    const res = await (await as('OPERATOR')).get(`${LIST}?${query}`);
    expectError(res, 400);
  });
});

describe('a delivery in detail', () => {
  it('shows every attempt with time, HTTP status, duration, response body and refusal reason, newest first', async () => {
    const endpoint = await registerEndpoint();
    const delivery = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'FAILED',
      attempts: [
        {
          at: '2026-11-20T10:00:01.000Z',
          succeeded: false,
          httpStatus: null,
          durationMs: 3,
          error: 'Refused address 10.0.0.5 (private)',
        },
        {
          at: '2026-11-20T10:01:00.000Z',
          succeeded: false,
          httpStatus: 500,
          durationMs: 87,
          responseBody: 'Internal error',
          error: 'HTTP 500',
        },
      ],
    });

    const detail = await getValid(
      await as('OPERATOR'),
      `${LIST}/${delivery.id}`,
      webhookDeliveryDetailSchema,
    );

    expect(detail).toMatchObject({
      id: delivery.id,
      eventId: delivery.eventId,
      eventCreatedAt: '2026-11-20T10:00:00.000Z',
      endpoint: { id: endpoint.id, url: endpoint.url },
      status: 'FAILED',
      attempts: 2,
      lastHttpStatus: 500,
    });
    expect(detail.history).toMatchObject([
      {
        attemptedAt: '2026-11-20T10:01:00.000Z',
        succeeded: false,
        httpStatus: 500,
        durationMs: 87,
        responseBody: 'Internal error',
        error: 'HTTP 500',
        triggeredBy: null,
      },
      {
        attemptedAt: '2026-11-20T10:00:01.000Z',
        httpStatus: null,
        durationMs: 3,
        responseBody: null,
        error: 'Refused address 10.0.0.5 (private)',
      },
    ]);
  });

  it('is not found for an unknown id', async () => {
    const operator = await as('OPERATOR');
    const res = await operator.get(`${LIST}/${v7()}`);
    expect(expectError(res, 404).code).toBe('WEBHOOK_DELIVERY_NOT_FOUND');
    expectError(await operator.get(`${LIST}/not-a-uuid`), 400);
  });
});

describe('resending a delivery', () => {
  it('makes a new attempt of the same delivery with the same event id, recorded with the User', async () => {
    const endpoint = await registerEndpoint();
    const delivery = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'FAILED',
      attempts: [
        { at: '2026-11-20T10:00:01.000Z', succeeded: false, httpStatus: 500 },
      ],
    });
    const operator = await as('OPERATOR');

    const res = await operator.post(`${LIST}/${delivery.id}/resend`).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const detail = webhookDeliveryDetailSchema.parse(res.body);
    expect(received).toHaveLength(1);
    const envelope = JSON.parse(received[0]!.body) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      id: delivery.eventId,
      type: 'payment.succeeded',
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(received[0]!.headers['paybridge-event-id']).toBe(delivery.eventId);
    expect(
      verifies(
        endpoint.secret,
        received[0]!.headers['paybridge-signature'] as string,
        received[0]!.body,
      ),
    ).toBe(true);
    expect(detail).toMatchObject({
      id: delivery.id,
      eventId: delivery.eventId,
      status: 'SUCCEEDED',
      attempts: 2,
      lastHttpStatus: 200,
    });
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0]).toMatchObject({
      succeeded: true,
      httpStatus: 200,
      responseBody: 'ok',
      triggeredBy: { name: 'Test OPERATOR', role: 'OPERATOR', label: null },
    });
    expect(detail.history[1]!.triggeredBy).toBeNull();
    expect(await prisma.webhookDelivery.count()).toBe(1);
  });

  it('records a failed resend without hiding an earlier success', async () => {
    const endpoint = await registerEndpoint();
    const delivery = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'SUCCEEDED',
      attempts: [
        { at: '2026-11-20T10:00:01.000Z', succeeded: true, httpStatus: 200 },
      ],
    });
    answer = (res) => {
      res.statusCode = 502;
      res.end('bad gateway');
    };

    const res = await (await as('ORGANIZATION_ADMIN'))
      .post(`${LIST}/${delivery.id}/resend`)
      .send({});

    const detail = webhookDeliveryDetailSchema.parse(res.body);
    expect(detail.status).toBe('SUCCEEDED');
    expect(detail.attempts).toBe(2);
    expect(detail.history[0]).toMatchObject({
      succeeded: false,
      httpStatus: 502,
      responseBody: 'bad gateway',
    });
  });

  it('labels a Super Admin as the platform', async () => {
    const endpoint = await registerEndpoint();
    const delivery = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'FAILED',
    });
    const superAdmin = await superAdminIn(DEFAULT_ORGANIZATION_ID);

    const res = await superAdmin
      .post(`${LIST}/${delivery.id}/resend`)
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      webhookDeliveryDetailSchema.parse(res.body).history[0]!.triggeredBy,
    ).toEqual({
      name: 'Test SUPER_ADMIN',
      role: 'SUPER_ADMIN',
      label: 'Super Admin (PayBridge)',
    });
  });

  it('records a failed attempt when the endpoint was disabled', async () => {
    const endpoint = await registerEndpoint();
    const delivery = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'FAILED',
    });
    await (await as('ORGANIZATION_ADMIN'))
      .post(`/internal/webhook-endpoints/${endpoint.id}/disable`)
      .send({})
      .expect(200);

    const res = await (await as('OPERATOR'))
      .post(`${LIST}/${delivery.id}/resend`)
      .send({});

    expect(res.status).toBe(200);
    expect(received).toHaveLength(0);
    expect(webhookDeliveryDetailSchema.parse(res.body).history[0]).toMatchObject(
      { succeeded: false, error: 'The Webhook Endpoint is disabled' },
    );
  });

  it('is not found for an unknown delivery', async () => {
    const res = await (await as('OPERATOR'))
      .post(`${LIST}/${v7()}/resend`)
      .send({});
    expect(expectError(res, 404).code).toBe('WEBHOOK_DELIVERY_NOT_FOUND');
  });
});

describe('sending a test event', () => {
  it("lets an Organization Admin check a receiver and see the result", async () => {
    const endpoint = await registerEndpoint();
    const admin = await as('ORGANIZATION_ADMIN');

    const res = await admin
      .post(`/internal/webhook-endpoints/${endpoint.id}/test`)
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const detail = webhookDeliveryDetailSchema.parse(res.body);
    expect(detail).toMatchObject({
      endpoint: { id: endpoint.id },
      eventKind: 'webhook.test',
      paymentId: null,
      status: 'SUCCEEDED',
      attempts: 1,
      lastHttpStatus: 200,
    });
    expect(detail.history[0]!.triggeredBy).toMatchObject({
      role: 'ORGANIZATION_ADMIN',
    });
    expect(received).toHaveLength(1);
    const envelope = JSON.parse(received[0]!.body) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      id: detail.eventId,
      type: 'webhook.test',
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(
      verifies(
        endpoint.secret,
        received[0]!.headers['paybridge-signature'] as string,
        received[0]!.body,
      ),
    ).toBe(true);
    // It is listed with the other deliveries, under its own kind.
    const listed = await getValid(
      admin,
      `${LIST}?kind=webhook.test`,
      webhookDeliveryListSchema,
    );
    expect(listed.items.map((d) => d.id)).toEqual([detail.id]);
  });

  it('shows a failing receiver as a failed test delivery', async () => {
    const endpoint = await registerEndpoint();
    answer = (res) => {
      res.statusCode = 404;
      res.end('no such route');
    };

    const res = await (await as('ORGANIZATION_ADMIN'))
      .post(`/internal/webhook-endpoints/${endpoint.id}/test`)
      .send({});

    expect(res.status).toBe(200);
    expect(webhookDeliveryDetailSchema.parse(res.body)).toMatchObject({
      status: 'FAILED',
      lastHttpStatus: 404,
      history: [{ succeeded: false, responseBody: 'no such route' }],
    });
  });

  it('refuses an Operator', async () => {
    const endpoint = await registerEndpoint();
    const res = await (await as('OPERATOR'))
      .post(`/internal/webhook-endpoints/${endpoint.id}/test`)
      .send({});
    expectError(res, 403);
    expect(received).toHaveLength(0);
  });

  it('is not found for an unknown endpoint', async () => {
    const res = await (await as('ORGANIZATION_ADMIN'))
      .post(`/internal/webhook-endpoints/${v7()}/test`)
      .send({});
    expect(expectError(res, 404).code).toBe('WEBHOOK_ENDPOINT_NOT_FOUND');
  });
});

describe('an endpoint that keeps failing', () => {
  it('is marked as failing on the Webhook Endpoints page', async () => {
    const broken = await registerEndpoint(DEFAULT_ORGANIZATION_ID, '/broken');
    const healthy = await registerEndpoint(DEFAULT_ORGANIZATION_ID, '/ok');
    for (let i = 0; i < 3; i++) {
      await storeDelivery({
        endpointId: broken.id,
        createdAt: `2026-11-2${i}T10:00:00.000Z`,
        status: 'FAILED',
        attempts: [
          { at: `2026-11-2${i}T10:00:01.000Z`, succeeded: false, httpStatus: 500 },
        ],
      });
      await storeDelivery({
        endpointId: healthy.id,
        createdAt: `2026-11-2${i}T10:00:00.000Z`,
        status: i === 2 ? 'SUCCEEDED' : 'FAILED',
        attempts: [
          { at: `2026-11-2${i}T10:00:01.000Z`, succeeded: i === 2 },
        ],
      });
    }

    const res = await (await as('ORGANIZATION_ADMIN'))
      .get('/internal/webhook-endpoints')
      .expect(200);

    const failing = Object.fromEntries(
      (res.body.items as { id: string; failing: boolean }[]).map((e) => [
        e.id,
        e.failing,
      ]),
    );
    expect(failing).toEqual({ [broken.id]: true, [healthy.id]: false });
  });
});

describe('Permissions per Role', () => {
  it.each(['OPERATOR', 'ORGANIZATION_ADMIN'] as const)(
    'a %s views and resends deliveries',
    async (role) => {
      const endpoint = await registerEndpoint();
      const delivery = await storeDelivery({
        endpointId: endpoint.id,
        createdAt: '2026-11-20T10:00:00.000Z',
        status: 'FAILED',
      });
      const http = await as(role);

      await http.get(LIST).expect(200);
      await http.get(`${LIST}/${delivery.id}`).expect(200);
      await http.post(`${LIST}/${delivery.id}/resend`).send({}).expect(200);
    },
  );

  it('a Super Admin views and resends in the Organization they chose', async () => {
    const endpoint = await registerEndpoint();
    const delivery = await storeDelivery({
      endpointId: endpoint.id,
      createdAt: '2026-11-20T10:00:00.000Z',
    });
    const superAdmin = await superAdminIn(DEFAULT_ORGANIZATION_ID);

    const page = await getValid(superAdmin, LIST, webhookDeliveryListSchema);
    expect(page.items.map((d) => d.id)).toEqual([delivery.id]);
    await superAdmin.post(`${LIST}/${delivery.id}/resend`).send({}).expect(200);
    await superAdmin
      .post(`/internal/webhook-endpoints/${endpoint.id}/test`)
      .send({})
      .expect(200);
  });

  it('refuses a caller who is not signed in', async () => {
    const res = await (await import('supertest'))
      .default(app.getHttpServer())
      .get(LIST);
    expectError(res, 401);
  });
});

describe('Organization isolation', () => {
  it("never shows or resends another Organization's delivery", async () => {
    const theirs = await registerEndpoint(OTHER_ORGANIZATION_ID);
    const theirDelivery = await storeDelivery({
      organizationId: OTHER_ORGANIZATION_ID,
      endpointId: theirs.id,
      createdAt: '2026-11-20T10:00:00.000Z',
      status: 'FAILED',
    });
    const mine = await registerEndpoint();
    const myDelivery = await storeDelivery({
      endpointId: mine.id,
      createdAt: '2026-11-20T10:00:00.000Z',
    });
    const operator = await as('OPERATOR');
    const admin = await as('ORGANIZATION_ADMIN');

    const page = await getValid(operator, LIST, webhookDeliveryListSchema);
    expect(page.items.map((d) => d.id)).toEqual([myDelivery.id]);
    const filtered = await getValid(
      operator,
      `${LIST}?endpointId=${theirs.id}`,
      webhookDeliveryListSchema,
    );
    expect(filtered.items).toEqual([]);
    expectError(await operator.get(`${LIST}/${theirDelivery.id}`), 404);
    expectError(
      await operator.post(`${LIST}/${theirDelivery.id}/resend`).send({}),
      404,
    );
    expectError(
      await admin.post(`/internal/webhook-endpoints/${theirs.id}/test`).send({}),
      404,
    );
    expect(received).toHaveLength(0);
    expect(
      await prisma.webhookDeliveryAttempt.count({
        where: { deliveryId: theirDelivery.id },
      }),
    ).toBe(0);
  });
});
