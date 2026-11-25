import { GatewayManager } from '../../src/payment-core/gateway-manager/gateway-manager.js';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module.js';
import { PrismaModule } from '../../src/database/prisma.module.js';
import {
  FakeGatewayPlugin,
  type FakeCallbackPayload,
} from '../../src/gateways/fake/fake-gateway.plugin.js';
import { GatewaysModule } from '../../src/gateways/gateways.module.js';
import { PaymentService } from '../../src/payment-core/application/payment.service.js';
import { ExpirePayment } from '../../src/payment-core/application/workers/expire-payment.js';
import { ProcessWebhook } from '../../src/payment-core/application/workers/process-webhook.js';
import { Clock, FakeClock } from '../../src/payment-core/domain/clock.js';
import { PaymentNotPendingError } from '../../src/payment-core/domain/errors.js';
import { newId } from '../../src/payment-core/domain/ids.js';
import type { Payment } from '../../src/payment-core/domain/payment.js';
import { GatewayManagerModule } from '../../src/payment-core/gateway-manager/gateway-manager.module.js';
import { TransactionRunner } from '../../src/payment-core/infrastructure/prisma/transaction-runner.js';
import { isUniqueViolation } from '../../src/payment-core/infrastructure/prisma/unique-violation.js';
import { PaymentCoreModule } from '../../src/payment-core/payment-core.module.js';
import { resetDatabase } from '../setup/reset-db.js';
import { createTestPrismaClient } from '../setup/test-prisma.js';

// Ticket 31: the locking rules, proven with two real connections. Competing
// operations (webhook, expiry, merchant cancel, start attempt) race on one
// Payment against PostgreSQL; the invariants must hold whichever wins.

const NOW = new Date('2026-05-01T10:00:00.000Z');
const DEADLINE = new Date('2026-05-01T10:30:00.000Z');
const RETURN_URL = 'https://shop.example/return';
const ACK = { httpStatus: 200, body: { ok: true } } as const;
const OPEN = ['CREATED', 'PENDING'];
const prisma = createTestPrismaClient();
const clock = new FakeClock(NOW);
let moduleRef: TestingModule;
let service: PaymentService;
let worker: ProcessWebhook;
let expirePayment: ExpirePayment;
let runner: TransactionRunner;
let fake: FakeGatewayPlugin;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      PrismaModule,
      GatewayManagerModule.forRoot({ imports: [GatewaysModule] }),
      PaymentCoreModule,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  await moduleRef.init();
  service = moduleRef.get(PaymentService);
  worker = moduleRef.get(ProcessWebhook);
  expirePayment = moduleRef.get(ExpirePayment);
  runner = moduleRef.get(TransactionRunner);
  fake = moduleRef
    .get(GatewayManager, { strict: false })
    .resolve('fake') as FakeGatewayPlugin;
});

afterAll(async () => {
  await moduleRef.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(NOW);
  fake.reset();
  await resetDatabase(prisma);
});

// --- helpers ---------------------------------------------------------------

/** A promise that a test resolves by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/** Sessions of this database currently blocked waiting for a lock. */
async function lockWaiters(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND wait_event_type = 'Lock'`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Sessions of this database sitting in a transaction that is doing nothing
 * (`idle in transaction`): what a transaction held open across a gateway call
 * looks like.
 */
async function idleInTransaction(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND state LIKE 'idle in transaction%'`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Holds the row lock on a Payment from a second connection until released,
 * as any competing transition would while it works.
 */
async function holdPaymentLock(paymentId: string) {
  const locked = gate();
  const release = gate();
  const done = runner.run(async (repos) => {
    await repos.payments.findForUpdate(paymentId);
    locked.open();
    await release.promise;
  });
  await locked.promise;
  return { release: release.open, done };
}

async function createPayment(): Promise<Payment> {
  const { payment } = await service.createPayment({
    amount: '150000',
    currency: 'VND',
    upstreamReference: `order-${newId()}`,
  });
  return payment;
}

function startAttempt(paymentId: string) {
  return service.startAttempt({
    paymentId,
    gatewayId: fake.gatewayId,
    returnUrl: RETURN_URL,
  });
}

async function pendingAttempt(): Promise<{
  payment: Payment;
  attemptId: string;
}> {
  const payment = await createPayment();
  const { attempt } = await startAttempt(payment.id);
  expect(attempt.status).toBe('PENDING');
  return { payment, attemptId: attempt.id };
}

async function storeSuccessCallback(
  attemptKey: string,
  payload: Partial<FakeCallbackPayload> = {},
): Promise<string> {
  const callback = fake.signedCallback({
    attemptKey,
    status: 'SUCCEEDED',
    amount: '150000',
    ...payload,
  });
  const { entry } = await runner.repositories.webhookInbox.record({
    gatewayId: fake.gatewayId,
    dedupeKey: newId(),
    attemptKey,
    rawBody: callback.rawBody,
    headers: callback.headers,
    query: callback.query,
  });
  return entry.id;
}

const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id } });
const attemptRows = (paymentId: string) =>
  prisma.paymentTransaction.findMany({
    where: { paymentId },
    orderBy: { id: 'asc' },
  });

