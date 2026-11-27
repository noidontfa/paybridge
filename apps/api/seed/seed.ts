import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { v5 } from 'uuid';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { DEFAULT_ORGANIZATION_ID } from '../src/identity/domain/entities/organization.js';
import {
  API_KEY_PREFIX,
  hashApiKey,
} from '../src/identity/application/api-key-secret.js';
import type { UserRole } from '../src/identity/domain/entities/user.js';
import { PUBLISHABLE_KEY_PREFIX } from '../src/identity/application/publishable-key-secret.js';
import { DEVELOPMENT_CREDENTIAL_KEYS } from '../src/config/env.schema.js';
import { AesCredentialCipher } from '../src/payment-core/infrastructure/crypto/credential-cipher.js';
import { PAYMENT_EVENT_KINDS } from '../src/webhooks/domain/entities/event-kinds.js';
import { WEBHOOK_SECRET_PREFIX } from '../src/webhooks/application/webhook-secret.js';
import { Argon2PasswordHasher } from '../src/identity/infrastructure/crypto/argon2-password-hasher.js';
import {
  callbackSpecs,
  eventSpecs,
  paymentSpecs,
  type OrganizationKey,
  type PaymentSpec,
  type When,
} from './scenarios.js';
import { seedPricingPlans } from './pricing-plans.js';
import { seedPricingTables, type SeededPricingTable } from './pricing-tables.js';
import {
  seedCheckoutActivity,
  type SeededCheckoutActivity,
} from './checkout-activity.js';

// Database seed (ticket 01). Writes straight to the database, outside Payment
// Core, so it may use the database client and open its own transaction.
//
// Everything it owns is recognisable: Upstream References start with `SEED-`,
// Callback dedupe keys start with `SEED-`, and every id is a UUID v5 derived
// from a fixed name. A re-run deletes exactly those rows and recreates them.

export const SEED_PREFIX = 'SEED-';
const NAMESPACE = 'c3a1e0a0-5eed-4b1d-9c5e-0d5eed5eed01';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
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
  organizations: number;
  gatewayConnections: number;
  users: number;
  /** The development API Keys, in clear text (they are public dev fixtures). */
  apiKeys: readonly SeedApiKey[];
  /** The development Publishable Keys (public by nature). */
  publishableKeys: readonly SeedPublishableKey[];
  payments: number;
  attempts: number;
  transitions: number;
  callbacks: number;
  events: number;
  pricingPlans: number;
  pricingTables: readonly SeededPricingTable[];
  /** The development Webhook Endpoint and its signing secret (a dev fixture). */
  webhookEndpoint: typeof SEED_WEBHOOK_ENDPOINT;
  /** Checkout Payments and the Webhook deliveries of their Payment Events. */
  checkoutActivity: SeededCheckoutActivity;
}

const id = (name: string): string => v5(name, NAMESPACE);

/**
 * The Organizations the seed works in: the default one (created by the
 * migration; it holds the original scenarios) and a second one, so the
 * isolation between Organizations is visible in the Console.
 */
type SeedOrganizationKey = OrganizationKey | 'dormant';
const ORGANIZATIONS: Record<
  SeedOrganizationKey,
  { id: string; name: string; status?: 'SUSPENDED' }
> = {
  primary: { id: DEFAULT_ORGANIZATION_ID, name: 'Default Organization' },
  acme: { id: id('organization:acme-retail'), name: 'Acme Retail' },
  /** Suspended: its Users cannot sign in until the Platform area reactivates it. */
  dormant: {
    id: id('organization:dormant-goods'),
    name: 'Dormant Goods',
    status: 'SUSPENDED',
  },
};

/** The one password every seeded User has. Development only: the seed refuses production. */
export const SEED_PASSWORD = 'paybridge-dev-password';
/** The seeded pending Invitation's link token (development only). */
export const SEED_INVITATION_TOKEN = 'seed-pending-invitation-token';

