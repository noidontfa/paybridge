import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { FakeClock } from '../../src/payment-core/domain/services/clock.js';
import { OutboxRelay } from '../../src/payment-core/infrastructure/queue/outbox-relay.js';
import { WebhooksClock } from '../../src/webhooks/domain/services/ports.js';
import {
  WEBHOOK_DELIVERY_OPTIONS,
  type WebhookDeliveryOptions,
} from '../../src/webhooks/infrastructure/config/delivery-options.js';
import { bearer, createApiKey } from '../setup/api-keys.js';
import {
  createOrganization,
  DEFAULT_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 04: rolling a Webhook Endpoint's signing secret. A local receiver
// stands in for the Organization's system, and the webhooks clock is a
// FakeClock, so the overlap can end without waiting an hour.

const prisma = createTestPrismaClient();
const clock = new FakeClock(new Date('2026-11-27T08:00:00.000Z'));
const HOUR = 60 * 60 * 1000;
const PATH = '/internal/webhook-endpoints';
let moduleRef: TestingModule;
let app: INestApplication;
const options: WebhookDeliveryOptions = {
  protection: false,
  timeoutMs: 10_000,
  responseBodyLimit: 1024,
};

interface Received {
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let receiver: Server;
let receiverUrl: string;
let received: Received[] = [];

beforeAll(async () => {
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WEBHOOK_DELIVERY_OPTIONS)
    .useValue(options)
    .overrideProvider(WebhooksClock)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
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
  clock.set(new Date('2026-11-27T08:00:00.000Z'));
});

const admin = (organizationId = DEFAULT_ORGANIZATION_ID) =>
  signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN', organizationId });

interface EndpointView {
  id: string;
  secretPrefix: string;
  previousSecretExpiresAt: string | null;
  updatedBy: { name: string; role: string; label: string | null };
}

async function registerEndpoint(
  http: SignedInHttp,
): Promise<EndpointView & { secret: string }> {
  const res = await http
    .post(PATH)
    .send({ url: `${receiverUrl}/hook`, eventKinds: ['payment.created'] })
    .expect(201);
  return res.body as EndpointView & { secret: string };
}

async function roll(
  http: SignedInHttp,
  id: string,
  previousSecretValidFor: string,
): Promise<EndpointView & { secret: string }> {
  const res = await http
    .post(`${PATH}/${id}/roll-secret`)
    .send({ previousSecretValidFor })
    .expect(200);
  return res.body as EndpointView & { secret: string };
}

/** Creates a Payment, publishes its Payment Event and returns the Webhook. */
async function nextWebhook(): Promise<Received> {
  const key = await createApiKey(prisma, DEFAULT_ORGANIZATION_ID);
  await request(app.getHttpServer())
    .post('/api/payments')
    .set(bearer(key))
    .send({
      amount: '150000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    })
    .expect(201);
  const before = received.length;
  await moduleRef.get(OutboxRelay).publishPending();
  await expect
    .poll(() => received.length, { timeout: 10_000 })
    .toBe(before + 1);
  return received[before]!;
}

/** A receiver's check, written from the documented scheme. */
function verifies(secret: string, webhook: Received): boolean {
  const parts = (webhook.headers['paybridge-signature'] as string).split(',');
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const expected = createHmac('sha256', secret)
    .update(`${t}.${webhook.body}`)
    .digest();
  return parts
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const given = Buffer.from(p.slice(3), 'hex');
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    });
}

const signatureCount = (webhook: Received) =>
  (webhook.headers['paybridge-signature'] as string)
    .split(',')
    .filter((p) => p.startsWith('v1=')).length;

describe('rolling the signing secret', () => {
  it('returns the new secret in full once, then only its prefix', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);

    const rolled = await roll(http, endpoint.id, '1h');

    expect(rolled.secret).toMatch(/^whsec_pb_[A-Za-z0-9_-]{40,}$/);
    expect(rolled.secret).not.toBe(endpoint.secret);
    expect(rolled.secretPrefix).toBe(rolled.secret.slice(0, 15));
    expect(rolled.previousSecretExpiresAt).toBe('2026-11-27T09:00:00.000Z');
    const listed = (await http.get(PATH).expect(200)).body.items[0];
    expect(listed).not.toHaveProperty('secret');
    expect(listed).toMatchObject({
      secretPrefix: rolled.secretPrefix,
      previousSecretExpiresAt: '2026-11-27T09:00:00.000Z',
    });
  });

  it('signs with both secrets during the overlap, and only the new one after it', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);
    const rolled = await roll(http, endpoint.id, '1h');

    clock.advance(HOUR - 1000);
    const during = await nextWebhook();
    expect(signatureCount(during)).toBe(2);
    expect(verifies(rolled.secret, during)).toBe(true);
    expect(verifies(endpoint.secret, during)).toBe(true);

    clock.advance(1000);
    const after = await nextWebhook();
    expect(signatureCount(after)).toBe(1);
    expect(verifies(rolled.secret, after)).toBe(true);
    expect(verifies(endpoint.secret, after)).toBe(false);
  });

  it('offers 24 hours of overlap', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);

    const rolled = await roll(http, endpoint.id, '24h');

    expect(rolled.previousSecretExpiresAt).toBe('2026-11-28T08:00:00.000Z');
  });

  it('can end the old secret at once', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);
    const rolled = await roll(http, endpoint.id, 'now');

    expect(rolled.previousSecretExpiresAt).toBeNull();
    const webhook = await nextWebhook();
    expect(signatureCount(webhook)).toBe(1);
    expect(verifies(rolled.secret, webhook)).toBe(true);
    expect(verifies(endpoint.secret, webhook)).toBe(false);
  });

  it('replaces the older secret when rolled again during an overlap', async () => {
    const http = await admin();
    const first = await registerEndpoint(http);
    const second = await roll(http, first.id, '24h');
    clock.advance(HOUR);
    const third = await roll(http, first.id, '1h');

    expect(third.previousSecretExpiresAt).toBe('2026-11-27T10:00:00.000Z');
    const webhook = await nextWebhook();
    expect(signatureCount(webhook)).toBe(2);
    expect(verifies(third.secret, webhook)).toBe(true);
    expect(verifies(second.secret, webhook)).toBe(true);
    expect(verifies(first.secret, webhook)).toBe(false);
  });

  it('shows no previous secret once its end time has passed', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);
    await roll(http, endpoint.id, '1h');

    clock.advance(HOUR);

    const listed = (await http.get(PATH).expect(200)).body.items[0];
    expect(listed.previousSecretExpiresAt).toBeNull();
  });

  it('accepts only the offered end times', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);

    for (const body of [{}, { previousSecretValidFor: '7d' }]) {
      await http
        .post(`${PATH}/${endpoint.id}/roll-secret`)
        .send(body)
        .expect(400);
    }
  });

  it("cannot roll another Organization's endpoint", async () => {
    const theirs = await registerEndpoint(
      await admin(await createOrganization(prisma)),
    );
    const res = await (await admin())
      .post(`${PATH}/${theirs.id}/roll-secret`)
      .send({ previousSecretValidFor: '1h' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WEBHOOK_ENDPOINT_NOT_FOUND');
  });
});

