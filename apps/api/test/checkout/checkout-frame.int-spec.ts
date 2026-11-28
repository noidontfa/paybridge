import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { createPublishableKey, SHOP_ORIGIN } from '../setup/checkout.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 09: before serving the checkout page, the checkout app asks which
// websites may frame it, to send `Content-Security-Policy: frame-ancestors`.

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

const CHECKOUT_APP = 'http://localhost:3200';
const OTHER_SHOP = 'https://www.example.com';

const frame = (key: string, hostOrigin: string) =>
  request(app.getHttpServer())
    .get('/api/checkout/frame')
    .set('Authorization', `Bearer ${key}`)
    .set('Origin', CHECKOUT_APP)
    .set('X-PayBridge-Host-Origin', hostOrigin);

describe('the checkout frame policy', () => {
  it("lists the key's allowed origins for a host page the key allows", async () => {
    const { key } = await createPublishableKey(prisma, undefined, [
      SHOP_ORIGIN,
      OTHER_SHOP,
    ]);

    const res = await frame(key, OTHER_SHOP).expect(200);

    expect(res.body).toEqual({ allowedOrigins: [SHOP_ORIGIN, OTHER_SHOP] });
  });

  it('is unavailable for a host page the key does not allow', async () => {
    const { key } = await createPublishableKey(prisma);

    const res = await frame(key, 'https://evil.example.com').expect(422);

    expect(res.body.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(res.body.details).toEqual({ reason: 'ORIGIN_NOT_ALLOWED' });
  });

  it('is unavailable for a revoked key', async () => {
    const { id, key } = await createPublishableKey(prisma);
    await prisma.publishableKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    const res = await frame(key, SHOP_ORIGIN).expect(422);

    expect(res.body.details).toEqual({ reason: 'INVALID_PUBLISHABLE_KEY' });
  });
});