interface SeedUser {
  readonly key: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly organization: SeedOrganizationKey | null;
  /** Default true. A deactivated User cannot sign in. */
  readonly active?: boolean;
}

/** A Super Admin, plus an Organization Admin and an Operator in each Organization. */
export const SEED_USERS: readonly SeedUser[] = [
  {
    key: 'super-admin',
    email: 'super.admin@paybridge.dev',
    name: 'Sam Super Admin',
    role: 'SUPER_ADMIN',
    organization: null,
  },
  {
    key: 'admin-primary',
    email: 'admin@default.paybridge.dev',
    name: 'Dana Admin (Default)',
    role: 'ORGANIZATION_ADMIN',
    organization: 'primary',
  },
  {
    key: 'operator-primary',
    email: 'operator@default.paybridge.dev',
    name: 'Olu Operator (Default)',
    role: 'OPERATOR',
    organization: 'primary',
  },
  {
    key: 'admin-acme',
    email: 'admin@acme.paybridge.dev',
    name: 'Ana Admin (Acme)',
    role: 'ORGANIZATION_ADMIN',
    organization: 'acme',
  },
  {
    key: 'operator-acme',
    email: 'operator@acme.paybridge.dev',
    name: 'Omar Operator (Acme)',
    role: 'OPERATOR',
    organization: 'acme',
  },
  {
    key: 'admin-dormant',
    email: 'admin@dormant.paybridge.dev',
    name: 'Dee Admin (Dormant)',
    role: 'ORGANIZATION_ADMIN',
    organization: 'dormant',
  },
  {
    key: 'former-operator-primary',
    email: 'former.operator@default.paybridge.dev',
    name: 'Fran Former (Default)',
    role: 'OPERATOR',
    organization: 'primary',
    active: false,
  },
];

/** Each Organization's Gateway Connections; one of them is disabled. */
const SEED_GATEWAY_CONNECTIONS: readonly {
  organization: OrganizationKey;
  gatewayId: string;
  enabled: boolean;
}[] = [
  { organization: 'primary', gatewayId: 'fake', enabled: true },
  { organization: 'primary', gatewayId: 'stripe', enabled: true },
  // Pays by QR in the embedded checkout (ticket 09).
  { organization: 'primary', gatewayId: 'fake-qr', enabled: true },
  { organization: 'acme', gatewayId: 'fake', enabled: true },
  { organization: 'acme', gatewayId: 'stripe', enabled: false },
];

export interface SeedApiKey {
  readonly label: string;
  readonly key: string;
  readonly organization: OrganizationKey;
  readonly revoked: boolean;
}

/** Fixed development keys, so the public API can be called right after seeding. */
export const SEED_API_KEYS: readonly SeedApiKey[] = [
  {
    label: 'Seed: default Organization',
    key: `${API_KEY_PREFIX}seed_default_000000000000000000000000`,
    organization: 'primary',
    revoked: false,
  },
  {
    label: 'Seed: default Organization (old, revoked)',
    key: `${API_KEY_PREFIX}seed_default_old_0000000000000000000000`,
    organization: 'primary',
    revoked: true,
  },
  {
    label: 'Seed: Acme Retail',
    key: `${API_KEY_PREFIX}seed_acme_00000000000000000000000000`,
    organization: 'acme',
    revoked: false,
  },
];

/**
 * A Webhook Endpoint of the default Organization, subscribed to every kind,
 * pointing at a receiver on this machine. The secret is fixed so a local
 * receiver can verify signatures.
 */
export const SEED_WEBHOOK_ENDPOINT = {
  organization: 'primary' as OrganizationKey,
  url: 'http://localhost:9998/webhooks',
  secret: `${WEBHOOK_SECRET_PREFIX}seed_default_00000000000000000000000000`,
} as const;

export interface SeedPublishableKey {
  readonly label: string;
  readonly key: string;
  readonly organization: OrganizationKey;
  readonly allowedOrigins: readonly string[];
}

/**
 * Fixed development Publishable Keys, so an embedded checkout can be tried
 * from a local host page (for example `http://localhost:5173`) right after
 * seeding.
 */