describe('who may roll a secret', () => {
  it('refuses an Operator', async () => {
    const endpoint = await registerEndpoint(await admin());
    const operator = await signedInHttp(app, prisma, { role: 'OPERATOR' });

    await operator
      .post(`${PATH}/${endpoint.id}/roll-secret`)
      .send({ previousSecretValidFor: '1h' })
      .expect(403);
  });

  it('is a sensitive write: a deactivated Admin is refused at once', async () => {
    const http = await admin();
    const endpoint = await registerEndpoint(http);
    await prisma.user.update({
      where: { id: http.user.id },
      data: { active: false },
    });

    const res = await http
      .post(`${PATH}/${endpoint.id}/roll-secret`)
      .send({ previousSecretValidFor: '1h' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('records every roll in the audit log, with who did it', async () => {
    const organizationId = await createOrganization(prisma);
    const owner = await admin(organizationId);
    const endpoint = await registerEndpoint(owner);
    await roll(owner, endpoint.id, '1h');
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    await request(app.getHttpServer())
      .post(`${PATH}/${endpoint.id}/roll-secret`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ previousSecretValidFor: 'now' })
      .expect(200);

    const res = await owner.get(`${PATH}/${endpoint.id}/secret-rolls`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        rolledAt: '2026-11-27T08:00:00.000Z',
        previousSecretExpiresAt: null,
        rolledBy: {
          name: 'Test SUPER_ADMIN',
          role: 'SUPER_ADMIN',
          label: 'Super Admin (PayBridge)',
        },
      },
      {
        rolledAt: '2026-11-27T08:00:00.000Z',
        previousSecretExpiresAt: '2026-11-27T09:00:00.000Z',
        rolledBy: {
          name: 'Test ORGANIZATION_ADMIN',
          role: 'ORGANIZATION_ADMIN',
          label: null,
        },
      },
    ]);
  });
});
