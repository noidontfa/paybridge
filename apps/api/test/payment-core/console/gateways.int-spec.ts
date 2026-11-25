// ConfigModule reads the environment when AppModule is imported, so the public
// base URL must be set before the imports below run.
vi.hoisted(() => {
  process.env.PUBLIC_BASE_URL = 'https://pay.example.com/';
});

import { runSeed } from '../../../seed/seed.js';
import { testDatabaseUrl } from '../../setup/test-database.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { newId } from '../../../src/payment-core/domain/ids.js';
import {
  gatewayDetailSchema,
  gatewayListSchema,
} from '../../contract/console/gateways.js';
import { createConsoleApp, type ConsoleApp } from '../../setup/console-app.js';
import { resetDatabase } from '../../setup/reset-db.js';
import { createTestPrismaClient } from '../../setup/test-prisma.js';
import { DEFAULT_ORGANIZATION_ID } from '../../setup/organizations.js';

// Ticket 06: GET /internal/gateways and /internal/gateways/:id over HTTP on
// real PostgreSQL. Responses are parsed with the Console's copied schemas.

const prisma = createTestPrismaClient();
const HOUR = 3_600_000;

type InboxStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

async function insertCallback(
  gatewayId: string,
  status: InboxStatus,
  receivedAt: Date,
): Promise<void> {
  await prisma.webhookInbox.create({
    data: {
      id: newId(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      gatewayId,
      dedupeKey: newId(),
      rawBody: Buffer.from('{}'),
      headers: {},
      query: {},
      status,
      receivedAt,
    },
  });
}

/** A Payment with one PaymentTransaction on each of the given gateways. */
async function insertPaymentOn(...gatewayIds: string[]): Promise<void> {
  const paymentId = newId();
  const now = new Date();
  await prisma.payment.create({
    data: {
      id: paymentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      merchantOrderId: `GW-${paymentId}`,
      amount: new Prisma.Decimal('1000'),
      currency: 'VND',
      status: 'PENDING',
      expiresAt: new Date(now.getTime() + HOUR),
    },
  });
  for (const [i, gatewayId] of gatewayIds.entries()) {
    await prisma.paymentTransaction.create({
      data: {
        id: newId(),
        organizationId: DEFAULT_ORGANIZATION_ID,
        paymentId,
        gatewayId,
        status: i === gatewayIds.length - 1 ? 'CREATED' : 'CANCELLED',
        createdAt: new Date(now.getTime() + i),
      },
    });
  }
}

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_gateways_spec',
  STRIPE_WEBHOOK_SECRET: 'whsec_gateways_spec',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_gateways_spec',
} as const;

