import { parseAmount } from './amount.js';
import { InvalidAmountError, UnsupportedCurrencyError } from './errors.js';

describe('parseAmount', () => {
  it('accepts a whole-dong VND amount', () => {
    expect(parseAmount('150000', 'VND')).toEqual({
      value: '150000',
      currency: 'VND',
    });
  });

  it('normalises leading zeros and zero fraction digits', () => {
    expect(parseAmount('00150000', 'VND').value).toBe('150000');
    expect(parseAmount('150000.00', 'VND').value).toBe('150000');
  });

  it.each(['0', '0.00', '-1', '-150000'])(
    'rejects the zero or negative amount %s',
    (value) => {
      expect(() => parseAmount(value, 'VND')).toThrow(InvalidAmountError);
    },
  );

  it.each(['150000.5', '1.01', '0.1'])(
    'rejects %s: VND allows no fraction digits',
    (value) => {
      expect(() => parseAmount(value, 'VND')).toThrow(
        /more fraction digits than VND allows/,
      );
    },
  );

  it.each(['', 'abc', '1e6', '1,000', ' 1000', '1000.', '.5', '+1000'])(
    'rejects the malformed amount %j',
    (value) => {
      expect(() => parseAmount(value, 'VND')).toThrow(InvalidAmountError);
    },
  );

  it('rejects an amount too large for the stored precision', () => {
    expect(parseAmount('999999999999999', 'VND').value).toBe('999999999999999');
    expect(() => parseAmount('1000000000000000', 'VND')).toThrow(
      InvalidAmountError,
    );
  });

  it.each(['USD', 'vnd', 'EUR', ''])(
    'rejects the currency %j: Phase 1 accepts only VND',
    (currency) => {
      expect(() => parseAmount('150000', currency)).toThrow(
        UnsupportedCurrencyError,
      );
    },
  );
});
