import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { createOrganization } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 06: Publishable Keys, over HTTP on real PostgreSQL. An Organization
// Admin manages them in the Console; Customers' browsers present them to the
// checkout endpoints from an allowed origin (ADR 0009).

const prisma = createTestPrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
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
});

const SHOP = 'https://shop.example.com';
const admin = (organizationId?: string): Promise<SignedInHttp> =>
  signedInHttp(app, prisma, { role: 'ORGANIZATION_ADMIN', organizationId });

interface KeyView {
  id: string;
  label: string;
  key: string;
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  createdBy: { name: string | null; role: string | null; label: string | null };
  updatedBy: { name: string | null; role: string | null; label: string | null };
}

async function createKey(
  http: SignedInHttp,
  allowedOrigins: string[] = [SHOP],
  label = 'Landing page',
): Promise<KeyView> {
  const res = await http
    .post('/internal/publishable-keys')
    .send({ label, allowedOrigins })
    .expect(201);
  return res.body as KeyView;
}

describe('creating a Publishable Key', () => {
  it('returns a recognisable key that can be listed again at any time', async () => {
    const http = await admin();

    const created = await createKey(http, [SHOP, 'https://www.example.com:8443']);

    expect(created.key).toMatch(/^pb_pk_[A-Za-z0-9_-]{32,}$/);
    expect(created.label).toBe('Landing page');
    expect(created.allowedOrigins).toEqual([SHOP, 'https://www.example.com:8443']);
    expect(created.revokedAt).toBeNull();
    const listed = await http.get('/internal/publishable-keys').expect(200);
    expect(listed.body.items).toEqual([created]);
  });

  it('normalises origins to scheme, host and port', async () => {
    const http = await admin();

    const created = await createKey(http, [
      'HTTPS://Shop.Example.com/',
      'https://shop.example.com:443',
      'https://b.example.com:8443',
    ]);

    expect(created.allowedOrigins).toEqual([SHOP, 'https://b.example.com:8443']);
  });

  it.each([
    ['no origins', []],
    ['an origin with a path', ['https://shop.example.com/pricing']],
    ['an origin with a query', ['https://shop.example.com?x=1']],
    ['a non-web scheme', ['ftp://shop.example.com']],
    ['a wildcard', ['https://*.example.com']],
    ['plain http on a public host', ['http://shop.example.com']],
    ['something that is not a URL', ['shop.example.com']],
  ])('refuses %s', async (_name, allowedOrigins) => {
    const http = await admin();

    const res = await http
      .post('/internal/publishable-keys')
      .send({ label: 'x', allowedOrigins });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ALLOWED_ORIGINS');
  });

  it('accepts localhost origins outside production', async () => {
    const http = await admin();

    const created = await createKey(http, [
      'http://localhost:5173',
      'http://127.0.0.1:5174',
    ]);

    expect(created.allowedOrigins).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5174',
    ]);
  });

  it('rejects a blank label', async () => {
    const http = await admin();

    const res = await http
      .post('/internal/publishable-keys')
      .send({ label: ' ', allowedOrigins: [SHOP] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLISHABLE_KEY_LABEL');
  });

  it('records who created it', async () => {
    const http = await admin();

    const created = await createKey(http);

    expect(created.createdBy).toEqual({
      name: 'Test ORGANIZATION_ADMIN',
      role: 'ORGANIZATION_ADMIN',
      label: 'Test ORGANIZATION_ADMIN',
    });
  });
});

describe('listing Publishable Keys', () => {
  it('shows several keys of the Organization only, newest first', async () => {
    const http = await admin();
    const other = await admin(await createOrganization(prisma));
    const first = await createKey(http, [SHOP], 'first');
    const second = await createKey(http, [SHOP], 'second');
    await createKey(other, [SHOP], 'not mine');

    const res = await http.get('/internal/publishable-keys').expect(200);

    expect(res.body.items.map((k: KeyView) => k.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});
