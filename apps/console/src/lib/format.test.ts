import { describe, expect, it } from 'vitest';
import {
  formatAbsoluteTime,
  formatMoney,
  formatOpenFor,
  formatRelativeTime,
} from './format';

const plain = (text: string) => text.replace(/ /g, ' ');

describe('formatMoney', () => {
  it.each([
    ['150000', '150.000 ₫'],
    ['0', '0 ₫'],
    ['999', '999 ₫'],
    ['1000000', '1.000.000 ₫'],
    ['150000.0000', '150.000 ₫'],
    ['150000.50', '150.000,5 ₫'],
    ['-2500', '-2.500 ₫'],
  ])('formats %s as %s', (amount, expected) => {
    expect(plain(formatMoney(amount))).toBe(expected);
  });

  it('keeps every digit of amounts beyond float precision', () => {
    expect(plain(formatMoney('9007199254740993'))).toBe(
      '9.007.199.254.740.993 ₫',
    );
  });

  it('rejects a value that is not a decimal string', () => {
    expect(() => formatMoney('12abc')).toThrow(/decimal/);
    expect(() => formatMoney('')).toThrow(/decimal/);
  });
});

describe('time formatting', () => {
  const at = new Date(2026, 10, 25, 14, 30, 5);

  it('shows local absolute time', () => {
    expect(formatAbsoluteTime(at.toISOString())).toBe('25 Nov 2026, 14:30:05');
  });

  it('adds a relative hint, in the past and in the future', () => {
    const now = new Date(2026, 10, 25, 15, 30, 5);
    expect(formatRelativeTime(at.toISOString(), now)).toBe('1 hour ago');
    expect(
      formatRelativeTime(new Date(2026, 10, 25, 16, 30, 5).toISOString(), now),
    ).toBe('in 1 hour');
  });

  it('says how long a Review has been open', () => {
    const now = new Date(2026, 10, 28, 14, 30, 5);
    expect(formatOpenFor(at.toISOString(), now)).toBe('3 days');
  });
});
