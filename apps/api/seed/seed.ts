import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { v5 } from 'uuid';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import {
  callbackSpecs,
  eventSpecs,
  paymentSpecs,
  type PaymentSpec,
  type When,
} from './scenarios.js';

// Database seed (ticket 01). Writes straight to the database, outside Payment
// Core, so it may use the database client and open its own transaction.
//
// Everything it owns is recognisable: Upstream References start with `SEED-`,
// Callback dedupe keys start with `SEED-`, and every id is a UUID v5 derived
// from a fixed name. A re-run deletes exactly those rows and recreates them.

export const SEED_PREFIX = 'SEED-';
const NAMESPACE = 'c3a1e0a0-5eed-4b1d-9c5e-0d5eed5eed01';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'postgres'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CHUNK = 1000;

/** The seed will not run here (production, or a non-local host without force). */
export class SeedRefusedError extends Error {}

export interface SeedOptions {
  databaseUrl: string;
  nodeEnv: string;
  /** Required when the database host is not local. */
  force?: boolean;
  /** Extra bulk Payments for pagination and performance checks. Default 0. */
  bulk?: number;
  /** The moment every offset is relative to. Default: now. */
  now?: Date;
}

export interface SeedResult {
  payments: number;
  attempts: number;
  transitions: number;
  callbacks: number;
  events: number;
}

const id = (name: string): string => v5(name, NAMESPACE);

function assertAllowed(options: SeedOptions): void {
  if (options.nodeEnv === 'production') {
    throw new SeedRefusedError('The seed refuses to run when NODE_ENV=production.');
  }
  const host = new URL(options.databaseUrl).hostname;
  if (!LOCAL_HOSTS.includes(host) && !options.force) {
    throw new SeedRefusedError(
      `The database host "${host}" is not local (${LOCAL_HOSTS.join(', ')}). Pass --force to seed it anyway.`,
    );
  }
}

