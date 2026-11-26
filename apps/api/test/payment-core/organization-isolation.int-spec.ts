import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { permissionsOf } from '../../src/identity/domain/permissions.js';
import { PrincipalResolver } from '../../src/identity/port/principal-resolver.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { resetDatabase } from '../setup/reset-db.js';
import {
  DEFAULT_ORGANIZATION_ID,
  defaultScope,
  ensureOtherOrganization,
  OTHER_ORGANIZATION_ID,
} from '../setup/organizations.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { createUser } from '../setup/users.js';

// Ticket 02 (ADR 0006): nothing in one Organization is visible from another.
// The tests act as Organization A (the default one) or B by changing what the
// principal resolver returns, then call the API over HTTP. Every request that
// names a row of A as B must behave as if the row did not exist.

const HOUR = 60 * 60 * 1000;
const OPENED = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(new Date(OPENED.getTime() + 73 * HOUR));
let actingAs = DEFAULT_ORGANIZATION_ID;
/** A real Operator per Organization: sensitive writes re-read the User. */
const operators: Record<string, string> = {};
let app: INestApplication;
let service: PaymentService;
let runner: TransactionRunner;

beforeAll(async () => {
  await ensureOtherOrganization(prisma);
  for (const organizationId of [DEFAULT_ORGANIZATION_ID, OTHER_ORGANIZATION_ID]) {
    operators[organizationId] = (
      await createUser(prisma, { role: 'OPERATOR', organizationId })
    ).id;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(PrincipalResolver)
    .useValue({
      // Like the real resolver: only operator routes have a User.
      resolve: (req: { path: string }) => ({
        organizationId: actingAs,
        user: req.path.startsWith('/internal/')
          ? {
              id: operators[actingAs]!,
              role: 'OPERATOR',
              permissions: permissionsOf('OPERATOR'),
            }
          : null,
      }),
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
  service = moduleRef.get(PaymentService);
  runner = moduleRef.get(TransactionRunner);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  actingAs = DEFAULT_ORGANIZATION_ID;
  await resetDatabase(prisma);
  await ensureOtherOrganization(prisma);
});

const asA = () => {
  actingAs = DEFAULT_ORGANIZATION_ID;
};
const asB = () => {
  actingAs = OTHER_ORGANIZATION_ID;
};
const http = () => request(app.getHttpServer());

/**
 * Organization A's data: a Payment with an attempt in a review that is old
 * enough to resolve, plus the rows around it (audit, Payment Event, Callback).
 */
async function givenOrganizationAData() {
  const { payment } = await service.createPayment(defaultScope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: 'shared-ref',
  });
  // The database clock stamps `created_at`; the Overview window follows the fake clock.
  await prisma.payment.update({
    where: { id: payment.id },
    data: { createdAt: clock.now() },
  });
  const attemptId = newId();
  await runner.run(async (tx) => {
    await tx.payments.createAttempt(defaultScope, {
      id: attemptId,
      paymentId: payment.id,
      gatewayId: 'fake',
      status: 'REQUIRES_REVIEW',
    });
    await tx.payments.updateAttempt(defaultScope, attemptId, {
      reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
      reviewOpenedAt: OPENED,
      refundRequired: true,
    });
    await tx.statusTransitions.record(defaultScope, {
      entityType: 'PAYMENT_TRANSACTION',
      entityId: attemptId,
      fromStatus: 'PENDING',
      toStatus: 'REQUIRES_REVIEW',
      trigger: 'status_query',
      actor: 'system',
    });
  });
  const callback = await runner.repositories.webhookInbox.record(defaultScope, {
    gatewayId: 'fake',
    dedupeKey: 'evt-a',
    providerEventId: 'evt-a',
    attemptKey: attemptId,
    rawBody: new TextEncoder().encode('{}'),
    headers: {},
    query: {},
  });
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { paymentId: payment.id },
  });
  return {
    paymentId: payment.id,
    attemptId,
    callbackId: callback.entry.id,
    eventId: event.id,
  };
}

describe('as Organization A', () => {
  it('sees its own Payment, Review, Callback, Payment Event and audit rows', async () => {
    const a = await givenOrganizationAData();
    asA();

    await http().get(`/api/payments/${a.paymentId}`).expect(200);
    expect(
      (await http().get('/internal/payments').expect(200)).body.items,
    ).toHaveLength(1);
    expect(
      (await http().get('/internal/reviews').expect(200)).body.items,
    ).toHaveLength(1);
    expect(
      (await http().get('/internal/callbacks').expect(200)).body.items,
    ).toHaveLength(1);
    expect(
      (await http().get('/internal/payment-events').expect(200)).body.items
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await http().get('/internal/status-transitions').expect(200)).body.items
        .length,
    ).toBeGreaterThan(0);
    await http().get(`/internal/callbacks/${a.callbackId}`).expect(200);
    await http().get(`/internal/payment-events/${a.eventId}`).expect(200);
    const overview = await http()
      .get('/internal/overview?range=24h')
      .expect(200);
    expect(overview.body.paymentCount).toBe(1);
  });
});

