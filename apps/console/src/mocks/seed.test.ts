import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATUSES, PAYMENT_EVENT_TYPES, PAYMENT_STATUSES, REVIEW_REASONS } from '@/lib/api/schemas';
import { operatorPaymentSchema } from '@/lib/api/schemas';
import { SEED_NOW, createSeededStore } from './seed';

const store = createSeededStore();

describe('seeded mock store', () => {
  it('is deterministic for the same seed and a different world for another', () => {
    expect(createSeededStore().payments).toEqual(store.payments);
    expect(createSeededStore({ seed: 7 }).payments[0]?.id).not.toBe(store.payments[0]?.id);
  });

  it('holds several hundred Payments', () => {
    expect(store.payments.length).toBeGreaterThanOrEqual(300);
  });

  it('covers every Payment status, PaymentTransaction status and review reason', () => {
    expect(new Set(store.payments.map((p) => p.status))).toEqual(new Set(PAYMENT_STATUSES));
    expect(new Set(store.attempts.map((a) => a.status))).toEqual(new Set(ATTEMPT_STATUSES));
    expect(new Set(store.attempts.flatMap((a) => (a.reviewReason ? [a.reviewReason] : [])))).toEqual(
      new Set(REVIEW_REASONS),
    );
  });

  it('uses only the stripe and fake gateways', () => {
    expect(new Set(store.attempts.map((a) => a.gatewayId))).toEqual(new Set(['stripe', 'fake']));
  });

  it('contains gateway switches and late successes', () => {
    const switched = store.payments.filter((p) => new Set(store.attemptsOf(p.id).map((a) => a.gatewayId)).size > 1);
    expect(switched.length).toBeGreaterThan(0);
    const late = store.attempts.filter((a) => a.reviewReason === 'LATE_SUCCESS_ON_CLOSED_PAYMENT');
    expect(late.length).toBeGreaterThan(0);
    for (const attempt of late) {
      expect(['EXPIRED', 'CANCELLED']).toContain(store.getPayment(attempt.paymentId)?.status);
    }
  });

  it('keeps no time after the fixed "now"', () => {
    for (const t of store.transitions) expect(new Date(t.createdAt).getTime()).toBeLessThanOrEqual(SEED_NOW.getTime());
    for (const e of store.events) expect(new Date(e.createdAt).getTime()).toBeLessThanOrEqual(SEED_NOW.getTime());
  });

  it('ends every status trail on the entity current status, and chains from/to', () => {
    for (const payment of store.payments) {
      const trail = store.transitionsOf(payment.id);
      expect(trail.at(-1)?.toStatus).toBe(payment.status);
      expect(trail[0]?.fromStatus).toBeNull();
    }
    for (const attempt of store.attempts) {
      const trail = store.transitionsOf(attempt.id);
      expect(trail.at(-1)?.toStatus).toBe(attempt.status);
      trail.slice(1).forEach((step, i) => expect(step.fromStatus).toBe(trail[i]?.toStatus));
    }
  });

  it('emits a Payment Event for creation, for every closing status and for every Review', () => {
    for (const payment of store.payments) {
      const types = store.eventsOf(payment.id).map((e) => e.type);
      expect(types).toContain('PaymentCreated');
      const closing = { SUCCEEDED: 'PaymentSucceeded', CANCELLED: 'PaymentCancelled', EXPIRED: 'PaymentExpired' } as const;
      if (payment.status !== 'PENDING') expect(types).toContain(closing[payment.status]);
      const attemptIds = new Set(store.attemptsOf(payment.id).map((a) => a.id));
      // A Review opens when an attempt enters REQUIRES_REVIEW (resolved ones count too).
      const reviews = store.transitions.filter(
        (t) => attemptIds.has(t.entityId) && t.toStatus === 'REQUIRES_REVIEW' && t.fromStatus !== 'REQUIRES_REVIEW',
      ).length;
      expect(types.filter((t) => t === 'PaymentRequiresReview')).toHaveLength(reviews);
    }
    expect(store.events.some((e) => e.publishedAt === null)).toBe(true);
    expect(store.events.some((e) => e.publishedAt !== null)).toBe(true);
  });

  it('has published and unpublished Payment Events of every type', () => {
    for (const type of PAYMENT_EVENT_TYPES) {
      const ofType = store.events.filter((e) => e.type === type);
      expect(ofType.some((e) => e.publishedAt === null), `unpublished ${type}`).toBe(true);
      expect(ofType.some((e) => e.publishedAt !== null), `published ${type}`).toBe(true);
    }
  });

  it('records every trigger Core uses, including operator resolutions and notes', () => {
    expect(new Set(store.transitions.map((t) => t.trigger))).toEqual(
      new Set([
        'create_payment', 'start_attempt', 'gateway_accepted', 'gateway_rejected', 'gateway_switch',
        'webhook', 'status_query', 'expiry', 'merchant_cancel', 'operator_resolution', 'operator_note',
      ]),
    );
    for (const t of store.transitions.filter((t) => t.trigger.startsWith('operator_'))) {
      expect(t.actor).toMatch(/^operator/);
      expect(t.reason).toBeTruthy();
    }
    const note = store.transitions.find((t) => t.trigger === 'operator_note')!;
    expect(note.fromStatus).toBe('REQUIRES_REVIEW');
    expect(note.toStatus).toBe('REQUIRES_REVIEW');
  });

  it('assembles every Payment into a valid operator Payment detail', () => {
    for (const payment of store.payments) {
      expect(() => operatorPaymentSchema.parse(store.getOperatorPayment(payment.id))).not.toThrow();
    }
    expect(store.getOperatorPayment('does-not-exist')).toBeUndefined();
  });
});