export async function runSeed(options: SeedOptions): Promise<SeedResult> {
  assertAllowed(options);
  const bulk = options.bulk ?? 0;
  if (!Number.isInteger(bulk) || bulk < 0) {
    throw new SeedRefusedError('The bulk count must be a non-negative integer.');
  }
  const now = (options.now ?? new Date()).getTime();
  const rows = buildRows(now, bulk);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl }),
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        await deleteSeedRows(tx);
        await insertChunked(rows.payments, (data) => tx.payment.createMany({ data }));
        await insertChunked(rows.attempts, (data) =>
          tx.paymentTransaction.createMany({ data }),
        );
        await insertChunked(rows.transitions, (data) =>
          tx.statusTransition.createMany({ data }),
        );
        await insertChunked(rows.callbacks, (data) =>
          tx.webhookInbox.createMany({ data }),
        );
        await insertChunked(rows.events, (data) => tx.outboxEvent.createMany({ data }));
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
  return {
    payments: rows.payments.length,
    attempts: rows.attempts.length,
    transitions: rows.transitions.length,
    callbacks: rows.callbacks.length,
    events: rows.events.length,
  };
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function deleteSeedRows(tx: Tx): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM core_status_transitions WHERE entity_id IN (
      SELECT id FROM core_payments WHERE starts_with(merchant_order_id, ${SEED_PREFIX})
      UNION
      SELECT t.id FROM core_payment_transactions t
        JOIN core_payments p ON p.id = t.payment_id
        WHERE starts_with(p.merchant_order_id, ${SEED_PREFIX}))`;
  await tx.$executeRaw`
    DELETE FROM core_gateway_raw_responses WHERE attempt_id IN (
      SELECT t.id FROM core_payment_transactions t
        JOIN core_payments p ON p.id = t.payment_id
        WHERE starts_with(p.merchant_order_id, ${SEED_PREFIX}))`;
  await tx.$executeRaw`
    DELETE FROM core_outbox_events WHERE payment_id IN (
      SELECT id FROM core_payments WHERE starts_with(merchant_order_id, ${SEED_PREFIX}))`;
  await tx.$executeRaw`
    DELETE FROM core_payment_transactions WHERE payment_id IN (
      SELECT id FROM core_payments WHERE starts_with(merchant_order_id, ${SEED_PREFIX}))`;
  await tx.$executeRaw`
    DELETE FROM core_payments WHERE starts_with(merchant_order_id, ${SEED_PREFIX})`;
  await tx.$executeRaw`
    DELETE FROM core_webhook_inbox WHERE starts_with(dedupe_key, ${SEED_PREFIX})`;
}

async function insertChunked<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK));
  }
}

// --- Row building (pure) ----------------------------------------------------

interface Rows {
  payments: Prisma.PaymentCreateManyInput[];
  attempts: Prisma.PaymentTransactionCreateManyInput[];
  transitions: Prisma.StatusTransitionCreateManyInput[];
  callbacks: Prisma.WebhookInboxCreateManyInput[];
  events: Prisma.OutboxEventCreateManyInput[];
}

function at(now: number, createdAt: number, when: When): Date {
  return new Date(
    'afterMin' in when ? createdAt + when.afterMin * MINUTE : now - when.agoH * HOUR,
  );
}

function buildRows(now: number, bulk: number): Rows {
  const rows: Rows = {
    payments: [],
    attempts: [],
    transitions: [],
    callbacks: [],
    events: [],
  };
  const createdAtOf = new Map<string, number>();
  const attemptIds = new Map<string, string>();

  for (const spec of paymentSpecs()) addPayment(rows, now, spec, createdAtOf, attemptIds);

  for (const [n, spec] of callbackSpecs().entries()) {
    const attemptKey = spec.attempt
      ? attemptIds.get(spec.attempt)!
      : id('attempt:unknown-to-core');
    const body = Buffer.from(
      JSON.stringify({ seed: spec.key, attemptKey, event: `seed.${spec.gateway}.event` }),
    );
    const dedupeKey =
      spec.providerEventId ??
      `${SEED_PREFIX}${createHash('sha256').update(body).digest('hex')}`;
    const receivedAt = new Date(now - spec.receivedAgoH * HOUR);
    rows.callbacks.push({
      id: id(`callback:${spec.key}`),
      gatewayId: spec.gateway,
      dedupeKey,
      providerEventId: spec.providerEventId,
      attemptKey,
      rawBody: body,
      headers: { 'x-seed': String(n + 1) },
      query: {},
      status: spec.status,
      attempts: spec.attempts,
      lockedAt: spec.status === 'PROCESSING' ? receivedAt : null,
      lastError: spec.lastError ?? null,
      receivedAt,
      processedAt: spec.status === 'PROCESSED' ? new Date(receivedAt.getTime() + 2000) : null,
    });
  }

  for (const spec of eventSpecs()) {
    const created = createdAtOf.get(spec.payment)!;
    const payment = paymentSpecs().find((p) => p.key === spec.payment)!;
    const createdAt = at(now, created, spec.when);
    rows.events.push({
      id: id(`event:${spec.key}`),
      eventType: spec.type,
      paymentId: id(`payment:${spec.payment}`),
      payload: {
        paymentId: id(`payment:${spec.payment}`),
        upstreamReference: `${SEED_PREFIX}${spec.payment}`,
        amount: payment.amount,
        currency: 'VND',
        status: payment.status,
      },
      createdAt,
      publishedAt: spec.published ? new Date(createdAt.getTime() + 1000) : null,
    });
  }

  for (let i = 1; i <= bulk; i++) addBulkPayment(rows, now, i);
  return rows;
}

function addPayment(
  rows: Rows,
  now: number,
  spec: PaymentSpec,
  createdAtOf: Map<string, number>,
  attemptIds: Map<string, string>,
): void {
  const paymentId = id(`payment:${spec.key}`);
  const createdAt = now - spec.createdAgoH * HOUR;
  createdAtOf.set(spec.key, createdAt);
  let updatedAt = createdAt;
  const touch = (date: Date) => {
    updatedAt = Math.max(updatedAt, date.getTime());
  };

  rows.transitions.push({
    id: id(`transition:${spec.key}:create`),
    entityType: 'PAYMENT' as const,
    entityId: paymentId,
    fromStatus: null,
    toStatus: 'PENDING',
    trigger: 'create_payment',
    actor: 'merchant',
    reason: null,
    createdAt: new Date(createdAt),
  });
  for (const [n, t] of spec.transitions.entries()) {
    const when = at(now, createdAt, t.when);
    touch(when);
    rows.transitions.push({
      id: id(`transition:${spec.key}:p${n}`),
      entityType: 'PAYMENT' as const,
      entityId: paymentId,
      fromStatus: t.from,
      toStatus: t.to,
      trigger: t.trigger,
      actor: t.actor,
      reason: t.reason ?? null,
      createdAt: when,
    });
  }

  for (const a of spec.attempts) {
    const attemptId = id(`attempt:${spec.key}:${a.key}`);
    attemptIds.set(`${spec.key}/${a.key}`, attemptId);
    const attemptCreated = new Date(createdAt + (a.createdAfterMin ?? 1) * MINUTE);
    let attemptUpdated = attemptCreated.getTime();
    for (const [n, t] of a.transitions.entries()) {
      const when = at(now, createdAt, t.when);
      attemptUpdated = Math.max(attemptUpdated, when.getTime());
      rows.transitions.push({
        id: id(`transition:${spec.key}:${a.key}:${n}`),
        entityType: 'PAYMENT_TRANSACTION',
        entityId: attemptId,
        fromStatus: t.from,
        toStatus: t.to,
        trigger: t.trigger,
        actor: t.actor,
        reason: t.reason ?? null,
        createdAt: when,
      });
    }
    touch(new Date(attemptUpdated));
    const hasProviderRef = a.status !== 'CREATED' && a.status !== 'FAILED';
    rows.attempts.push({
      id: attemptId,
      paymentId,
      gatewayId: a.gateway,
      status: a.status,
      providerRef: hasProviderRef ? `${a.gateway === 'stripe' ? 'pi' : 'fk'}_SEED_${spec.key}_${a.key}` : null,
      providerMetadata: a.review?.providerReportedAmount
        ? { providerReportedAmount: a.review.providerReportedAmount }
        : undefined,
      nextAction: a.nextAction as Prisma.InputJsonObject | undefined,
      reviewReason: a.review?.reason ?? null,
      reviewOpenedAt: a.review ? new Date(now - a.review.openedAgoH * HOUR) : null,
      refundRequired: a.review?.refundRequired ?? false,
      createdAt: attemptCreated,
      updatedAt: new Date(attemptUpdated),
    });
  }

  rows.payments.push({
    id: paymentId,
    merchantOrderId: `${SEED_PREFIX}${spec.key}`,
    amount: spec.amount,
    currency: 'VND',
    status: spec.status,
    expiresAt: new Date(createdAt + DAY),
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  });
}

/** Bulk Payments: one attempt each (none for pending), spread over 30 days. */
function addBulkPayment(rows: Rows, now: number, n: number): void {
  const key = `BULK-${String(n).padStart(6, '0')}`;
  const paymentId = id(`payment:${key}`);
  const ageMin = 5 + ((n * 997) % (30 * 24 * 60 - 60));
  const createdAt = now - ageMin * MINUTE;
  const kind = n % 5;
  const status = (['PENDING', 'SUCCEEDED', 'SUCCEEDED', 'CANCELLED', 'EXPIRED'] as const)[kind]!;
  const gateway = n % 2 === 0 ? 'stripe' : 'fake';
  const finished = createdAt + 20 * MINUTE;
  rows.payments.push({
    id: paymentId,
    merchantOrderId: `${SEED_PREFIX}${key}`,
    amount: String(10_000 * (1 + (n % 50))),
    currency: 'VND',
    status,
    expiresAt: new Date(createdAt + DAY),
    createdAt: new Date(createdAt),
    updatedAt: new Date(status === 'PENDING' ? createdAt : finished),
  });
  const base = {
    entityType: 'PAYMENT' as const,
    actor: 'system',
    reason: null,
  };
  rows.transitions.push({
    ...base,
    id: id(`transition:${key}:create`),
    entityId: paymentId,
    fromStatus: null,
    toStatus: 'PENDING',
    trigger: 'create_payment',
    actor: 'merchant',
    createdAt: new Date(createdAt),
  });
  if (status === 'PENDING') return;
  const trigger = { SUCCEEDED: 'webhook', CANCELLED: 'merchant_cancel', EXPIRED: 'expiry' }[status];
  rows.transitions.push({
    ...base,
    id: id(`transition:${key}:status`),
    entityId: paymentId,
    fromStatus: 'PENDING',
    toStatus: status,
    trigger,
    createdAt: new Date(finished),
  });
  const attemptId = id(`attempt:${key}:a1`);
  rows.attempts.push({
    id: attemptId,
    paymentId,
    gatewayId: gateway,
    status,
    providerRef: `${gateway === 'stripe' ? 'pi' : 'fk'}_SEED_${key}`,
    refundRequired: false,
    createdAt: new Date(createdAt + MINUTE),
    updatedAt: new Date(finished),
  });
}