/** Invariants that must hold after any race. */
async function expectConsistent(paymentId: string) {
  const payment = await paymentRow(paymentId);
  const attempts = await attemptRows(paymentId);
  const open = attempts.filter((a) => OPEN.includes(a.status));
  const succeeded = attempts.filter((a) => a.status === 'SUCCEEDED');
  expect(open.length).toBeLessThanOrEqual(1);
  expect(succeeded.length).toBeLessThanOrEqual(1);
  if (payment.status === 'SUCCEEDED') {
    expect(succeeded).toHaveLength(1);
    expect(open).toHaveLength(0);
  } else {
    expect(succeeded).toHaveLength(0);
  }
  if (payment.status !== 'PENDING') expect(open).toHaveLength(0);
  // The Payment moved to at most one of SUCCEEDED / EXPIRED, never both.
  const terminal = await prisma.statusTransition.findMany({
    where: {
      entityType: 'PAYMENT',
      entityId: paymentId,
      toStatus: { in: ['SUCCEEDED', 'EXPIRED'] },
    },
  });
  expect(terminal.length).toBeLessThanOrEqual(1);
  return { payment, attempts };
}

// --- tests -----------------------------------------------------------------

describe('Payment lock', () => {
  it('serialises two competing transitions: the second waits for the first to commit', async () => {
    const payment = await createPayment();
    const first = await holdPaymentLock(payment.id);

    let settled = false;
    const second = service.cancelPayment(payment.id).finally(() => {
      settled = true;
    });
    // The second transition is blocked on the row lock, on its own connection.
    await eventually(async () => (await lockWaiters()) >= 1, 'cancel to wait');
    await sleep(100);
    expect(settled).toBe(false);
    expect((await paymentRow(payment.id)).status).toBe('PENDING');

    first.release();
    await first.done;
    expect((await second).status).toBe('CANCELLED');
    expect(await lockWaiters()).toBe(0);
  });

  it('lets the second transition see what the first committed', async () => {
    const payment = await createPayment();
    const locked = gate();
    const release = gate();
    // First: expires the Payment under the lock, commits after the release.
    const first = runner.run(async (repos) => {
      const p = await repos.payments.findForUpdate(payment.id);
      locked.open();
      await release.promise;
      await repos.payments.update(p!.id, { status: 'EXPIRED' });
    });
    await locked.promise;

    const second = service.cancelPayment(payment.id).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await eventually(async () => (await lockWaiters()) >= 1, 'cancel to wait');
    release.open();
    await first;

    // The cancel read EXPIRED, not the stale PENDING it started beside.
    expect(await second).toBeInstanceOf(PaymentNotPendingError);
    expect((await paymentRow(payment.id)).status).toBe('EXPIRED');
  });
});

