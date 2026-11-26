import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import {
  CheckoutEndpoint,
  CurrentCheckout,
  type CheckoutCaller,
} from '../../src/identity/port/index.js';
import { bearer, createApiKey } from '../setup/api-keys.js';
import { createOrganization } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 06: a Publishable Key is a checkout-only credential (ADR 0009).
// Checkout endpoints (07, 08) do not exist yet, so test-only probes stand in
// for them; they are registered by this test module only.

@CheckoutEndpoint()
@Controller('checkout/probe')
class CheckoutProbeController {
  @Get()
  read(@CurrentCheckout() caller: CheckoutCaller) {
    return caller;
  }

  @Post()
  start(@CurrentCheckout() caller: CheckoutCaller) {
    return caller;
  }
}

/** Under the checkout path, but not declared a checkout endpoint. */
@Controller('checkout/undeclared')
class UndeclaredProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

/** Declared a checkout endpoint, but mounted outside the checkout path. */
@CheckoutEndpoint()
@Controller('misplaced-checkout')
class MisplacedProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

const prisma = createTestPrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [
      CheckoutProbeController,
      UndeclaredProbeController,
      MisplacedProbeController,
    ],
  }).compile();
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
  await prisma.publishableKey.deleteMany();
  await prisma.apiKey.deleteMany();
});

const SHOP = 'https://shop.example.com';
const server = () => app.getHttpServer();
const admin = (organizationId?: string): Promise<SignedInHttp> =>
  signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN', organizationId });

async function createKey(
  http: SignedInHttp,
  allowedOrigins: string[] = [SHOP],
): Promise<{ id: string; key: string }> {
  const res = await http
    .post('/internal/publishable-keys')
    .send({ label: 'Landing page', allowedOrigins })
    .expect(201);
  return res.body as { id: string; key: string };
}

/** `origin: null` sends no Origin header. */
const probe = (key: string | undefined, origin: string | null = SHOP) => {
  let req = request(server()).get('/api/checkout/probe');
  if (key) req = req.set(bearer(key));
  if (origin !== null) req = req.set('Origin', origin);
  return req;
};

describe('a Publishable Key at a checkout endpoint', () => {
  it('resolves to a checkout-only caller with its Organization and allowed origins', async () => {
    const orgId = await createOrganization(prisma);
    const { id, key } = await createKey(await admin(orgId), [
      SHOP,
      'https://www.example.com',
    ]);

    const res = await probe(key, 'https://www.example.com').expect(200);

    expect(res.body).toEqual({
      organizationId: orgId,
      publishableKeyId: id,
      allowedOrigins: [SHOP, 'https://www.example.com'],
      origin: 'https://www.example.com',
    });
  });

  it('works for POST as well', async () => {
    const { key } = await createKey(await admin());

    await request(server())
      .post('/api/checkout/probe')
      .set(bearer(key))
      .set('Origin', SHOP)
      .send({})
      .expect(201);
  });

  it.each([
    ['no key', undefined],
    ['an unknown key', 'pb_pk_notarealkeynotarealkeynotarealkey00'],
  ])('refuses %s with 401', async (_name, key) => {
    const res = await probe(key);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_PUBLISHABLE_KEY');
  });

  it('refuses a revoked key on the next request, while another key keeps working', async () => {
    const http = await admin();
    const old = await createKey(http);
    const next = await createKey(http);
    await probe(old.key).expect(200);

    await http.post(`/internal/publishable-keys/${old.id}/revoke`).expect(200);

    const res = await probe(old.key);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_PUBLISHABLE_KEY');
    await probe(next.key).expect(200);
  });

  it('refuses the key of a suspended Organization', async () => {
    const orgId = await createOrganization(prisma);
    const { key } = await createKey(await admin(orgId));
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: 'SUSPENDED' },
    });

    const res = await probe(key);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_PUBLISHABLE_KEY');
  });

  it('keeps Organizations apart: each key resolves to its own Organization', async () => {
    const mine = await createOrganization(prisma);
    const theirs = await createOrganization(prisma);
    const myKey = await createKey(await admin(mine));
    const theirKey = await createKey(await admin(theirs));

    const a = await probe(myKey.key).expect(200);
    const b = await probe(theirKey.key).expect(200);

    expect(a.body.organizationId).toBe(mine);
    expect(b.body.organizationId).toBe(theirs);
  });
});

describe('origin enforcement', () => {
  it.each([
    ['no Origin', null],
    ['an origin that is not allowed', 'https://evil.example.com'],
    ['another port of an allowed host', 'https://shop.example.com:8443'],
    ['another scheme of an allowed host', 'http://shop.example.com'],
    ['the opaque origin "null"', 'null'],
  ])('refuses %s with 403', async (_name, origin) => {
    const { key } = await createKey(await admin());

    const res = await probe(key, origin);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('follows an edit of the allowed origins on the next request', async () => {
    const http = await admin();
    const { id, key } = await createKey(http);
    await http
      .post(`/internal/publishable-keys/${id}/allowed-origins`)
      .send({ allowedOrigins: ['https://new.example.com'] })
      .expect(200);

    await probe(key, SHOP).expect(403);
    await probe(key, 'https://new.example.com').expect(200);
  });
});

describe('credentials are not interchangeable', () => {
  it('refuses an API Key at a checkout endpoint', async () => {
    const apiKey = await createApiKey(prisma);

    const res = await probe(apiKey);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_PUBLISHABLE_KEY');
  });

  it('refuses a Publishable Key at the payments API', async () => {
    const { key } = await createKey(await admin());

    const res = await request(server())
      .post('/api/payments')
      .set(bearer(key))
      .set('Origin', SHOP)
      .send({ amount: '150000', currency: 'VND', upstreamReference: 'x-1' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('refuses a Publishable Key at Console endpoints', async () => {
    const { key } = await createKey(await admin());

    const res = await request(server())
      .get('/internal/publishable-keys')
      .set(bearer(key))
      .set('Origin', SHOP);

    expect(res.status).toBe(401);
  });

  it('refuses a Publishable Key on a checkout-path route not declared a checkout endpoint', async () => {
    const { key } = await createKey(await admin());

    const res = await request(server())
      .get('/api/checkout/undeclared')
      .set(bearer(key))
      .set('Origin', SHOP);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CHECKOUT_ONLY');
  });

  it('refuses an API Key on a checkout endpoint mounted outside the checkout path', async () => {
    const apiKey = await createApiKey(prisma);

    const res = await request(server())
      .get('/api/misplaced-checkout')
      .set(bearer(apiKey));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PUBLISHABLE_KEY_REQUIRED');
  });
});

describe('CORS on checkout endpoints', () => {
  it('answers a preflight from any origin without cookies', async () => {
    const res = await request(server())
      .options('/api/checkout/probe')
      .set('Origin', SHOP)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(SHOP);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain(
      'authorization',
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers.vary).toContain('Origin');
  });

  it('lets the browser read both answers and refusals', async () => {
    const { key } = await createKey(await admin());

    const ok = await probe(key).expect(200);
    const refused = await probe(key, 'https://evil.example.com').expect(403);

    expect(ok.headers['access-control-allow-origin']).toBe(SHOP);
    expect(refused.headers['access-control-allow-origin']).toBe(
      'https://evil.example.com',
    );
  });

  it('adds no CORS headers outside the checkout endpoints', async () => {
    const res = await request(server())
      .options('/api/payments')
      .set('Origin', SHOP)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
