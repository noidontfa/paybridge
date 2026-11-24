import type { Payment } from '../domain/payment.js';
import type {
  PaymentTransaction,
  PaymentTransactionChanges,
} from '../domain/payment-transaction.js';
import type { NewOutboxEvent, NewStatusTransition } from '../domain/records.js';
import type { Repositories } from '../infrastructure/prisma/repositories.js';
import { applyProviderOutcome } from './apply-provider-outcome.js';

// The database forbids two open attempts on one Payment (invariant 6a), so
// the "cancel the other open attempts" path is exercised here with in-memory
// repositories. The Postgres behaviour is covered by
// test/payment-core/process-webhook.int-spec.ts.

const NOW = new Date('2026-05-01T10:00:00.000Z');

function attempt(id: string, status: PaymentTransaction['status']) {
  return {
    id,
    paymentId: 'pay-1',
    gatewayId: 'fake',
    status,
    providerRef: null,
    providerMetadata: null,
    nextAction: null,
    reviewReason: null,
    reviewOpenedAt: null,
    refundRequired: false,
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies PaymentTransaction;
}

function inMemory(payment: Payment) {
  let current = payment;
  const transitions: NewStatusTransition[] = [];
  const outbox: NewOutboxEvent[] = [];
  const updateAttempt = (id: string, changes: PaymentTransactionChanges) => {
    let updated!: PaymentTransaction;
    current = {
      ...current,
      attempts: current.attempts.map((a) =>
        a.id === id ? (updated = { ...a, ...changes }) : a,
      ),
    };
    return Promise.resolve(updated);
  };
  const repos = {
    payments: {
      updateAttempt,
      update: (_id: string, changes: Partial<Payment>) =>
        Promise.resolve((current = { ...current, ...changes })),
      findById: () => Promise.resolve(current),
    },
    statusTransitions: {
      record: (t: NewStatusTransition) => {
        transitions.push(t);
        return Promise.resolve(t);
      },
    },
    outbox: {
      add: (e: NewOutboxEvent) => {
        outbox.push(e);
        return Promise.resolve(e);
      },
    },
  } as unknown as Repositories;
  return { repos, transitions, outbox };
}

const payment: Payment = {
  id: 'pay-1',
  merchantOrderId: 'order-1',
  amount: '150000',
  currency: 'VND',
  status: 'PENDING',
  expiresAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  attempts: [
    attempt('old', 'FAILED'),
    attempt('other', 'CREATED'),
    attempt('paid', 'PENDING'),
  ],
};

it('a success cancels the other open attempts locally and returns them for the provider cancel', async () => {
  const { repos, transitions, outbox } = inMemory(payment);

  const result = await applyProviderOutcome(repos, {
    payment,
    attemptId: 'paid',
    outcome: { status: 'SUCCEEDED', amount: '150000' },
    cause: { trigger: 'webhook', actor: 'system' },
    now: NOW,
  });

  expect(result.paymentChanged).toBe(true);
  expect(result.payment.status).toBe('SUCCEEDED');
  expect(result.cancelledAttempts.map((a) => [a.id, a.status])).toEqual([
    ['other', 'CANCELLED'],
  ]);
  expect(result.payment.attempts.map((a) => [a.id, a.status])).toEqual([
    ['old', 'FAILED'],
    ['other', 'CANCELLED'],
    ['paid', 'SUCCEEDED'],
  ]);
  expect(transitions.map((t) => [t.entityId, t.toStatus])).toEqual([
    ['paid', 'SUCCEEDED'],
    ['pay-1', 'SUCCEEDED'],
    ['other', 'CANCELLED'],
  ]);
  expect(outbox.map((e) => e.eventType)).toEqual(['PaymentSucceeded']);
});

it('a failure cancels nothing and leaves the Payment as it is', async () => {
  const { repos, outbox } = inMemory(payment);

  const result = await applyProviderOutcome(repos, {
    payment,
    attemptId: 'paid',
    outcome: { status: 'FAILED', amount: null },
    cause: { trigger: 'webhook', actor: 'system' },
    now: NOW,
  });

  expect(result.paymentChanged).toBe(false);
  expect(result.cancelledAttempts).toEqual([]);
  expect(result.attempt.status).toBe('FAILED');
  expect(outbox).toEqual([]);
});