describe('webhook success racing expiry', () => {
  it('a success that lands while expiry queries the provider wins; the Payment is never EXPIRED', async () => {
    const { payment, attemptId } = await pendingAttempt();
    clock.set(DEADLINE);
    const queryStarted = gate();
    const queryRelease = gate();
    // The provider still says PENDING when expiry asks, but only after the
    // webhook has been applied.
    fake.scriptQuery(async (input) => {
      queryStarted.open();
      await queryRelease.promise;
      return {
        status: 'PENDING',
        amount: '150000',
        rawPayload: { attemptKey: input.attemptKey },
      };
    });

    const expiry = expirePayment.execute(payment.id);
    await queryStarted.promise;
    const inboxId = await storeSuccessCallback(attemptId, {
      providerRef: 'p1',
    });
    expect(await worker.execute(inboxId)).toBe('processed');
    queryRelease.open();

    expect(await expiry).toBe('not-pending');
    const { payment: after, attempts } = await expectConsistent(payment.id);
    expect(after.status).toBe('SUCCEEDED');
    expect(attempts.map((a) => a.status)).toEqual(['SUCCEEDED']);
  });

  it('expiry that commits first leaves the late success in review, never SUCCEEDED over EXPIRED', async () => {
    const { payment, attemptId } = await pendingAttempt();
    clock.set(DEADLINE);
    const inboxId = await storeSuccessCallback(attemptId, {
      providerRef: 'p1',
    });
    const parsing = gate();
    const parseRelease = gate();
    // The webhook worker is mid-flight (parsing, no transaction) while expiry runs.
    fake.scriptParseCallback(async () => {
      parsing.open();
      await parseRelease.promise;
      return {
        attemptKey: attemptId,
        status: 'SUCCEEDED',
        amount: '150000',
        providerRef: 'p1',
        ack: ACK,
      };
    });

    const webhook = worker.execute(inboxId);
    await parsing.promise;
    expect(await expirePayment.execute(payment.id)).toBe('expired');
    parseRelease.open();
    expect(await webhook).toBe('processed');

    const { payment: after } = await expectConsistent(payment.id);
    expect(after.status).toBe('EXPIRED');
    const attempts = await attemptRows(payment.id);
    expect(attempts.map((a) => a.status)).toEqual(['REQUIRES_REVIEW']);
  });

  it('stays consistent when both run truly concurrently, over repeated races', async () => {
    for (let round = 0; round < 8; round++) {
      fake.reset();
      const { payment, attemptId } = await pendingAttempt();
      clock.set(DEADLINE);
      const inboxId = await storeSuccessCallback(attemptId, {
        providerRef: `p-${round}`,
      });

      const [expiry, webhook] = await Promise.all([
        expirePayment.execute(payment.id),
        worker.execute(inboxId),
      ]);

      expect(webhook).toBe('processed');
      expect(['expired', 'succeeded', 'not-pending']).toContain(expiry);
      const { payment: after } = await expectConsistent(payment.id);
      expect(['SUCCEEDED', 'EXPIRED']).toContain(after.status);
      clock.set(NOW);
    }
  });
});

describe('merchant cancel racing start attempt', () => {
  it('blocked on the same lock, both run in turn and at most one attempt is open', async () => {
    const payment = await createPayment();
    const holder = await holdPaymentLock(payment.id);

    const cancel = service.cancelPayment(payment.id).then(
      () => 'cancelled',
      () => 'rejected',
    );
    const start = startAttempt(payment.id).then(
      () => 'started',
      () => 'rejected',
    );
    await eventually(async () => (await lockWaiters()) >= 2, 'both to wait');

    holder.release();
    await holder.done;
    const [, started] = await Promise.all([cancel, start]);

    const { payment: after, attempts } = await expectConsistent(payment.id);
    expect(after.status).toBe('CANCELLED');
    if (started === 'rejected') {
      // Cancel won: no attempt was created on a cancelled Payment.
      expect(attempts).toHaveLength(0);
    } else {
      // Start won, then cancel closed its attempt.
      expect(attempts.map((a) => a.status)).toEqual(['CANCELLED']);
    }
  });

  it('a cancel that lands during the gateway call keeps the Payment cancelled and the attempt closed', async () => {
    const payment = await createPayment();
    const initiating = gate();
    const initiateRelease = gate();
    fake.scriptInitiate(async (input) => {
      initiating.open();
      await initiateRelease.promise;
      return {
        nextAction: { type: 'REDIRECT', url: 'https://fake-gateway.test/pay' },
        providerMetadata: {},
        rawPayload: { attemptKey: input.attemptKey },
      };
    });

    const start = startAttempt(payment.id);
    await initiating.promise;
    const cancelled = await service.cancelPayment(payment.id);
    expect(cancelled.status).toBe('CANCELLED');
    initiateRelease.open();
    await start;

    const { payment: after, attempts } = await expectConsistent(payment.id);
    expect(after.status).toBe('CANCELLED');
    expect(attempts.map((a) => a.status)).toEqual(['CANCELLED']);
  });

  it('never leaves an open attempt on a cancelled Payment, over repeated races', async () => {
    for (let round = 0; round < 10; round++) {
      fake.reset();
      const payment = await createPayment();
      await Promise.allSettled([
        service.cancelPayment(payment.id),
        startAttempt(payment.id),
        startAttempt(payment.id),
      ]);
      const { payment: after } = await expectConsistent(payment.id);
      expect(after.status).toBe('CANCELLED');
    }
  });

  it('two concurrent start attempts leave exactly one open attempt', async () => {
    const payment = await createPayment();
    await Promise.all([startAttempt(payment.id), startAttempt(payment.id)]);
    const attempts = await attemptRows(payment.id);
    expect(attempts.filter((a) => OPEN.includes(a.status))).toHaveLength(1);
    expect(attempts.filter((a) => a.status === 'CANCELLED')).toHaveLength(1);
  });
});

