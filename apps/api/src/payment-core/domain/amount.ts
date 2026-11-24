import { InvalidAmountError, UnsupportedCurrencyError } from './errors.js';

/**
 * Supported currencies and the fraction digits each allows (spec: Amount and
 * currency). Phase 1 accepts VND only. Adding a currency here needs no schema
 * change: the column keeps four decimal places.
 */
const FRACTION_DIGITS: Readonly<Record<string, number>> = { VND: 0 };

/** Integer digits that fit `numeric(19,4)`. */
const MAX_INTEGER_DIGITS = 15;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Money in the currency's major unit (VND: whole dong), as an exact decimal string. */
export interface Amount {
  readonly value: string;
  readonly currency: string;
}

/**
 * Validates and normalises an amount: a supported currency, a plain positive
 * decimal, and no more significant fraction digits than the currency allows.
 * `"150000.00"` is accepted as `"150000"`.
 */
export function parseAmount(value: string, currency: string): Amount {
  const fractionDigits = Object.hasOwn(FRACTION_DIGITS, currency)
    ? FRACTION_DIGITS[currency]
    : undefined;
  if (fractionDigits === undefined) {
    throw new UnsupportedCurrencyError(currency);
  }

  const match = DECIMAL.exec(value);
  if (!match) {
    throw new InvalidAmountError(
      `Amount ${JSON.stringify(value)} must be a positive decimal number such as "150000"`,
    );
  }
  const integer = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');

  if (fraction.length > fractionDigits) {
    throw new InvalidAmountError(
      `Amount ${value} has more fraction digits than ${currency} allows (${fractionDigits})`,
    );
  }
  if (integer === '0' && fraction === '') {
    throw new InvalidAmountError('Amount must be greater than zero');
  }
  if (integer.length > MAX_INTEGER_DIGITS) {
    throw new InvalidAmountError(
      `Amount ${value} is too large (at most ${MAX_INTEGER_DIGITS} integer digits)`,
    );
  }

  return { value: fraction ? `${integer}.${fraction}` : integer, currency };
}
