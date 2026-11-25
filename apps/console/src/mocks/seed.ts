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
  // Closed Reviews: an Operator resolved them earlier.
  {
    weight: 1,
    payment: 'PENDING',
    ageHours: [20, 300],
    attempts: [{ gateway: 'stripe', path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW', 'FAILED'], reviewReason: 'AMBIGUOUS_PROVIDER_STATUS' }],
  },
  {
    weight: 2,
    payment: 'EXPIRED',
    ageHours: [10, 400],
    attempts: [
      { gateway: 'stripe', path: ['CREATED', 'PENDING', 'EXPIRED', 'REQUIRES_REVIEW'], reviewReason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' },
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
      { gateway: 'stripe', path: ['CREATED', 'PENDING', 'REQUIRES_REVIEW'], reviewReason: 'DUPLICATE_SUCCESS' },
      { gateway: 'fake', path: ['CREATED', 'PENDING', 'SUCCEEDED'] },
    ],
  },
];

const EVENT_FOR_CLOSING_STATUS: Record<Exclude<PaymentStatus, 'PENDING'>, PaymentEventType> = {
  SUCCEEDED: 'PaymentSucceeded',
  CANCELLED: 'PaymentCancelled',
  EXPIRED: 'PaymentExpired',
};

interface Cause {
  trigger: string;
  actor: string;
}

/** What caused an attempt to move from one status to the next. */
function attemptCause(from: AttemptStatus | null, to: AttemptStatus): Cause {
  if (from === null) return { trigger: 'start_attempt', actor: 'system' };
  if (from === 'REQUIRES_REVIEW') return { trigger: 'operator_resolution', actor: 'operator' };
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
      return { trigger: 'merchant_cancel', actor: 'merchant' };
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
    store.events.push({
      id: `${payment.id.slice(0, 8)}-e${eventId}`,
      type,
      paymentId: payment.id,
      payload: { paymentId: payment.id, upstreamReference: payment.upstreamReference, ...payload },
      createdAt: iso(atMs),
      publishedAt: recent && random.next() < 0.4 ? null : iso(atMs + random.int(1, 5) * SECOND),
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
      transition('PAYMENT_TRANSACTION', attempt.id, previous, status, attemptCause(previous, status), clock, review ?? null);

      attempt.status = status;
      attempt.updatedAt = iso(clock);
      if (status === 'PENDING') {
        attempt.providerRef = plan.gateway === 'stripe' ? `pi_${random.token(24)}` : `FAKE-${random.token(10).toUpperCase()}`;
      }
      if (review) {
        attempt.reviewReason = review;
        attempt.reviewOpenedAt = iso(clock);
        attempt.refundRequired = review !== 'AMBIGUOUS_PROVIDER_STATUS';
        // The provider reported less than the Payment Amount (decimal strings, no float drift for whole VND).
        if (review === 'AMOUNT_MISMATCH') attempt.providerReportedAmount = String(Math.floor(Number(payment.amount) * 0.9));
        emit('PaymentRequiresReview', clock, {
          status: payment.status,
          attemptId: attempt.id,
          gatewayId: attempt.gatewayId,
          reviewReason: review,
          refundRequired: attempt.refundRequired,
          reviewOpenedAt: attempt.reviewOpenedAt,
        });
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
      payment.status === 'CANCELLED'
        ? { trigger: 'merchant_cancel', actor: 'merchant' }
        : payment.status === 'EXPIRED'
          ? { trigger: 'expiry', actor: 'system' }
          : { trigger: 'webhook', actor: 'system' };
    transition('PAYMENT', payment.id, 'PENDING', payment.status, cause, paymentClosedMs);
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
