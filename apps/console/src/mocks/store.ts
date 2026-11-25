/**
 * The in-memory fixture store behind every MSW handler. It holds the API's
 * records (flat, like the database) and assembles the API's response shapes
 * from them.
 *
 * Extension point: later tickets add a collection (Callbacks, ...) as another
 * array plus an accessor here, seed it in `./seed.ts`, and serve it from
 * `./handlers.ts`. Mutating handlers push to / edit these arrays directly.
 */
import type { CallbackStatus } from '@/lib/api/callbacks';
import type {
  AttemptStatus,
  NextAction,
  OperatorPayment,
  PaymentEvent,
  PaymentStatus,
  ReviewReason,
  StatusTransition,
} from '@/lib/api/schemas';

export interface MockPayment {
  id: string;
  upstreamReference: string;
  amount: string;
  currency: 'VND';
  status: PaymentStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockAttempt {
  id: string;
  paymentId: string;
  gatewayId: string;
  status: AttemptStatus;
  providerRef: string | null;
  nextAction?: NextAction;
  reviewReason?: ReviewReason;
  reviewOpenedAt?: string;
  refundRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A row of the webhook inbox (a Callback), body and all. */
export interface MockCallback {
  id: string;
  gatewayId: string;
  providerEventId: string | null;
  attemptKey: string | null;
  status: CallbackStatus;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  headers: Record<string, string>;
  query: Record<string, string>;
  rawBody: string;
  lastError: string | null;
}

export class MockStore {
  constructor(
    readonly now: Date,
    readonly payments: MockPayment[] = [],
    readonly attempts: MockAttempt[] = [],
    readonly transitions: StatusTransition[] = [],
    readonly events: PaymentEvent[] = [],
    readonly callbacks: MockCallback[] = [],
  ) {}

  getCallback(id: string): MockCallback | undefined {
    return this.callbacks.find((c) => c.id === id);
  }

  getPayment(id: string): MockPayment | undefined {
    return this.payments.find((p) => p.id === id);
  }

  /** Oldest first. */
  attemptsOf(paymentId: string): MockAttempt[] {
    return this.attempts.filter((a) => a.paymentId === paymentId).sort(byCreatedAt);
  }

  /** The status trail of a Payment or an attempt, oldest first. */
  transitionsOf(entityId: string): StatusTransition[] {
    return this.transitions.filter((t) => t.entityId === entityId).sort(byCreatedAt);
  }

  /** Oldest first. */
  eventsOf(paymentId: string): PaymentEvent[] {
    return this.events.filter((e) => e.paymentId === paymentId).sort(byCreatedAt);
  }

  /** The operator Payment detail response (`GET /internal/payments/:id`). */
  getOperatorPayment(id: string): OperatorPayment | undefined {
    const payment = this.getPayment(id);
    if (!payment) return undefined;
    return {
      ...payment,
      attempts: this.attemptsOf(id).map(({ paymentId: _paymentId, ...attempt }) => ({
        ...attempt,
        transitions: this.transitionsOf(attempt.id),
      })),
      events: this.eventsOf(id),
    };
  }
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
