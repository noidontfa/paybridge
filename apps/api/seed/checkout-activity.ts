import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Seed checkout activity (code review P6): Payments the Embedded Checkout
// started (with their Pricing Plan, Customer Reference, Customer email and
// checkout session) and the Webhook deliveries of their Payment Events, so the
// Console's Payments, Payment detail and Webhook deliveries pages show real
// data. Upstream References start with `SEED-` (the seed's own delete removes
// the Payments, attempts, transitions and events); the checkout sessions,
// deliveries and attempts have fixed ids and are replaced here on every run.

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface SeedActor {
  readonly userId: string;
  readonly role: string;
  readonly name: string;
}

export interface SeedCheckoutActivityContext {
  /** Fixed UUID v5 for a seed name. */
  readonly id: (name: string) => string;
  readonly now: number;
  /** `SEED-`: the prefix of every seeded Upstream Reference. */
  readonly referencePrefix: string;
  readonly organizationId: string;
  /** The Publishable Key the checkout sessions were started with. */
  readonly publishableKeyId: string;
  /** The seeded Webhook Endpoint the deliveries went to. */
  readonly webhookEndpointId: string;
  /** The Operator who resent a delivery by hand. */
  readonly operator: SeedActor;
}

export interface SeededCheckoutActivity {
  readonly payments: number;
  readonly deliveries: number;
}

type EventType = 'PaymentCreated' | 'PaymentSucceeded' | 'PaymentExpired';

const EVENT_KINDS: Record<EventType, string> = {
  PaymentCreated: 'payment.created',
  PaymentSucceeded: 'payment.succeeded',
  PaymentExpired: 'payment.expired',
};

interface SeedDeliveryAttempt {
  readonly afterMin: number;
  readonly httpStatus: number | null;
  readonly error?: string;
  /** A resend by hand (the Operator). */
  readonly manual?: boolean;
}

interface SeedDelivery {
  readonly status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  readonly attempts: readonly SeedDeliveryAttempt[];
  /** For a PENDING delivery: minutes from now until its next attempt. */
  readonly nextAttemptInMin?: number;
}

interface SeedCheckoutPayment {
  readonly key: string;
  readonly plan: { readonly key: string; readonly name: string; readonly amount: string };
  readonly customerReference: string | null;
  readonly customerEmail: string | null;
  readonly createdAgoMin: number;
  readonly expiryMinutes: number;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'EXPIRED';
  /** The fake gateway's attempt, if the Customer chose one. */
  readonly attempt: 'SUCCEEDED' | 'PENDING' | null;
  /** The Payment Events, with their delivery to the seeded endpoint. */
  readonly events: readonly { readonly type: EventType; readonly afterMin: number; readonly delivery: SeedDelivery }[];
}

const BASIC = { key: 'primary-basic', name: 'Basic', amount: '99000' };
const PRO = { key: 'primary-pro', name: 'Pro', amount: '299000' };

const refused = (afterMin: number): SeedDeliveryAttempt => ({
  afterMin,
  httpStatus: null,
  error: 'connect ECONNREFUSED 127.0.0.1:9998',
});

export const SEED_CHECKOUT_PAYMENTS: readonly SeedCheckoutPayment[] = [
  {
    key: 'CHK-1',
    plan: PRO,
    customerReference: 'cus_1001',
    customerEmail: 'linh.nguyen@example.com',
    createdAgoMin: 3 * 60,
    expiryMinutes: 60,
    status: 'SUCCEEDED',
    attempt: 'SUCCEEDED',
    events: [
      {
        type: 'PaymentCreated',
        afterMin: 0,
        delivery: { status: 'SUCCEEDED', attempts: [{ afterMin: 0, httpStatus: 200 }] },
      },
      {
        // The receiver was down; an Operator resent it once, and the
        // automatic retries go on.
        type: 'PaymentSucceeded',
        afterMin: 4,
        delivery: {
          status: 'PENDING',
          attempts: [
            { afterMin: 4, httpStatus: 500 },
            { afterMin: 5, httpStatus: 503 },
            { afterMin: 30, httpStatus: 502, manual: true },
          ],
          nextAttemptInMin: 9,
        },
      },
    ],
  },
  {
    key: 'CHK-2',
    plan: BASIC,
    customerReference: 'cus_1002',
    customerEmail: null,
    createdAgoMin: 10,
    expiryMinutes: 30,
    status: 'PENDING',
    attempt: 'PENDING',
    events: [
      {
        type: 'PaymentCreated',
        afterMin: 0,
        delivery: { status: 'SUCCEEDED', attempts: [{ afterMin: 0, httpStatus: 204 }] },
      },
    ],
  },
  {
    key: 'CHK-3',
    plan: BASIC,
    customerReference: null,
    customerEmail: 'an.tran@example.com',
    // Old enough for all twelve attempts below, inside the 7-day retention.
    createdAgoMin: (4 * DAY) / MINUTE,
    expiryMinutes: 30,
    status: 'EXPIRED',
    attempt: null,
    events: [
      {
        type: 'PaymentCreated',
        afterMin: 0,
        delivery: { status: 'SUCCEEDED', attempts: [{ afterMin: 0, httpStatus: 200 }] },
      },
      {
        // Every one of the twelve automatic attempts was refused.
        type: 'PaymentExpired',
        afterMin: 30,
        delivery: {
          status: 'FAILED',
          attempts: [1, 3, 9, 27, 81, 243, 720, 720, 720, 720, 720].reduce<SeedDeliveryAttempt[]>(
            (all, wait) => [...all, refused((all.at(-1)?.afterMin ?? 30) + wait)],
            [refused(30)],
          ),
        },
      },
    ],
  },
];

