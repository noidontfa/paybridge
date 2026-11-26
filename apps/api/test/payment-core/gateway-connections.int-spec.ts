import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { STRIPE_HTTP_CLIENT } from '../../src/gateways/gateways.module.js';
import { FixtureHttpClient } from '../../src/gateways/stripe/fixture-http-client.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { ReencryptGatewayCredentials } from '../../src/payment-core/application/use-cases/manage-gateway-connections.js';
import { RequeryAttempt } from '../../src/payment-core/application/workers/requery-attempt.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { ALL_ORGANIZATIONS } from '../../src/payment-core/domain/organization-scope.js';
import { CredentialCipher } from '../../src/payment-core/infrastructure/crypto/credential-cipher.js';
import {
  createOrganization,
  DEFAULT_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 10: Gateway Connections, over HTTP on real PostgreSQL.

const prisma = createTestPrismaClient();
const stripeHttp = new FixtureHttpClient();
let app: INestApplication;
let moduleRef: TestingModule;
let admin: SignedInHttp;

const STRIPE = {
  secretKey: 'sk_test_conn',
  webhookSecret: 'whsec_conn',
  publishableKey: 'pk_test_conn',
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STRIPE_HTTP_CLIENT)
    .useValue(stripeHttp)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  admin = await signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN' });
});

const api = () => request(app.getHttpServer());
const connectionsOf = (organizationId = DEFAULT_ORGANIZATION_ID) =>
  prisma.gatewayConnection.findMany({ where: { organizationId } });

async function connectStripe(token = admin) {
  return token
    .post('/internal/gateway-connections')
    .send({ gatewayId: 'stripe', credentials: STRIPE });
}

async function startAttempt(gatewayId: string) {
  const created = await api()
    .post('/api/payments')
    .send({
      amount: '150000',
      currency: 'VND',
      upstreamReference: `order-${newId()}`,
    })
    .expect(201);
  const res = await api()
    .post(`/api/payments/${created.body.id}/attempts`)
    .send({ gatewayId, returnUrl: 'https://shop.example/return' });
  return { paymentId: created.body.id as string, res };
}