export const SEED_PUBLISHABLE_KEYS: readonly SeedPublishableKey[] = [
  {
    label: 'Seed: local host page',
    key: `${PUBLISHABLE_KEY_PREFIX}seed_default_000000000000000000000000`,
    organization: 'primary',
    allowedOrigins: ['http://localhost:5173'],
  },
];

/** Publishable Keys are replaced on every run, like API Keys. */
async function seedPublishableKeys(tx: Tx, now: number): Promise<void> {
  await tx.publishableKey.deleteMany({
    where: {
      id: {
        in: SEED_PUBLISHABLE_KEYS.map((k) => id(`publishable-key:${k.label}`)),
      },
    },
  });
  for (const k of SEED_PUBLISHABLE_KEYS) {
    await tx.publishableKey.create({
      data: {
        id: id(`publishable-key:${k.label}`),
        organizationId: ORGANIZATIONS[k.organization].id,
        label: k.label,
        key: k.key,
        allowedOrigins: [...k.allowedOrigins],
        createdAt: new Date(now - DAY),
        updatedAt: new Date(now - DAY),
      },
    });
  }
}

function assertAllowed(options: SeedOptions): void {
  if (options.nodeEnv === 'production') {
    throw new SeedRefusedError(
      'The seed refuses to run when NODE_ENV=production.',
    );
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
    throw new SeedRefusedError(
      'The bulk count must be a non-negative integer.',
    );
  }
  const now = (options.now ?? new Date()).getTime();
  const rows = buildRows(now, bulk);
  const passwordHash = await new Argon2PasswordHasher().hash(SEED_PASSWORD);
  let pricingPlans = 0;
  let pricingTables: SeededPricingTable[] = [];
  let checkoutActivity: SeededCheckoutActivity = { payments: 0, deliveries: 0 };

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl }),
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        await deleteSeedRows(tx);
        // Organizations are never deleted: re-runs keep them as they are.
        for (const organization of Object.values(ORGANIZATIONS)) {
          await tx.organization.upsert({
            where: { id: organization.id },
            // Only the seed's own suspended Organization is reset on a re-run.
            update: organization.status ? { status: organization.status } : {},
            create: organization,
          });
        }
        // Users are kept across re-runs (their sign-ins stay valid); the
        // password and the active flag are reset so the seed always works.
        for (const user of SEED_USERS) {
          const data = {
            email: user.email,
            name: user.name,
            passwordHash,
            role: user.role,
            organizationId: user.organization
              ? ORGANIZATIONS[user.organization].id
              : null,
            active: user.active ?? true,
          };
          await tx.user.upsert({
            where: { id: id(`user:${user.key}`) },
            update: data,
            create: { id: id(`user:${user.key}`), ...data },
          });
        }
        // Keys are replaced on every run, so a revoked one never revives.
        await tx.apiKey.deleteMany({
          where: {
            id: { in: SEED_API_KEYS.map((k) => id(`api-key:${k.label}`)) },
          },
        });
        for (const k of SEED_API_KEYS) {
          await tx.apiKey.create({
            data: {
              id: id(`api-key:${k.label}`),
              organizationId: ORGANIZATIONS[k.organization].id,
              label: k.label,
              prefix: k.key.slice(0, API_KEY_PREFIX.length + 8),
              keyHash: hashApiKey(k.key),
              revokedAt: k.revoked ? new Date(now - DAY) : null,
            },
          });
        }
        await seedPublishableKeys(tx, now);
        // Gateway Connections: kept across re-runs, reset to the seeded state.
        // The credentials are obvious dummies, encrypted like real ones.
        const cipher = AesCredentialCipher.fromConfig(
          process.env.GATEWAY_CREDENTIAL_KEYS || DEVELOPMENT_CREDENTIAL_KEYS,
        );
        for (const connection of SEED_GATEWAY_CONNECTIONS) {
          const sealed =
            connection.gatewayId === 'stripe'
              ? cipher.encrypt(
                  JSON.stringify({
                    secretKey: 'sk_test_seed_not_real',
                    webhookSecret: 'whsec_seed_not_real',
                    publishableKey: 'pk_test_seed_not_real',
                  }),
                )
              : null;
          const data = {
            organizationId: ORGANIZATIONS[connection.organization].id,
            gatewayId: connection.gatewayId,
            credentialsCiphertext: sealed?.ciphertext ?? null,
            credentialsKeyId: sealed?.keyId ?? null,
            enabled: connection.enabled,
          };
          await tx.gatewayConnection.upsert({
            where: {
              organizationId_gatewayId: {
                organizationId: data.organizationId,
                gatewayId: data.gatewayId,
              },
            },
            update: data,
            create: {
              id: id(
                `gateway-connection:${connection.organization}:${connection.gatewayId}`,
              ),
              ...data,
            },
          });
        }
        await seedWebhookEndpoint(tx, cipher);
        // A pending Invitation, so the Invitations screen has data. Its link
        // is /accept-invitation?token=SEED_INVITATION_TOKEN (development only).
        const invitation = {
          email: 'newcomer@default.paybridge.dev',
          role: 'OPERATOR' as const,
          organizationId: DEFAULT_ORGANIZATION_ID,
          invitedById: id('user:admin-primary'),
          tokenHash: createHash('sha256')
            .update(SEED_INVITATION_TOKEN)
            .digest('hex'),
          expiresAt: new Date(now + 7 * 24 * 60 * 60_000),
          acceptedAt: null,
          revokedAt: null,
        };
        await tx.invitation.upsert({
          where: { id: id('invitation:pending') },
          update: invitation,
          create: { id: id('invitation:pending'), ...invitation },
        });
        pricingPlans = await seedPricingPlans(tx, {
          id,
          now,
          organizations: {
            primary: ORGANIZATIONS.primary.id,
            acme: ORGANIZATIONS.acme.id,
          },
          editors: {
            primary: seedEditor('admin-primary'),
            acme: seedEditor('admin-acme'),
          },
        });
        pricingTables = await seedPricingTables(tx, {
          id,
          now,
          organizationId: ORGANIZATIONS.primary.id,
          editor: seedEditor('admin-primary'),
        });
        await insertChunked(rows.payments, (data) =>
          tx.payment.createMany({ data }),
        );
        await insertChunked(rows.attempts, (data) =>
          tx.paymentTransaction.createMany({ data }),
        );
        await insertChunked(rows.transitions, (data) =>
          tx.statusTransition.createMany({ data }),
        );
        await insertChunked(rows.callbacks, (data) =>
          tx.webhookInbox.createMany({ data }),
        );
        await insertChunked(rows.events, (data) =>
          tx.outboxEvent.createMany({ data }),
        );
        checkoutActivity = await seedCheckoutActivity(tx, {
          id,
          now,
          referencePrefix: SEED_PREFIX,
          organizationId: ORGANIZATIONS.primary.id,
          publishableKeyId: id(
            `publishable-key:${SEED_PUBLISHABLE_KEYS[0]!.label}`,
          ),
          webhookEndpointId: id('webhook-endpoint:primary'),
          operator: seedEditor('operator-primary'),
        });
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
  return {
    organizations: Object.keys(ORGANIZATIONS).length,
    gatewayConnections: SEED_GATEWAY_CONNECTIONS.length,
    users: SEED_USERS.length,
    apiKeys: SEED_API_KEYS,
    publishableKeys: SEED_PUBLISHABLE_KEYS,
    payments: rows.payments.length,
    attempts: rows.attempts.length,
    transitions: rows.transitions.length,
    callbacks: rows.callbacks.length,
    events: rows.events.length,
    pricingPlans,
    pricingTables,
    webhookEndpoint: SEED_WEBHOOK_ENDPOINT,
    checkoutActivity,
  };
}

