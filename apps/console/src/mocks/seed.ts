/**
 * Deterministic seed for the mock store: a fixed seed and a fixed "now"
 * produce the same several hundred Payments on every start.
 *
 * Each `Scenario` below is one story (a Payment status plus the attempts it
 * went through). Scenarios are dealt out round-robin by weight, so every
 * Payment status, PaymentTransaction status and review reason is covered no
 * matter how the dice fall. Only the `stripe` and `fake` gateways appear.
 *
 * Extension point: seed another collection by adding a function that takes the
 * store and `Random` and is called from `createSeededStore`.
 */
import type {
  AttemptStatus,
  NextAction,
  PaymentEventType,
  PaymentStatus,
  ReviewReason,
} from '@/lib/api/schemas';
import { createRandom, type Random } from './random';
import { seedCallbacks } from './seed-callbacks';
import { MockStore, type MockAttempt, type MockPayment } from './store';

/** The fixed "now" of the mock world. */
export const SEED_NOW = new Date('2026-11-25T03:00:00.000Z');
export const DEFAULT_SEED = 20261125;
const PAYMENT_COUNT = 400;

type Gateway = 'stripe' | 'fake';

interface AttemptPlan {
  gateway: Gateway;
  /** Statuses visited, ending on the attempt's current status. */
  path: AttemptStatus[];
  reviewReason?: ReviewReason;
  /** The attempt is cancelled because the Payment moved to another gateway. */
  switched?: boolean;
  /** An Operator note on the open Review (an `operator_note` transition). */
  note?: string;
  /** The Operator resolved the Review: the last status of the path was set by them, with this note. */
  resolutionNote?: string;
}

