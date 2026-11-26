import type { INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { ACCESS_POLICY_KEY } from '../../src/common/principal/access-policy.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { AccessTokenService } from '../../src/identity/port/access-token.service.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import {
  Clock,
  FakeClock,
} from '../../src/payment-core/domain/services/clock.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import {
  organizationScope,
  type OrganizationScope,
} from '../../src/payment-core/domain/value-objects/organization-scope.js';
import { TransactionRunner } from '../../src/payment-core/domain/repositories/transaction-runner.js';
import { apiErrorBodySchema } from '../contract/console/schemas.js';
import { createOrganization, defaultScope } from '../setup/organizations.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';
import { signedInHttp, type SignedInHttp } from '../setup/users.js';

// Ticket 05: Permissions, sensitive writes and the Super Admin's scope, over
// HTTP on real PostgreSQL.

const HOUR = 60 * 60 * 1000;
const OPENED = new Date('2026-05-01T10:00:00.000Z');
const prisma = createTestPrismaClient();
const clock = new FakeClock(new Date(OPENED.getTime() + 73 * HOUR));
let app: INestApplication;
let moduleRef: TestingModule;
let service: PaymentService;
let runner: TransactionRunner;
let tokens: AccessTokenService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();
  service = moduleRef.get(PaymentService);
  runner = moduleRef.get(TransactionRunner);
  tokens = moduleRef.get(AccessTokenService);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  clock.set(new Date(OPENED.getTime() + 73 * HOUR));
  await resetDatabase(prisma);
});

async function seedReview(scope: OrganizationScope = defaultScope) {
  const { payment } = await service.createPayment(scope, {
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  const attemptId = newId();
  await runner.run(async (tx) => {
    await tx.payments.createAttempt(scope, {
      id: attemptId,
      paymentId: payment.id,
      gatewayId: 'fake',
      status: 'REQUIRES_REVIEW',
    });
    await tx.payments.updateAttempt(scope, attemptId, {
      reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
      reviewOpenedAt: OPENED,
      refundRequired: true,
    });
  });
  return { paymentId: payment.id, attemptId };
}

const resolveBody = (attemptId: string) => ({
  attemptId,
  note: 'checked with the provider',
  status: 'FAILED',
});

const attemptStatus = async (id: string) =>
  (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } })).status;

function withOrg(call: request.Test, organization: string): request.Test {
  return call.set('X-Organization-Id', organization);
}

describe('Role to Permission map', () => {
  it.each([
    ['OPERATOR', ['payments:view', 'reviews:resolve']],
    [
      'ORGANIZATION_ADMIN',
      [
        'payments:view',
        'reviews:resolve',
        'users:manage',
        'api-keys:manage',
        'gateway-connections:manage',
      ],
    ],
    [
      'SUPER_ADMIN',
      [
        'payments:view',
        'reviews:resolve',
        'users:manage',
        'api-keys:manage',
        'gateway-connections:manage',
        'organizations:manage',
        'super-admins:manage',
      ],
    ],
  ] as const)('%s holds exactly its Permissions', async (role, expected) => {
    const user = await signedInHttp(app, prisma, { role });
    const me = await user.get('/internal/auth/me').expect(200);
    expect([...(me.body.permissions as string[])].sort()).toEqual(
      [...expected].sort(),
    );
  });
});

describe('every /internal route names a Permission', () => {
  it('declares a Permission, or is explicitly public or session-only', () => {
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const reflector = moduleRef.get(Reflector);
    const undeclared: string[] = [];
    let routes = 0;
    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const path = String(Reflect.getMetadata('path', metatype));
      if (!path.startsWith('internal')) continue;
      const proto = Object.getPrototypeOf(instance) as Record<
        string,
        () => unknown
      >;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name]!;
        if (Reflect.getMetadata('method', handler) === undefined) continue;
        routes += 1;
        const isPublic = reflector.getAllAndOverride('identity:public', [
          handler,
          metatype,
        ]);
        const policy = reflector.getAllAndOverride(ACCESS_POLICY_KEY, [
          handler,
          metatype,
        ]);
        if (!isPublic && !policy) undeclared.push(`${metatype.name}.${name}`);
      }
    }
    expect(routes).toBeGreaterThan(10);
    expect(undeclared).toEqual([]);
  });
});