describe('managing Gateway Connections', () => {
  it('an Organization Admin connects a gateway and never sees its credentials', async () => {
    const res = await connectStripe();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      gatewayId: 'stripe',
      enabled: true,
      credentialsVersion: 1,
      credentialFields: ['publishableKey', 'secretKey', 'webhookSecret'],
    });

    const list = await admin.get('/internal/gateway-connections').expect(200);
    const everything = JSON.stringify([res.body, list.body]);
    for (const secret of Object.values(STRIPE)) {
      expect(everything).not.toContain(secret);
    }
    const stored = (await connectionsOf()).find((c) => c.gatewayId === 'stripe');
    expect(stored?.credentialsCiphertext).toBeTruthy();
    expect(stored?.credentialsCiphertext).not.toContain('sk_test_conn');
    expect(stored?.credentialsKeyId).toBe('dev');
  });

  it('allows at most one Gateway Connection per gateway', async () => {
    await connectStripe().then((r) => expect(r.status).toBe(201));
    const again = await connectStripe();
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('GATEWAY_CONNECTION_EXISTS');
  });

  it('rejects credentials that do not fit the gateway', async () => {
    const bad = await admin
      .post('/internal/gateway-connections')
      .send({ gatewayId: 'stripe', credentials: { secretKey: 'nope' } });
    expect(bad.status).toBe(400);
    const noCredentialsGateway = await admin
      .post('/internal/gateway-connections')
      .send({ gatewayId: 'unknown-gw' });
    expect(noCredentialsGateway.status).toBe(400);
  });

  it('replaces credentials, bumping the version, without echoing them', async () => {
    const id = (await connectStripe()).body.id as string;
    const res = await admin
      .put(`/internal/gateway-connections/${id}/credentials`)
      .send({ credentials: { ...STRIPE, secretKey: 'sk_test_rotated' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.credentialsVersion).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain('sk_test_rotated');
  });

  it('enables and disables', async () => {
    const id = (await connectStripe()).body.id as string;
    const off = await admin
      .post(`/internal/gateway-connections/${id}/disable`)
      .expect(200);
    expect(off.body.enabled).toBe(false);
    const on = await admin
      .post(`/internal/gateway-connections/${id}/enable`)
      .expect(200);
    expect(on.body.enabled).toBe(true);
  });

  it('deletes an unused connection but refuses a used one', async () => {
    const id = (await connectStripe()).body.id as string;
    await admin.delete(`/internal/gateway-connections/${id}`).expect(204);
    expect((await connectionsOf()).some((c) => c.gatewayId === 'stripe')).toBe(
      false,
    );

    const fake = (await connectionsOf()).find((c) => c.gatewayId === 'fake')!;
    const { res } = await startAttempt('fake');
    expect(res.status).toBe(201);
    const refused = await admin.delete(`/internal/gateway-connections/${fake.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('GATEWAY_CONNECTION_USED');
    expect((await connectionsOf()).some((c) => c.id === fake.id)).toBe(true);
  });

  it('is sensitive: a deactivated Admin is refused at once, an Operator never allowed', async () => {
    const operator = await signedInHttp(app, prisma, { role: 'OPERATOR' });
    await operator.get('/internal/gateway-connections').expect(403);
    await operator
      .post('/internal/gateway-connections')
      .send({ gatewayId: 'stripe', credentials: STRIPE })
      .expect(403);

    await prisma.user.update({
      where: { id: admin.user.id },
      data: { active: false },
    });
    const res = await connectStripe();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('isolates Organizations', async () => {
    const other = await createOrganization(prisma);
    const otherAdmin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId: other,
    });
    const id = (await connectStripe()).body.id as string;

    const list = await otherAdmin.get('/internal/gateway-connections').expect(200);
    expect(
      (list.body.items as { id: string }[]).map((c) => c.id),
    ).not.toContain(id);
    await otherAdmin
      .post(`/internal/gateway-connections/${id}/disable`)
      .expect(404);
  });
});

describe('starting a PaymentTransaction', () => {
  it('is refused on a gateway the Organization has not connected', async () => {
    const { res } = await startAttempt('stripe');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GATEWAY_NOT_CONNECTED');
  });

  it('uses the Organization’s own credentials', async () => {
    await connectStripe().then((r) => expect(r.status).toBe(201));
    stripeHttp.respond(200, 'payment-intent.requires-payment-method');
    const { res } = await startAttempt('stripe');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.attempt.nextAction.clientParams.publishableKey).toBe(
      'pk_test_conn',
    );
  });

  it('is refused when the connection is disabled, and works again once enabled', async () => {
    const id = (await connectStripe()).body.id as string;
    await admin.post(`/internal/gateway-connections/${id}/disable`).expect(200);
    const refused = await startAttempt('stripe');
    expect(refused.res.status).toBe(409);
    expect(refused.res.body.code).toBe('GATEWAY_DISABLED');

    await admin.post(`/internal/gateway-connections/${id}/enable`).expect(200);
    stripeHttp.respond(200, 'payment-intent.requires-payment-method');
    expect((await startAttempt('stripe')).res.status).toBe(201);
  });

  it('keeps re-queries working on a disabled connection', async () => {
    const id = (await connectStripe()).body.id as string;
    stripeHttp.respond(200, 'payment-intent.requires-payment-method');
    const { res } = await startAttempt('stripe');
    const attemptId = res.body.attempt.id as string;
    await admin.post(`/internal/gateway-connections/${id}/disable`).expect(200);

    stripeHttp.respond(200, 'payment-intent.succeeded');
    const outcome = await moduleRef
      .get(RequeryAttempt)
      .execute(attemptId);
    expect(outcome).toBe('applied');
  });

  it('the fake gateway’s connection has no credentials', async () => {
    const fake = (await connectionsOf()).find((c) => c.gatewayId === 'fake')!;
    expect(fake.credentialsCiphertext).toBeNull();
    const res = await admin
      .post('/internal/gateway-connections')
      .send({ gatewayId: 'fake', credentials: { a: 'b' } });
    expect(res.status).toBe(409); // already connected; credentials never apply
    await prisma.gatewayConnection.delete({ where: { id: fake.id } });
    const bad = await admin
      .post('/internal/gateway-connections')
      .send({ gatewayId: 'fake', credentials: { a: 'b' } });
    expect(bad.status).toBe(400);
  });
});

describe('credential key rotation', () => {
  it('re-encrypts every row under the primary key and credentials still work', async () => {
    const id = (await connectStripe()).body.id as string;
    const before = await prisma.gatewayConnection.findUniqueOrThrow({
      where: { id },
    });
    expect(before.credentialsKeyId).toBe('dev');

    // A new primary key in front of the old one.
    const rotated = CredentialCipher.fromConfig(
      `k2:${randomBytes(32).toString('base64')},dev:${Buffer.from('paybridge-dev-key-not-for-prod!!').toString('base64')}`,
    );
    const rotatedApp = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CredentialCipher)
      .useValue(rotated)
      .overrideProvider(STRIPE_HTTP_CLIENT)
      .useValue(stripeHttp)
      .compile();
    await rotatedApp.init();
    const rewritten = await rotatedApp
      .get(ReencryptGatewayCredentials)
      .execute(ALL_ORGANIZATIONS);
    expect(rewritten).toBe(1);

    const after = await prisma.gatewayConnection.findUniqueOrThrow({
      where: { id },
    });
    expect(after.credentialsKeyId).toBe('k2');
    expect(after.credentialsCiphertext).not.toBe(before.credentialsCiphertext);
    expect(after.credentialsVersion).toBe(before.credentialsVersion);
    expect(
      JSON.parse(
        rotated.decrypt({
          ciphertext: after.credentialsCiphertext!,
          keyId: after.credentialsKeyId!,
        }),
      ),
    ).toEqual(STRIPE);
    await rotatedApp.close();
  });
});