/** A seed User as the last editor of seeded rows. */
function seedEditor(key: string) {
  const user = SEED_USERS.find((u) => u.key === key)!;
  return { userId: id(`user:${key}`), role: user.role, name: user.name };
}

/** Kept across re-runs (deliveries point at it), reset to the seeded state. */
async function seedWebhookEndpoint(
  tx: Tx,
  cipher: AesCredentialCipher,
): Promise<void> {
  const sealed = cipher.encrypt(SEED_WEBHOOK_ENDPOINT.secret);
  const admin = SEED_USERS.find((u) => u.key === 'admin-primary')!;
  const data = {
    organizationId: ORGANIZATIONS[SEED_WEBHOOK_ENDPOINT.organization].id,
    url: SEED_WEBHOOK_ENDPOINT.url,
    eventKinds: [...PAYMENT_EVENT_KINDS],
    status: 'ENABLED' as const,
    secretCiphertext: sealed.ciphertext,
    secretKeyId: sealed.keyId,
    secretPrefix: SEED_WEBHOOK_ENDPOINT.secret.slice(
      0,
      WEBHOOK_SECRET_PREFIX.length + 6,
    ),
    updatedByUserId: id(`user:${admin.key}`),
    updatedByRole: admin.role,
    updatedByName: admin.name,
    deletedAt: null,
  };
  const endpointId = id('webhook-endpoint:primary');
  await tx.webhookEndpoint.upsert({
    where: { id: endpointId },
    update: data,
    create: { id: endpointId, ...data },
  });
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function deleteSeedRows(tx: Tx): Promise<void> {
  // Lock the seed's Payments and attempts first. A running app (its expiry,
  // requery and webhook workers) may be writing outbox rows, transitions or
  // raw responses for them; each of those writes takes a key-share lock on
  // the row it references, so after this it waits for the seed to commit,
  // and the deletes below see every row a worker committed before. Without
  // it, a worker's outbox row can land between the two DELETEs and the
  // Payment's DELETE fails on the RESTRICT foreign key.
  await tx.$queryRaw`
    SELECT p.id FROM core_payments p
      WHERE starts_with(p.merchant_order_id, ${SEED_PREFIX})
      FOR UPDATE`;
  await tx.$queryRaw`
    SELECT t.id FROM core_payment_transactions t
      JOIN core_payments p ON p.id = t.payment_id
      WHERE starts_with(p.merchant_order_id, ${SEED_PREFIX})
      FOR UPDATE OF t`;
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
    'afterMin' in when
      ? createdAt + when.afterMin * MINUTE
      : now - when.agoH * HOUR,
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
  // The Organization each Payment and attempt belongs to, by spec name.
  const organizationOf = new Map<string, string>();

  for (const spec of paymentSpecs()) {
    addPayment(rows, now, spec, createdAtOf, attemptIds, organizationOf);
  }

  for (const [n, spec] of callbackSpecs().entries()) {
    const attemptKey = spec.attempt
      ? attemptIds.get(spec.attempt)!
      : id('attempt:unknown-to-core');
    const body = Buffer.from(
      JSON.stringify({
        seed: spec.key,
        attemptKey,
        event: `seed.${spec.gateway}.event`,
      }),
    );
    const dedupeKey =
      spec.providerEventId ??
      `${SEED_PREFIX}${createHash('sha256').update(body).digest('hex')}`;
    const receivedAt = new Date(now - spec.receivedAgoH * HOUR);
    rows.callbacks.push({
      id: id(`callback:${spec.key}`),
      organizationId:
        (spec.attempt && organizationOf.get(spec.attempt)) ||
        ORGANIZATIONS.primary.id,
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
      processedAt:
        spec.status === 'PROCESSED'
          ? new Date(receivedAt.getTime() + 2000)
          : null,
    });
  }

  for (const spec of eventSpecs()) {
    const created = createdAtOf.get(spec.payment)!;
    const payment = paymentSpecs().find((p) => p.key === spec.payment)!;
    const createdAt = at(now, created, spec.when);
    rows.events.push({
      id: id(`event:${spec.key}`),
      organizationId: organizationOf.get(spec.payment)!,
      eventType: spec.type,
      paymentId: id(`payment:${spec.payment}`),
      payload: {
        paymentId: id(`payment:${spec.payment}`),
        upstreamReference: `${SEED_PREFIX}${payment.reference ?? spec.payment}`,
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
  organizationOf: Map<string, string>,
): void {
  const paymentId = id(`payment:${spec.key}`);
  const organizationId = ORGANIZATIONS[spec.organization ?? 'primary'].id;
  organizationOf.set(spec.key, organizationId);
  const createdAt = now - spec.createdAgoH * HOUR;
  createdAtOf.set(spec.key, createdAt);
  let updatedAt = createdAt;
  const touch = (date: Date) => {
    updatedAt = Math.max(updatedAt, date.getTime());
  };

  rows.transitions.push({
    id: id(`transition:${spec.key}:create`),
    organizationId,
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
      organizationId,
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
    organizationOf.set(`${spec.key}/${a.key}`, organizationId);
    const attemptCreated = new Date(
      createdAt + (a.createdAfterMin ?? 1) * MINUTE,
    );
    let attemptUpdated = attemptCreated.getTime();
    for (const [n, t] of a.transitions.entries()) {
      const when = at(now, createdAt, t.when);
      attemptUpdated = Math.max(attemptUpdated, when.getTime());
      rows.transitions.push({
        id: id(`transition:${spec.key}:${a.key}:${n}`),
        organizationId,
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
      organizationId,
      paymentId,
      gatewayId: a.gateway,
      status: a.status,
      providerRef: hasProviderRef
        ? `${a.gateway === 'stripe' ? 'pi' : 'fk'}_SEED_${spec.key}_${a.key}`
        : null,
      providerMetadata: a.review?.providerReportedAmount
        ? { providerReportedAmount: a.review.providerReportedAmount }
        : undefined,
      nextAction: a.nextAction as Prisma.InputJsonObject | undefined,
      reviewReason: a.review?.reason ?? null,
      reviewOpenedAt: a.review
        ? new Date(now - a.review.openedAgoH * HOUR)
        : null,
      refundRequired: a.review?.refundRequired ?? false,
      createdAt: attemptCreated,
      updatedAt: new Date(attemptUpdated),
    });
  }

  rows.payments.push({
    id: paymentId,
    organizationId,
    merchantOrderId: `${SEED_PREFIX}${spec.reference ?? spec.key}`,
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
  const organizationId = ORGANIZATIONS.primary.id;
  const ageMin = 5 + ((n * 997) % (30 * 24 * 60 - 60));
  const createdAt = now - ageMin * MINUTE;
  const kind = n % 5;
  const status = (
    ['PENDING', 'SUCCEEDED', 'SUCCEEDED', 'CANCELLED', 'EXPIRED'] as const
  )[kind]!;
  const gateway = n % 2 === 0 ? 'stripe' : 'fake';
  const finished = createdAt + 20 * MINUTE;
  rows.payments.push({
    id: paymentId,
    organizationId,
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
    organizationId,
    id: id(`transition:${key}:create`),
    entityId: paymentId,
    fromStatus: null,
    toStatus: 'PENDING',
    trigger: 'create_payment',
    actor: 'merchant',
    createdAt: new Date(createdAt),
  });
  if (status === 'PENDING') return;
  const trigger = {
    SUCCEEDED: 'webhook',
    CANCELLED: 'merchant_cancel',
    EXPIRED: 'expiry',
  }[status];
  rows.transitions.push({
    ...base,
    organizationId,
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
    organizationId,
    paymentId,
    gatewayId: gateway,
    status,
    providerRef: `${gateway === 'stripe' ? 'pi' : 'fk'}_SEED_${key}`,
    refundRequired: false,
    createdAt: new Date(createdAt + MINUTE),
    updatedAt: new Date(finished),
  });
}
