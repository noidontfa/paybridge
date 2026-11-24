import { InvalidExpiryError } from './errors.js';
import { resolvePaymentExpiry } from './payment-expiry.js';

const now = new Date('2026-05-01T10:00:00.000Z');

describe('resolvePaymentExpiry', () => {
  it('defaults to 30 minutes after creation', () => {
    expect(resolvePaymentExpiry(undefined, now)).toEqual(
      new Date('2026-05-01T10:30:00.000Z'),
    );
  });

  it.each([
    ['exactly 30 minutes', '2026-05-01T10:30:00.000Z'],
    ['2 hours', '2026-05-01T12:00:00.000Z'],
    ['exactly 24 hours', '2026-05-02T10:00:00.000Z'],
  ])('accepts an expiry %s after creation', (_label, at) => {
    expect(resolvePaymentExpiry(new Date(at), now)).toEqual(new Date(at));
  });

  it.each([
    ['in the past', '2026-05-01T09:00:00.000Z'],
    ['1 ms under 30 minutes', '2026-05-01T10:29:59.999Z'],
    ['1 ms over 24 hours', '2026-05-02T10:00:00.001Z'],
    ['a week', '2026-05-08T10:00:00.000Z'],
  ])('rejects an expiry %s after creation', (_label, at) => {
    expect(() => resolvePaymentExpiry(new Date(at), now)).toThrow(
      InvalidExpiryError,
    );
  });
});