describe('one open attempt per Payment (database partial index)', () => {
  it('rejects a second open attempt inserted concurrently from another connection', async () => {
    const payment = await createPayment();
    const inserted = gate();
    const commit = gate();
    // Connection A inserts an open attempt and holds its transaction open.
    const first = runner.run(async (repos) => {
      await repos.payments.createAttempt({
        id: newId(),
        paymentId: payment.id,
        gatewayId: fake.gatewayId,
        status: 'CREATED',
      });
      inserted.open();
      await commit.promise;
    });
    await inserted.promise;

    // Connection B, with no Payment lock, tries to open another: it waits for
    // A's uncommitted row, then fails on the partial unique index.
    const second = runner
      .run((repos) =>
        repos.payments.createAttempt({
          id: newId(),
          paymentId: payment.id,
          gatewayId: fake.gatewayId,
          status: 'PENDING',
        }),
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    await eventually(async () => (await lockWaiters()) >= 1, 'insert to wait');
    commit.open();
    await first;

    expect(isUniqueViolation(await second)).toBe(true);
    expect(await attemptRows(payment.id)).toHaveLength(1);
  });

  it('lets exactly one of many simultaneous inserts through', async () => {
    const payment = await createPayment();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        runner.run((repos) =>
          repos.payments.createAttempt({
            id: newId(),
            paymentId: payment.id,
            gatewayId: fake.gatewayId,
            status: 'CREATED',
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(isUniqueViolation(r.reason)).toBe(true);
      }
    }
    expect(await attemptRows(payment.id)).toHaveLength(1);
  });
});

describe('no transaction open during a gateway call', () => {
  /**
   * Runs `act` with the scripted gateway call blocked and checks that no
   * session of the database sits idle inside a transaction meanwhile.
   * `install` receives the hook the scripted step must await first.
   */
  async function duringGatewayCall(
    install: (hook: () => Promise<void>) => void,
    act: () => Promise<unknown>,
  ) {
    const inCall = gate();
    const release = gate();
    install(async () => {
      inCall.open();
      await release.promise;
    });
    const running = act();
    await inCall.promise;
    await sleep(100);
    const idle = await idleInTransaction();
    release.open();
    await running;
    expect(idle).toBe(0);
  }

  it('initiate (start attempt)', async () => {
    const payment = await createPayment();
    await duringGatewayCall(
      (hook) =>
        fake.scriptInitiate(async (input) => {
          await hook();
          return {
            nextAction: {
              type: 'REDIRECT',
              url: 'https://fake-gateway.test/pay',
            },
            providerMetadata: {},
            rawPayload: { attemptKey: input.attemptKey },
          };
        }),
      () => startAttempt(payment.id),
    );
    expect((await attemptRows(payment.id))[0]?.status).toBe('PENDING');
  });

  it('query (expiry)', async () => {
    const { payment } = await pendingAttempt();
    clock.set(DEADLINE);
    await duringGatewayCall(
      (hook) =>
        fake.scriptQuery(async () => {
          await hook();
          return { status: 'PENDING', amount: '150000', rawPayload: {} };
        }),
      () => expirePayment.execute(payment.id),
    );
    expect((await paymentRow(payment.id)).status).toBe('EXPIRED');
  });

  it('parseCallback (webhook processing)', async () => {
    const { payment, attemptId } = await pendingAttempt();
    const inboxId = await storeSuccessCallback(attemptId);
    await duringGatewayCall(
      (hook) =>
        fake.scriptParseCallback(async () => {
          await hook();
          return {
            attemptKey: attemptId,
            status: 'SUCCEEDED',
            amount: '150000',
            ack: ACK,
          };
        }),
      () => worker.execute(inboxId),
    );
    expect((await paymentRow(payment.id)).status).toBe('SUCCEEDED');
  });

  it('cancel (merchant cancel, provider side)', async () => {
    const { payment } = await pendingAttempt();
    await duringGatewayCall(
      (hook) =>
        fake.scriptCancel(async () => {
          await hook();
          return { rawPayload: {} };
        }),
      () => service.cancelPayment(payment.id),
    );
    expect((await paymentRow(payment.id)).status).toBe('CANCELLED');
  });
});