describe('as Organization B, a row of Organization A', () => {
  it('is not found when read as a Payment', async () => {
    const a = await givenOrganizationAData();
    asB();

    await http().get(`/api/payments/${a.paymentId}`).expect(404);
    await http().get(`/internal/payments/${a.paymentId}`).expect(404);
  });

  it('cannot be changed: cancel, start an attempt and resolve a Review are not found', async () => {
    const a = await givenOrganizationAData();
    asB();

    await http().post(`/api/payments/${a.paymentId}/cancel`).expect(404);
    await http()
      .post(`/api/payments/${a.paymentId}/attempts`)
      .send({ gatewayId: 'fake', returnUrl: 'https://shop.example.com/back' })
      .expect(404);
    await http()
      .post(`/internal/payments/${a.paymentId}/review-resolution`)
      .send({
        attemptId: a.attemptId,
        note: 'trying from another Organization',
        status: 'FAILED',
      })
      .expect(404);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: a.paymentId },
    });
    const attempt = await prisma.paymentTransaction.findUniqueOrThrow({
      where: { id: a.attemptId },
    });
    expect(payment.status).toBe('PENDING');
    expect(attempt.status).toBe('REQUIRES_REVIEW');
    expect(
      await prisma.statusTransition.count({
        where: { actor: 'ops.bob' },
      }),
    ).toBe(0);
  });

  it('is never listed: Payments, Reviews, Callbacks, Payment Events and audit rows', async () => {
    await givenOrganizationAData();
    asB();

    for (const path of [
      '/internal/payments',
      '/internal/reviews',
      '/internal/callbacks',
      '/internal/payment-events',
      '/internal/status-transitions',
    ]) {
      const res = await http().get(path).expect(200);
      expect(res.body.items, path).toEqual([]);
    }
    const summary = await http().get('/internal/reviews/summary').expect(200);
    expect(summary.body).toMatchObject({ open: 0, total: 0 });
    const overview = await http()
      .get('/internal/overview?range=24h')
      .expect(200);
    expect(overview.body.paymentCount).toBe(0);
  });

  it('is not found when read as a Callback or a Payment Event', async () => {
    const a = await givenOrganizationAData();
    asB();

    await http().get(`/internal/callbacks/${a.callbackId}`).expect(404);
    await http().get(`/internal/payment-events/${a.eventId}`).expect(404);
  });

  it('does not match a search by its Upstream Reference or id', async () => {
    const a = await givenOrganizationAData();
    asB();

    for (const q of ['shared-ref', a.paymentId, a.attemptId]) {
      for (const path of [
        '/internal/payments',
        '/internal/reviews',
        '/internal/callbacks',
        '/internal/payment-events',
        '/internal/status-transitions',
      ]) {
        const res = await http().get(`${path}?q=${q}`).expect(200);
        expect(res.body.items, `${path}?q=${q}`).toEqual([]);
      }
    }
  });
});

describe('Upstream Reference and Idempotency-Key', () => {
  it('lets two Organizations use the same Upstream Reference', async () => {
    await givenOrganizationAData(); // A already used "shared-ref"
    asB();

    const created = await http()
      .post('/api/payments')
      .send({
        amount: '99000',
        currency: 'VND',
        upstreamReference: 'shared-ref',
      })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(payment.organizationId).toBe(OTHER_ORGANIZATION_ID);
  });

  it('still refuses an Organization reusing its own Upstream Reference', async () => {
    await givenOrganizationAData();
    asA();

    await http()
      .post('/api/payments')
      .send({
        amount: '150000',
        currency: 'VND',
        upstreamReference: 'shared-ref',
      })
      .expect(409);
  });

  it('keeps Idempotency-Keys apart: a key used by A is free in B', async () => {
    asA();
    await http()
      .post('/api/payments')
      .set('Idempotency-Key', 'same-key')
      .send({ amount: '1000', currency: 'VND', upstreamReference: 'a-1' })
      .expect(201);
    asB();

    const res = await http()
      .post('/api/payments')
      .set('Idempotency-Key', 'same-key')
      .send({ amount: '2000', currency: 'VND', upstreamReference: 'b-1' })
      .expect(201);

    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body.upstreamReference).toBe('b-1');
  });
});

describe('the Organization scope', () => {
  it('never comes from the request: a body or query parameter cannot choose it', async () => {
    await givenOrganizationAData();
    asB();

    const created = await http()
      .post(`/api/payments?organizationId=${DEFAULT_ORGANIZATION_ID}`)
      .send({
        amount: '5000',
        currency: 'VND',
        upstreamReference: 'sneaky',
        organizationId: DEFAULT_ORGANIZATION_ID,
      })
      .expect((res) => {
        // Unknown body keys are rejected or ignored; either way not A's.
        expect([201, 400]).toContain(res.status);
      });
    if (created.status === 201) {
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: created.body.id as string },
      });
      expect(payment.organizationId).toBe(OTHER_ORGANIZATION_ID);
    }
    const listed = await http()
      .get(`/internal/payments?organizationId=${DEFAULT_ORGANIZATION_ID}`)
      .expect((res) => {
        expect([200, 400]).toContain(res.status);
      });
    if (listed.status === 200) {
      expect(
        (listed.body.items as { upstreamReference: string }[]).map(
          (p) => p.upstreamReference,
        ),
      ).not.toContain('shared-ref');
    }
  });
});