describe('gateways without Stripe configured', () => {
  let api: ConsoleApp;
  beforeAll(async () => {
    api = await createConsoleApp();
  });
  afterAll(async () => {
    await api.app.close();
  });
  beforeEach(() => resetDatabase(prisma));

  it('lists the registered fake gateway as test mode with its Callback URL', async () => {
    const list = await api.getValid('/internal/gateways', gatewayListSchema);
    expect(list.items).toEqual([
      {
        id: 'fake',
        registered: true,
        configured: true,
        mode: 'test',
        callbackUrl: 'https://pay.example.com/api/webhooks/fake',
      },
    ]);
  });

  it('also lists a gateway that holds data but has no plugin, as unregistered', async () => {
    await insertPaymentOn('stripe', 'fake');
    const list = await api.getValid('/internal/gateways', gatewayListSchema);
    expect(list.items.map((g) => [g.id, g.registered, g.configured])).toEqual([
      ['fake', true, true],
      ['stripe', false, false],
    ]);
    expect(list.items.every((g) => g.mode === 'test')).toBe(true);
  });

  it('detail counts the last 24 hours of Callbacks by status, every status present', async () => {
    const now = Date.now();
    await insertCallback('fake', 'PROCESSED', new Date(now - 1 * HOUR));
    await insertCallback('fake', 'PROCESSED', new Date(now - 3 * HOUR));
    await insertCallback('fake', 'FAILED', new Date(now - 2 * HOUR));
    await insertCallback('fake', 'PROCESSED', new Date(now - 30 * HOUR));
    await insertCallback('stripe', 'RECEIVED', new Date(now - HOUR));
    const detail = await api.getValid(
      '/internal/gateways/fake',
      gatewayDetailSchema,
    );
    expect(detail.callbackCounts).toEqual({
      RECEIVED: 0,
      PROCESSING: 0,
      PROCESSED: 2,
      FAILED: 1,
    });
    expect(detail.lastCallbackAt).toBe(new Date(now - 1 * HOUR).toISOString());
    expect(detail.recentErrors).toEqual([]);
    expect(detail.id).toBe('fake');
  });

  it('detail of a gateway with no Callbacks has zero counts and no last time', async () => {
    const detail = await api.getValid(
      '/internal/gateways/fake',
      gatewayDetailSchema,
    );
    expect(detail.callbackCounts).toEqual({
      RECEIVED: 0,
      PROCESSING: 0,
      PROCESSED: 0,
      FAILED: 0,
    });
    expect(detail.lastCallbackAt).toBeNull();
  });

  it('last Callback time ignores Callbacks older than 24 hours', async () => {
    const at = new Date(Date.now() - 48 * HOUR);
    await insertCallback('fake', 'PROCESSED', at);
    const detail = await api.getValid(
      '/internal/gateways/fake',
      gatewayDetailSchema,
    );
    expect(detail.lastCallbackAt).toBeNull();
    expect(detail.callbackCounts.PROCESSED).toBe(0);
  });

  it('serves the detail of an unregistered gateway that holds data', async () => {
    await insertCallback('stripe', 'FAILED', new Date());
    const detail = await api.getValid(
      '/internal/gateways/stripe',
      gatewayDetailSchema,
    );
    expect(detail.registered).toBe(false);
    expect(detail.callbackCounts.FAILED).toBe(1);
  });

  it('shows both seeded gateways, each with Callback counts', async () => {
    await runSeed({
      databaseUrl: testDatabaseUrl(),
      nodeEnv: 'test',
      now: new Date(),
    });
    const list = await api.getValid('/internal/gateways', gatewayListSchema);
    expect(list.items.map((g) => g.id)).toEqual(['fake', 'stripe']);
    for (const id of ['fake', 'stripe']) {
      const detail = await api.getValid(
        `/internal/gateways/${id}`,
        gatewayDetailSchema,
      );
      expect(detail.lastCallbackAt).not.toBeNull();
    }
  });

  it('returns 404 GATEWAY_NOT_FOUND for an unknown id', async () => {
    const res = await api.get('/internal/gateways/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('GATEWAY_NOT_FOUND');
  });
});

describe('gateways with Stripe configured', () => {
  let api: ConsoleApp;
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    for (const [k, v] of Object.entries(STRIPE_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    api = await createConsoleApp();
  });
  afterAll(async () => {
    await api.app.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  beforeEach(() => resetDatabase(prisma));

  it('lists both gateways, derives Stripe mode from the key, and never leaks a credential', async () => {
    const res = await api.get('/internal/gateways');
    const list = gatewayListSchema.parse(res.body);
    expect(list.items).toEqual([
      {
        id: 'fake',
        registered: true,
        configured: true,
        mode: 'test',
        callbackUrl: 'https://pay.example.com/api/webhooks/fake',
      },
      {
        id: 'stripe',
        registered: true,
        configured: true,
        mode: 'test',
        callbackUrl: 'https://pay.example.com/api/webhooks/stripe',
      },
    ]);
    const detail = await api.get('/internal/gateways/stripe');
    for (const secret of Object.values(STRIPE_ENV).slice(0, 3)) {
      expect(JSON.stringify(res.body)).not.toContain(secret);
      expect(JSON.stringify(detail.body)).not.toContain(secret);
    }
  });
});
