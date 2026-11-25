import { describe, expect, it } from 'vitest';
import { queryCallbacks } from './callbacks';
import { queryPaymentEvents, queryStatusTransitions } from './events-audit';
import { queryReviews } from './reviews';
import { createSeededStore } from './seed';

const store = createSeededStore();
const params = (q: string) => new URLSearchParams({ q, limit: '100' });

describe('q search over the seeded store', () => {
  it('finds Reviews by Payment id, Upstream Reference or Attempt Key, case-insensitively', () => {
    const [first] = queryReviews(store, new URLSearchParams('limit=100')).items;
    expect(first).toBeDefined();
    for (const q of [first!.payment.id, first!.payment.upstreamReference.toUpperCase(), first!.id]) {
      expect(queryReviews(store, params(q)).items.map((r) => r.id)).toContain(first!.id);
    }
    expect(queryReviews(store, params('no-such-thing')).items).toEqual([]);
  });

  it('finds audit entries by the Payment they belong to', () => {
    const payment = store.payments[0]!;
    const items = queryStatusTransitions(store, params(payment.upstreamReference)).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => t.paymentId === payment.id)).toBe(true);
    expect(queryStatusTransitions(store, params('no-such-thing')).items).toEqual([]);
  });

  it('finds Callbacks by id, Provider Event id, Attempt Key or their Payment', () => {
    const named = store.callbacks.find((c) => c.attemptKey && store.attempts.some((a) => a.id === c.attemptKey));
    const cb = named ?? store.callbacks[0]!;
    expect(queryCallbacks(store, params(cb.id)).items.map((c) => c.id)).toContain(cb.id);
    if (cb.providerEventId) expect(queryCallbacks(store, params(cb.providerEventId)).items.map((c) => c.id)).toContain(cb.id);
    if (named) {
      const payment = store.getPayment(store.attempts.find((a) => a.id === named.attemptKey)!.paymentId)!;
      expect(queryCallbacks(store, params(payment.upstreamReference)).items.map((c) => c.id)).toContain(named.id);
    }
    expect(queryCallbacks(store, params('no-such-thing')).items).toEqual([]);
  });

  it('finds Payment Events by id, Payment id or Upstream Reference', () => {
    const event = store.events[0]!;
    const payment = store.getPayment(event.paymentId)!;
    for (const q of [event.id, payment.id, payment.upstreamReference.toUpperCase()]) {
      expect(queryPaymentEvents(store, params(q)).items.map((e) => e.id)).toContain(event.id);
    }
    expect(queryPaymentEvents(store, params('no-such-thing')).items).toEqual([]);
  });
});
