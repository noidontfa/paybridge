import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import Stripe from 'stripe';
import { AppModule } from '../../src/app.module.js';
import { STRIPE_HTTP_CLIENT } from '../../src/gateways/gateways.module.js';
import { FixtureHttpClient } from '../../src/gateways/stripe/fixture-http-client.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { ImportEnvStripeAccount } from '../../src/payment-core/application/use-cases/import-env-stripe-account.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { CredentialCipher } from '../../src/payment-core/domain/services/credential-cipher.js';
import {
  DEFAULT_ORGANIZATION_ID,
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 11: Callbacks arrive at a URL naming the Gateway Connection.

const prisma = createTestPrismaClient();
let app: INestApplication;
let moduleRef: TestingModule;
const signer = new Stripe('sk_test_signer');

const creds = (n: string) => ({
  secretKey: `sk_test_${n}`,
  webhookSecret: `whsec_${n}`,
  publishableKey: `pk_test_${n}`,
});

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STRIPE_HTTP_CLIENT)
    .useValue(new FixtureHttpClient())
    .compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  applyGlobalPrefix(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await ensureOtherOrganization(prisma);
});

async function connectStripe(
  organizationId: string,
  secrets: ReturnType<typeof creds>,
  enabled = true,
) {
  const sealed = moduleRef
    .get(CredentialCipher)
    .encrypt(JSON.stringify(secrets));
  return prisma.gatewayConnection.create({
    data: {
      id: newId(),
      organizationId,
      gatewayId: 'stripe',
      credentialsCiphertext: sealed.ciphertext,
      credentialsKeyId: sealed.keyId,
      enabled,
    },
  });
}

function stripeEvent(): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    livemode: false,
    data: {
      object: {
        id: 'pi_1',
        object: 'payment_intent',
        amount: 1000,
        amount_received: 1000,
        metadata: { attemptKey: randomUUID() },
      },
    },
  });
}

function send(path: string, body: string, secret: string) {
  const header = signer.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  return request(app.getHttpServer())
    .post(path)
    .set('content-type', 'application/json')
    .set('stripe-signature', header)
    .send(body);
}

const inbox = () => prisma.webhookInbox.findMany();

describe('the per-connection Callback route', () => {
  it("verifies with that connection's secret and stores the Callback with its Organization", async () => {
    const a = await connectStripe(DEFAULT_ORGANIZATION_ID, creds('a'));
    const b = await connectStripe(OTHER_ORGANIZATION_ID, creds('b'));
    await send(`/api/webhooks/stripe/${b.id}`, stripeEvent(), 'whsec_b').expect(
      200,
    );
    const rows = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(OTHER_ORGANIZATION_ID);

    // B's secret is not valid on A's URL.
    await send(`/api/webhooks/stripe/${a.id}`, stripeEvent(), 'whsec_b').expect(
      400,
    );
    expect(await inbox()).toHaveLength(1);
  });

  it('refuses an unknown connection id and a mismatched gateway', async () => {
    const a = await connectStripe(DEFAULT_ORGANIZATION_ID, creds('a'));
    await send(
      `/api/webhooks/stripe/${newId()}`,
      stripeEvent(),
      'whsec_a',
    ).expect(404);
    await send(
      '/api/webhooks/stripe/not-a-uuid',
      stripeEvent(),
      'whsec_a',
    ).expect(404);
    await send(`/api/webhooks/fake/${a.id}`, stripeEvent(), 'whsec_a').expect(
      404,
    );
    expect(await inbox()).toHaveLength(0);
  });

  it('still processes Callbacks to a disabled connection', async () => {
    const a = await connectStripe(DEFAULT_ORGANIZATION_ID, creds('a'), false);
    await send(`/api/webhooks/stripe/${a.id}`, stripeEvent(), 'whsec_a').expect(
      200,
    );
    expect(await inbox()).toHaveLength(1);
  });
});

describe('the legacy route without a connection id', () => {
  it("forwards to the default Organization's Gateway Connection", async () => {
    await connectStripe(DEFAULT_ORGANIZATION_ID, creds('a'));
    await connectStripe(OTHER_ORGANIZATION_ID, creds('b'));
    await send('/api/webhooks/stripe', stripeEvent(), 'whsec_b').expect(400);
    await send('/api/webhooks/stripe', stripeEvent(), 'whsec_a').expect(200);
    const rows = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });
});

describe('importing the env Stripe account', () => {
  it('copies it into the default Organization once, encrypted', async () => {
    const importer = moduleRef.get(ImportEnvStripeAccount);
    const env = creds('env');
    expect(await importer.execute(undefined)).toBe('not-configured');
    expect(await importer.execute(env)).toBe('created');
    const row = await prisma.gatewayConnection.findFirstOrThrow({
      where: { organizationId: DEFAULT_ORGANIZATION_ID, gatewayId: 'stripe' },
    });
    expect(row.enabled).toBe(true);
    expect(row.credentialsCiphertext).not.toContain('whsec_env');
    const plain = moduleRef.get(CredentialCipher).decrypt({
      ciphertext: row.credentialsCiphertext!,
      keyId: row.credentialsKeyId!,
    });
    expect(JSON.parse(plain)).toEqual(env);

    expect(await importer.execute(creds('other'))).toBe('exists');
    // The imported connection verifies Callbacks.
    await send(
      `/api/webhooks/stripe/${row.id}`,
      stripeEvent(),
      'whsec_env',
    ).expect(200);
  });
});
