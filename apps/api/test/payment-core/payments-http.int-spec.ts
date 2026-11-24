import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GLOBAL_PREFIX } from '../../src/constants.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// POST /api/payments over HTTP: request validation, the response shape and the
// mapping of domain errors to status codes. Rules are covered in depth by
// create-payment.int-spec.ts.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new FakeClock(NOW))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
    ...overrides,
  };
}

function post(payload: object) {
  return request(app.getHttpServer()).post('/api/payments').send(payload);
}

describe('POST /api/payments', () => {
  it('201 with the Payment id, PENDING and the expiry', async () => {
    const payload = body({ expiresAt: '2026-05-01T19:00:00+07:00' });

    const res = await post(payload).expect(201);

    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'PENDING',
      amount: '150000',
      currency: 'VND',
      upstreamReference: payload.upstreamReference,
      expiresAt: '2026-05-01T12:00:00.000Z',
      createdAt: expect.any(String),
    });
    expect(await prisma.payment.count({ where: { id: res.body.id } })).toBe(1);
  });

  it('defaults the expiry to 30 minutes after creation', async () => {
    const res = await post(body()).expect(201);

    expect(res.body.expiresAt).toBe('2026-05-01T10:30:00.000Z');
  });

  it.each([
    ['a currency other than VND', { currency: 'USD' }, /VND/],
    ['a zero amount', { amount: '0' }, /greater than zero/],
    ['a negative amount', { amount: '-5000' }, /positive decimal/],
    [
      'fraction digits VND does not allow',
      { amount: '1000.5' },
      /fraction digits/,
    ],
    ['an amount that is not a string', { amount: 150000 }, /amount/],
    [
      'an empty upstream reference',
      { upstreamReference: '' },
      /upstreamReference/,
    ],
    [
      'a blank upstream reference',
      { upstreamReference: '  ' },
      /upstreamReference/,
    ],
    [
      'a missing upstream reference',
      { upstreamReference: undefined },
      /upstreamReference/,
    ],
    [
      'an expiry under 30 minutes',
      { expiresAt: '2026-05-01T10:20:00.000Z' },
      /30 minutes and 24 hours/,
    ],
    [
      'an expiry over 24 hours',
      { expiresAt: '2026-05-02T10:00:01.000Z' },
      /30 minutes and 24 hours/,
    ],
    [
      'an expiry that is not a timestamp',
      { expiresAt: 'tomorrow' },
      /expiresAt/,
    ],
  ])('400 for %s, nothing stored', async (_label, overrides, message) => {
    const res = await post(body(overrides)).expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, path: '/api/payments' });
    expect(JSON.stringify(res.body.message)).toMatch(message);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('409 with the existing Payment id for a duplicate upstream reference', async () => {
    const payload = body();
    const first = await post(payload).expect(201);

    const res = await post(payload).expect(409);

    expect(res.body).toMatchObject({
      statusCode: 409,
      code: 'UPSTREAM_REFERENCE_EXISTS',
      details: { paymentId: first.body.id },
    });
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe('POST /api/payments with Idempotency-Key', () => {
  function postWithKey(payload: object, key: string) {
    return post(payload).set('Idempotency-Key', key);
  }

  it('replays the stored 201 response for the same key and body', async () => {
    const payload = body();
    const first = await postWithKey(payload, 'key-1').expect(201);

    const second = await postWithKey(payload, 'key-1').expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await prisma.payment.count()).toBe(1);
  });

  it('422 for the same key with a different body', async () => {
    const payload = body();
    await postWithKey(payload, 'key-1').expect(201);

    const res = await postWithKey({ ...payload, amount: '99000' }, 'key-1');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await prisma.payment.count()).toBe(1);
  });

  it('409 with the existing Payment id for a new key and an existing upstream reference', async () => {
    const payload = body();
    const first = await postWithKey(payload, 'key-1').expect(201);

    const res = await postWithKey(payload, 'key-2').expect(409);

    expect(res.body).toMatchObject({
      code: 'UPSTREAM_REFERENCE_EXISTS',
      details: { paymentId: first.body.id },
    });
  });

  it.each([
    ['empty', ''],
    ['longer than 255 characters', 'k'.repeat(256)],
  ])('400 for an %s key, nothing stored', async (_label, key) => {
    const res = await postWithKey(body(), key).expect(400);

    expect(JSON.stringify(res.body.message)).toMatch(/Idempotency-Key/);
    expect(await prisma.payment.count()).toBe(0);
  });
});