interface Scenario {
  weight: number;
  payment: PaymentStatus;
  /** How long ago the Payment was created, in hours. */
  ageHours: [number, number];
  attempts: AttemptPlan[];
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const SCENARIOS: Scenario[] = [
  // Open Payments.
  { weight: 2, payment: 'PENDING', ageHours: [0.05, 0.4], attempts: [] },
  { weight: 1, payment: 'PENDING', ageHours: [0.05, 0.4], attempts: [{ gateway: 'stripe', path: ['CREATED'] }] },
  { weight: 3, payment: 'PENDING', ageHours: [0.05, 0.4], attempts: [{ gateway: 'stripe', path: ['CREATED', 'PENDING'] }] },
  { weight: 3, payment: 'PENDING', ageHours: [0.05, 0.4], attempts: [{ gateway: 'fake', path: ['CREATED', 'PENDING'] }] },
  { weight: 2, payment: 'PENDING', ageHours: [0.1, 0.4], attempts: [{ gateway: 'fake', path: ['CREATED', 'FAILED'] }] },
  {
    weight: 2,
    payment: 'PENDING',
    ageHours: [0.1, 0.4],
    attempts: [
      { gateway: 'stripe', path: ['CREATED', 'PENDING', 'FAILED'] },
      { gateway: 'fake', path: ['CREATED', 'PENDING'] },
    ],
  },
  // Succeeded.
  { weight: 12, payment: 'SUCCEEDED', ageHours: [1, 700], attempts: [{ gateway: 'stripe', path: ['CREATED', 'PENDING', 'SUCCEEDED'] }] },
  { weight: 8, payment: 'SUCCEEDED', ageHours: [1, 700], attempts: [{ gateway: 'fake', path: ['CREATED', 'PENDING', 'SUCCEEDED'] }] },
  {
    weight: 3,
    payment: 'SUCCEEDED',
    ageHours: [1, 700],
    attempts: [
      { gateway: 'stripe', path: ['CREATED', 'PENDING', 'FAILED'] },
      { gateway: 'fake', path: ['CREATED', 'PENDING', 'SUCCEEDED'] },
    ],
  },
  // Closed without success.
  { weight: 3, payment: 'CANCELLED', ageHours: [1, 700], attempts: [] },
  { weight: 3, payment: 'CANCELLED', ageHours: [1, 700], attempts: [{ gateway: 'stripe', path: ['CREATED', 'PENDING', 'CANCELLED'] }] },
  { weight: 4, payment: 'EXPIRED', ageHours: [1, 700], attempts: [] },
  { weight: 4, payment: 'EXPIRED', ageHours: [1, 700], attempts: [{ gateway: 'fake', path: ['CREATED', 'PENDING', 'EXPIRED'] }] },
  // A gateway switch: the first attempt is cancelled when the customer picks another gateway.
  {
    weight: 2,
    payment: 'PENDING',
    ageHours: [0.1, 0.4],
    attempts: [
      { gateway: 'stripe', path: ['CREATED', 'PENDING', 'CANCELLED'], switched: true },
      { gateway: 'fake', path: ['CREATED', 'PENDING'] },
    ],
  },
  // Reviews an Operator already resolved.
  {
    weight: 2,
    payment: 'SUCCEEDED',
    ageHours: [10, 400],
    attempts: [
      {
        gateway: 'stripe',
        path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW', 'SUCCEEDED'],
        reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
        resolutionNote: 'Confirmed paid in the Stripe dashboard.',
      },
    ],
  },
  {
    weight: 1,
    payment: 'PENDING',
    ageHours: [10, 400],
    attempts: [
      {
        gateway: 'fake',
        path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW', 'FAILED'],
        reviewReason: 'AMOUNT_MISMATCH',
        resolutionNote: 'Customer paid the wrong amount; refunded in full.',
      },
    ],
  },
  // Reviews.
  {
    weight: 3,
    payment: 'PENDING',
    ageHours: [2, 150],
    attempts: [{ gateway: 'stripe', path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW'], reviewReason: 'AMBIGUOUS_PROVIDER_STATUS' }],
  },
  {
    weight: 2,
    payment: 'PENDING',
    ageHours: [2, 150],
    attempts: [{ gateway: 'fake', path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW'], reviewReason: 'AMBIGUOUS_PROVIDER_STATUS' }],
  },
  {
    weight: 2,
    payment: 'PENDING',
    ageHours: [2, 150],
    attempts: [{ gateway: 'stripe', path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW'], reviewReason: 'AMOUNT_MISMATCH' }],
  },
  {
    weight: 2,
    payment: 'EXPIRED',
    ageHours: [10, 400],
    attempts: [
      {
        gateway: 'stripe',
        path: ['CREATED', 'PENDING', 'EXPIRED', 'REQUIRES_REVIEW'],
        reviewReason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT',
        note: 'Customer paid after expiry; refund requested from Stripe.',
      },
    ],
  },
  {
    weight: 1,
    payment: 'CANCELLED',
    ageHours: [10, 400],
    attempts: [
      { gateway: 'fake', path: ['CREATED', 'PENDING', 'CANCELLED', 'REQUIRES_REVIEW'], reviewReason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' },
    ],
  },
  {
    weight: 2,
    payment: 'SUCCEEDED',
    ageHours: [10, 400],
    attempts: [
      {
        gateway: 'stripe',
        path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW'],
        reviewReason: 'DUPLICATE_SUCCESS',
        note: 'Second charge confirmed in the Stripe dashboard.',
      },
      { gateway: 'fake', path: ['CREATED', 'PENDING', 'SUCCEEDED'] },
    ],
  },
];

const EVENT_FOR_CLOSING_STATUS: Record<Exclude<PaymentStatus, 'PENDING'>, PaymentEventType> = {
  SUCCEEDED: 'PaymentSucceeded',
  CANCELLED: 'PaymentCancelled',
  EXPIRED: 'PaymentExpired',
};

/** The Operator identity on seeded resolutions and notes (the Console has no sign-in yet). */
const OPERATOR = 'operator';

interface Cause {
  trigger: string;
  actor: string;
}

/** What caused an attempt to move from one status to the next. */
function attemptCause(from: AttemptStatus | null, to: AttemptStatus, plan: AttemptPlan): Cause {
  if (from === 'REQUIRES_REVIEW' && plan.resolutionNote) return { trigger: 'operator_resolution', actor: OPERATOR };
  if (from === null) return { trigger: 'start_attempt', actor: 'system' };
  switch (to) {
    case 'PENDING':
      return { trigger: 'gateway_accepted', actor: 'system' };
    case 'FAILED':
      return from === 'CREATED' ? { trigger: 'gateway_rejected', actor: 'system' } : { trigger: 'webhook', actor: 'system' };
    case 'SUCCEEDED':
      return { trigger: 'webhook', actor: 'system' };
    case 'EXPIRED':
      return { trigger: 'expiry', actor: 'system' };
    case 'CANCELLED':
      return plan.switched ? { trigger: 'gateway_switch', actor: 'system' } : { trigger: 'merchant_cancel', actor: 'merchant' };
    case 'REQUIRES_REVIEW':
      return from === 'PENDING' ? { trigger: 'status_query', actor: 'system' } : { trigger: 'webhook', actor: 'system' };
    default:
      return { trigger: 'start_attempt', actor: 'system' };
  }
}

export function createSeededStore(options: { seed?: number; now?: Date } = {}): MockStore {
  const random = createRandom(options.seed ?? DEFAULT_SEED);
  const store = new MockStore(options.now ?? SEED_NOW);
  const deck = SCENARIOS.flatMap((scenario) => Array.from({ length: scenario.weight }, () => scenario));
  for (let index = 0; index < PAYMENT_COUNT; index += 1) {
    seedPayment(store, random, deck[index % deck.length]!, index);
  }
  seedCallbacks(store, createRandom((options.seed ?? DEFAULT_SEED) ^ 0xca11bac));
  return store;
}

function seedPayment(store: MockStore, random: Random, scenario: Scenario, index: number): void {
  const nowMs = store.now.getTime();
  const iso = (ms: number) => new Date(Math.min(ms, nowMs)).toISOString();
  const [minAge, maxAge] = scenario.ageHours;
  const createdMs = nowMs - Math.round((minAge + random.next() * (maxAge - minAge)) * HOUR);
  const expiresMs = createdMs + random.pick([15, 30, 60]) * MINUTE;

  const payment: MockPayment = {
    id: random.uuid(),
    upstreamReference: `order-2026-${String(index + 1).padStart(4, '0')}`,
    amount: String(random.int(10, 50_000) * 1000),
    currency: 'VND',
    status: scenario.payment,
    expiresAt: new Date(expiresMs).toISOString(),
    createdAt: iso(createdMs),
    updatedAt: iso(createdMs),
  };
  store.payments.push(payment);

  let trailId = 0;
  const transition = (
    entityType: 'PAYMENT' | 'PAYMENT_TRANSACTION',
    entityId: string,
    fromStatus: string | null,
    toStatus: string,
    cause: Cause,
    atMs: number,
    reason: string | null = null,
  ) => {
    trailId += 1;
    store.transitions.push({
      id: `${payment.id.slice(0, 8)}-t${trailId}`,
      entityType,
      entityId,
      fromStatus,
      toStatus,
      ...cause,
      reason,
      createdAt: iso(atMs),
    });
  };
  let eventId = 0;
  const emit = (type: PaymentEventType, atMs: number, payload: Record<string, unknown>) => {
    eventId += 1;
    const recent = nowMs - atMs < HOUR;
    // Recent events may simply not have been relayed yet; a few old ones are stuck.
    const unpublished = recent ? random.next() < 0.4 : type !== 'PaymentCreated' && index % 11 === 0;
    store.events.push({
      id: `${payment.id.slice(0, 8)}-e${eventId}`,
      type,
      paymentId: payment.id,
      payload: { paymentId: payment.id, upstreamReference: payment.upstreamReference, ...payload },
      createdAt: iso(atMs),
      publishedAt: unpublished ? null : iso(atMs + random.int(1, 5) * SECOND),
    });
  };

  transition('PAYMENT', payment.id, null, 'PENDING', { trigger: 'create_payment', actor: 'merchant' }, createdMs);
  emit('PaymentCreated', createdMs, {
    amount: payment.amount,
    currency: payment.currency,
    status: 'PENDING',
    expiresAt: payment.expiresAt,
  });

  let clock = createdMs;
  let paymentClosedMs: number | undefined;
  let resolution: Cause | undefined;
  let resolutionNote: string | null = null;
  scenario.attempts.forEach((plan, planIndex) => {
    clock += random.int(5, 60) * SECOND;
    const attempt: MockAttempt = {
      id: random.uuid(),
      paymentId: payment.id,
      gatewayId: plan.gateway,
      status: 'CREATED',
      providerRef: null,
      refundRequired: false,
      createdAt: iso(clock),
      updatedAt: iso(clock),
    };
    store.attempts.push(attempt);

    let previous: AttemptStatus | null = null;
    for (const status of plan.path) {
      if (status === 'EXPIRED') clock = Math.max(clock + SECOND, expiresMs);
      else if (previous === 'EXPIRED' || previous === 'CANCELLED') clock += random.int(60, 300) * MINUTE;
      else if (previous !== null) clock += random.int(5, 90) * SECOND;
      const review = status === 'REQUIRES_REVIEW' ? plan.reviewReason : undefined;
      const cause = attemptCause(previous, status, plan);
      const resolved = cause.trigger === 'operator_resolution';
      transition('PAYMENT_TRANSACTION', attempt.id, previous, status, cause, clock, resolved ? plan.resolutionNote! : (review ?? null));
      if (resolved) {
        // The Review is over: its reason no longer applies.
        delete attempt.reviewReason;
        delete attempt.reviewOpenedAt;
        attempt.refundRequired = false;
        resolution = cause;
        resolutionNote = plan.resolutionNote ?? null;
      }

      attempt.status = status;
      attempt.updatedAt = iso(clock);
      if (status === 'PENDING') {
        attempt.providerRef = plan.gateway === 'stripe' ? `pi_${random.token(24)}` : `FAKE-${random.token(10).toUpperCase()}`;
      }
      if (review) {
        attempt.reviewReason = review;
        attempt.reviewOpenedAt = iso(clock);
        attempt.refundRequired = review !== 'AMBIGUOUS_PROVIDER_STATUS';
        emit('PaymentRequiresReview', clock, {
          status: payment.status,
          attemptId: attempt.id,
          gatewayId: attempt.gatewayId,
          reviewReason: review,
          refundRequired: attempt.refundRequired,
          reviewOpenedAt: attempt.reviewOpenedAt,
        });
        if (plan.note) {
          // The Operator annotates the open Review; its status does not change.
          const noteMs = clock + random.int(1, 30) * MINUTE;
          transition('PAYMENT_TRANSACTION', attempt.id, status, status, { trigger: 'operator_note', actor: OPERATOR }, noteMs, plan.note);
          clock = noteMs;
        }
      }
      if (planIndex === scenario.attempts.length - 1 && status === 'PENDING' && plan.path.at(-1) === 'PENDING') {
        attempt.nextAction = nextActionFor(plan.gateway, attempt, random);
      }
      if (payment.status === 'SUCCEEDED' && status === 'SUCCEEDED') paymentClosedMs = clock;
      if (payment.status === 'CANCELLED' && status === 'CANCELLED') paymentClosedMs = clock;
      if (payment.status === 'EXPIRED' && status === 'EXPIRED') paymentClosedMs = clock;
      previous = status;
    }
  });

  if (payment.status !== 'PENDING') {
    // Payments without a closing attempt (cancelled or expired while idle) close on their own.
    paymentClosedMs ??= payment.status === 'EXPIRED' ? expiresMs : clock + random.int(1, 20) * MINUTE;
    const cause: Cause =
      resolution ??
      (payment.status === 'CANCELLED'
        ? { trigger: 'merchant_cancel', actor: 'merchant' }
        : payment.status === 'EXPIRED'
          ? { trigger: 'expiry', actor: 'system' }
          : { trigger: 'webhook', actor: 'system' });
    transition('PAYMENT', payment.id, 'PENDING', payment.status, cause, paymentClosedMs, resolutionNote);
    emit(EVENT_FOR_CLOSING_STATUS[payment.status], paymentClosedMs, { status: payment.status });
    payment.updatedAt = iso(paymentClosedMs);
  } else {
    payment.updatedAt = iso(Math.max(clock, createdMs));
  }
}

function nextActionFor(gateway: Gateway, attempt: MockAttempt, random: Random): NextAction {
  if (gateway === 'stripe') {
    return { type: 'CLIENT_SDK', token: `${attempt.providerRef}_secret_${random.token(16)}`, clientParams: { mode: 'test' } };
  }
  return random.next() < 0.5
    ? { type: 'REDIRECT', url: `https://fake.example/pay/${attempt.providerRef}` }
    : { type: 'QR_CODE', payload: `fake://pay/${attempt.providerRef}` };
}