describe('refusals', () => {
  it('refuses a token without the Permission, with the standard envelope', async () => {
    const user = await signedInHttp(app, prisma);
    const token = tokens.sign(
      {
        userId: user.user.id,
        role: 'OPERATOR',
        organizationId: user.user.organizationId,
        permissions: [],
      },
      new Date(),
    );
    const res = await request(app.getHttpServer())
      .get('/internal/payments')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(apiErrorBodySchema.parse(res.body).statusCode).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('refuses resolving a Review without reviews:resolve, leaving it open', async () => {
    const { paymentId, attemptId } = await seedReview();
    const user = await signedInHttp(app, prisma);
    const token = tokens.sign(
      {
        userId: user.user.id,
        role: 'OPERATOR',
        organizationId: user.user.organizationId,
        permissions: ['payments:view'],
      },
      new Date(),
    );
    await request(app.getHttpServer())
      .post(`/internal/payments/${paymentId}/review-resolution`)
      .set('Authorization', `Bearer ${token}`)
      .send(resolveBody(attemptId))
      .expect(403);
    expect(await attemptStatus(attemptId)).toBe('REQUIRES_REVIEW');
  });
});

describe('resolving a Review is a sensitive write', () => {
  it('is refused at once after the User is deactivated, while reads still work', async () => {
    const { paymentId, attemptId } = await seedReview();
    const operator = await signedInHttp(app, prisma);
    await prisma.user.update({
      where: { id: operator.user.id },
      data: { active: false },
    });

    const res = await operator
      .post(`/internal/payments/${paymentId}/review-resolution`)
      .send(resolveBody(attemptId))
      .expect(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
    expect(await attemptStatus(attemptId)).toBe('REQUIRES_REVIEW');
    await operator.get('/internal/reviews').expect(200);
  });

  it('is refused at once after the Role changed since the token was issued', async () => {
    const { paymentId, attemptId } = await seedReview();
    const admin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
    });
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { role: 'OPERATOR' },
    });

    const res = await admin
      .post(`/internal/payments/${paymentId}/review-resolution`)
      .send(resolveBody(attemptId))
      .expect(403);
    expect(res.body.code).toBe('ROLE_CHANGED');
    expect(await attemptStatus(attemptId)).toBe('REQUIRES_REVIEW');
  });

  it('is refused at once after the Organization is suspended', async () => {
    const { paymentId, attemptId } = await seedReview();
    const operator = await signedInHttp(app, prisma);
    await prisma.organization.update({
      where: { id: operator.user.organizationId! },
      data: { status: 'SUSPENDED' },
    });

    try {
      const res = await operator
        .post(`/internal/payments/${paymentId}/review-resolution`)
        .send(resolveBody(attemptId))
        .expect(403);
      expect(res.body.code).toBe('ORGANIZATION_SUSPENDED');
      expect(await attemptStatus(attemptId)).toBe('REQUIRES_REVIEW');
    } finally {
      await prisma.organization.update({
        where: { id: operator.user.organizationId! },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('succeeds for an active User of an active Organization', async () => {
    const { paymentId, attemptId } = await seedReview();
    const operator = await signedInHttp(app, prisma);
    await operator
      .post(`/internal/payments/${paymentId}/review-resolution`)
      .send(resolveBody(attemptId))
      .expect(200);
  });
});

describe('Super Admin scope', () => {
  let other: string;
  let superAdmin: SignedInHttp;
  beforeEach(async () => {
    other = await createOrganization(prisma, 'Other');
    superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
  });

  it('reads one chosen Organization or all Organizations', async () => {
    await seedReview(defaultScope);
    await seedReview(organizationScope(other));

    const one = await withOrg(
      superAdmin.get('/internal/reviews'),
      other,
    ).expect(200);
    expect(one.body.items).toHaveLength(1);
    const all = await withOrg(
      superAdmin.get('/internal/reviews'),
      'all',
    ).expect(200);
    expect(all.body.items).toHaveLength(2);
    const summary = await withOrg(
      superAdmin.get('/internal/reviews/summary'),
      'all',
    ).expect(200);
    expect(summary.body.open).toBe(2);
  });

  it('refuses a read that chooses nothing, and a malformed choice', async () => {
    const none = await superAdmin.get('/internal/reviews').expect(403);
    expect(none.body.code).toBe('ORGANIZATION_REQUIRED');
    await withOrg(superAdmin.get('/internal/reviews'), 'not-a-uuid').expect(
      400,
    );
  });

  it('refuses a write that does not choose exactly one Organization', async () => {
    const { paymentId, attemptId } = await seedReview(organizationScope(other));
    const url = `/internal/payments/${paymentId}/review-resolution`;
    await superAdmin.post(url).send(resolveBody(attemptId)).expect(403);
    const all = await withOrg(superAdmin.post(url), 'all')
      .send(resolveBody(attemptId))
      .expect(403);
    expect(all.body.code).toBe('ORGANIZATION_REQUIRED');
    expect(await attemptStatus(attemptId)).toBe('REQUIRES_REVIEW');
  });

  it('resolves a Review in any Organization, labelled as the platform', async () => {
    const { paymentId, attemptId } = await seedReview(organizationScope(other));
    await withOrg(
      superAdmin.post(`/internal/payments/${paymentId}/review-resolution`),
      other,
    )
      .send(resolveBody(attemptId))
      .expect(200);

    const orgAdmin = await signedInHttp(app, prisma, {
      role: 'ORGANIZATION_ADMIN',
      organizationId: other,
    });
    const audit = await orgAdmin
      .get('/internal/status-transitions')
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      actor: superAdmin.user.id,
      actorRole: 'SUPER_ADMIN',
      actorLabel: 'Super Admin (PayBridge)',
      actorName: 'Test SUPER_ADMIN',
      reason: 'checked with the provider',
    });
  });

  it('still acts in a suspended Organization', async () => {
    const { paymentId, attemptId } = await seedReview(organizationScope(other));
    await prisma.organization.update({
      where: { id: other },
      data: { status: 'SUSPENDED' },
    });
    await withOrg(
      superAdmin.post(`/internal/payments/${paymentId}/review-resolution`),
      other,
    )
      .send(resolveBody(attemptId))
      .expect(200);
  });

  it('never lets a non-Super Admin choose another Organization', async () => {
    await seedReview(organizationScope(other));
    const operator = await signedInHttp(app, prisma);
    const one = await withOrg(operator.get('/internal/reviews'), other).expect(
      200,
    );
    expect(one.body.items).toHaveLength(0);
    const all = await withOrg(operator.get('/internal/reviews'), 'all').expect(
      200,
    );
    expect(all.body.items).toHaveLength(0);
  });

  it.each(['OPERATOR', 'ORGANIZATION_ADMIN'] as const)(
    'keeps a %s in their own Organization whatever header they send',
    async (role) => {
      const own = await seedReview(defaultScope);
      const foreign = await seedReview(organizationScope(other));
      const user = await signedInHttp(app, prisma, { role });
      for (const header of [other, 'all', 'not-an-id']) {
        const read = await withOrg(
          user.get('/internal/reviews'),
          header,
        ).expect(200);
        expect(read.body.items).toHaveLength(1);
      }
      // A write cannot be redirected to another Organization either.
      await withOrg(
        user
          .post(`/internal/payments/${foreign.paymentId}/review-resolution`)
          .send(resolveBody(foreign.attemptId)),
        other,
      ).expect(404);
      expect(await attemptStatus(foreign.attemptId)).toBe('REQUIRES_REVIEW');
      expect(own.attemptId).toBeDefined();
    },
  );
});

describe('GET /internal/organizations (manage Organizations)', () => {
  it('lists Organizations for a Super Admin only', async () => {
    const other = await createOrganization(prisma, 'Listed Organization');
    const superAdmin = await signedInHttp(app, prisma, { role: 'SUPER_ADMIN' });
    const res = await superAdmin.get('/internal/organizations').expect(200);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: other,
          name: 'Listed Organization',
          status: 'ACTIVE',
        }),
      ]),
    );

    for (const role of ['OPERATOR', 'ORGANIZATION_ADMIN'] as const) {
      const user = await signedInHttp(app, prisma, { role });
      const refused = await user.get('/internal/organizations').expect(403);
      expect(refused.body.code).toBe('FORBIDDEN');
    }
  });
});