/** Writes the checkout Payments and their deliveries; replaces them on a re-run. */
export async function seedCheckoutActivity(
  tx: Tx,
  ctx: SeedCheckoutActivityContext,
): Promise<SeededCheckoutActivity> {
  const { id } = ctx;
  const deliveryIds = SEED_CHECKOUT_PAYMENTS.flatMap((p) =>
    p.events.map((e) => id(`webhook-delivery:${p.key}:${e.type}`)),
  );
  await tx.webhookDeliveryAttempt.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
  await tx.webhookDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await tx.checkoutSession.deleteMany({
    where: { id: { in: SEED_CHECKOUT_PAYMENTS.map((p) => id(`checkout-session:${p.key}`)) } },
  });

  let deliveries = 0;
  for (const spec of SEED_CHECKOUT_PAYMENTS) {
    const paymentId = id(`payment:${spec.key}`);
    const createdAt = ctx.now - spec.createdAgoMin * MINUTE;
    const at = (afterMin: number) => new Date(createdAt + afterMin * MINUTE);
    const expiresAt = at(spec.expiryMinutes);
    const pricingPlanId = id(`pricing-plan:${spec.plan.key}`);
    const upstreamReference = `${ctx.referencePrefix}${spec.key}`;
    const checkoutOrigin = {
      pricingPlanId,
      pricingPlanName: spec.plan.name,
      customerReference: spec.customerReference,
      customerEmail: spec.customerEmail,
    };
    const finishedAt = spec.events.at(-1)!.afterMin;

    await tx.payment.create({
      data: {
        id: paymentId,
        organizationId: ctx.organizationId,
        merchantOrderId: upstreamReference,
        amount: spec.plan.amount,
        currency: 'VND',
        status: spec.status,
        expiresAt,
        pricingPlanId,
        pricingPlanName: spec.plan.name,
        customerRef: spec.customerReference,
        customerEmail: spec.customerEmail,
        createdAt: at(0),
        updatedAt: at(finishedAt),
      },
    });
    const transitions: Prisma.StatusTransitionCreateManyInput[] = [
      {
        id: id(`transition:${spec.key}:create`),
        organizationId: ctx.organizationId,
        entityType: 'PAYMENT',
        entityId: paymentId,
        fromStatus: null,
        toStatus: 'PENDING',
        trigger: 'create_payment',
        actor: 'merchant',
        createdAt: at(0),
      },
    ];
    if (spec.status !== 'PENDING') {
      transitions.push({
        id: id(`transition:${spec.key}:end`),
        organizationId: ctx.organizationId,
        entityType: 'PAYMENT',
        entityId: paymentId,
        fromStatus: 'PENDING',
        toStatus: spec.status,
        trigger: spec.status === 'EXPIRED' ? 'expiry' : 'webhook',
        actor: 'system',
        createdAt: at(finishedAt),
      });
    }
    if (spec.attempt) {
      const attemptId = id(`attempt:${spec.key}:A1`);
      await tx.paymentTransaction.create({
        data: {
          id: attemptId,
          organizationId: ctx.organizationId,
          paymentId,
          gatewayId: 'fake',
          status: spec.attempt,
          providerRef: `fk_SEED_${spec.key}_A1`,
          nextAction:
            spec.attempt === 'PENDING'
              ? { type: 'REDIRECT', url: `https://fake-gateway.test/pay/${attemptId}` }
              : undefined,
          createdAt: at(1),
          updatedAt: at(spec.attempt === 'SUCCEEDED' ? finishedAt : 1),
        },
      });
      transitions.push({
        id: id(`transition:${spec.key}:A1:start`),
        organizationId: ctx.organizationId,
        entityType: 'PAYMENT_TRANSACTION',
        entityId: attemptId,
        fromStatus: null,
        toStatus: 'CREATED',
        trigger: 'start_attempt',
        actor: 'merchant',
        createdAt: at(1),
      });
      transitions.push({
        id: id(`transition:${spec.key}:A1:accepted`),
        organizationId: ctx.organizationId,
        entityType: 'PAYMENT_TRANSACTION',
        entityId: attemptId,
        fromStatus: 'CREATED',
        toStatus: 'PENDING',
        trigger: 'gateway_accepted',
        actor: 'system',
        createdAt: at(1),
      });
      if (spec.attempt === 'SUCCEEDED') {
        transitions.push({
          id: id(`transition:${spec.key}:A1:end`),
          organizationId: ctx.organizationId,
          entityType: 'PAYMENT_TRANSACTION',
          entityId: attemptId,
          fromStatus: 'PENDING',
          toStatus: 'SUCCEEDED',
          trigger: 'webhook',
          actor: 'system',
          createdAt: at(finishedAt),
        });
      }
    }
    await tx.statusTransition.createMany({ data: transitions });

    await tx.checkoutSession.create({
      data: {
        id: id(`checkout-session:${spec.key}`),
        organizationId: ctx.organizationId,
        sessionTokenHash: createHash('sha256').update(`seed-session:${spec.key}`).digest('hex'),
        pricingPlanId,
        customerReference: spec.customerReference ?? '',
        customerEmail: spec.customerEmail ?? '',
        publishableKeyId: ctx.publishableKeyId,
        paymentId,
        createdAt: at(0),
        returnHostPageUrl: spec.attempt ? 'http://localhost:5173/' : null,
      },
    });

    for (const event of spec.events) {
      const eventId = id(`event:${spec.key}:${event.type}`);
      const eventAt = at(event.afterMin);
      const data = {
        paymentId,
        upstreamReference,
        amount: spec.plan.amount,
        currency: 'VND',
        status: event.type === 'PaymentCreated' ? 'PENDING' : spec.status,
        expiresAt: expiresAt.toISOString(),
        checkoutOrigin,
      };
      await tx.outboxEvent.create({
        data: {
          id: eventId,
          organizationId: ctx.organizationId,
          eventType: event.type,
          paymentId,
          payload: data,
          createdAt: eventAt,
          publishedAt: new Date(eventAt.getTime() + 1000),
        },
      });
      const { delivery } = event;
      const deliveryId = id(`webhook-delivery:${spec.key}:${event.type}`);
      await tx.webhookDelivery.create({
        data: {
          id: deliveryId,
          organizationId: ctx.organizationId,
          endpointId: ctx.webhookEndpointId,
          eventId,
          eventKind: EVENT_KINDS[event.type],
          eventCreatedAt: eventAt,
          paymentId,
          payload: data,
          status: delivery.status,
          // Only automatic attempts count against the retries.
          attempts: delivery.attempts.filter((a) => !a.manual).length,
          nextAttemptAt:
            delivery.nextAttemptInMin === undefined
              ? null
              : new Date(ctx.now + delivery.nextAttemptInMin * MINUTE),
          createdAt: eventAt,
        },
      });
      await tx.webhookDeliveryAttempt.createMany({
        data: delivery.attempts.map((attempt, n) => {
          const succeeded = attempt.httpStatus !== null && attempt.httpStatus < 300;
          return {
            id: id(`webhook-delivery-attempt:${spec.key}:${event.type}:${n}`),
            organizationId: ctx.organizationId,
            deliveryId,
            attemptedAt: at(attempt.afterMin),
            succeeded,
            httpStatus: attempt.httpStatus,
            durationMs: attempt.httpStatus === null ? 3 : 40 + n * 7,
            responseBody:
              attempt.httpStatus === null ? null : succeeded ? 'ok' : 'upstream unavailable',
            error: succeeded ? null : (attempt.error ?? `HTTP ${attempt.httpStatus}`),
            triggeredByUserId: attempt.manual ? ctx.operator.userId : null,
            triggeredByRole: attempt.manual ? ctx.operator.role : null,
            triggeredByName: attempt.manual ? ctx.operator.name : null,
          };
        }),
      });
      deliveries += 1;
    }
  }
  return { payments: SEED_CHECKOUT_PAYMENTS.length, deliveries };
}
