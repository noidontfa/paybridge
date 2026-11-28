import { describe, expect, it } from 'vitest';
import { resolutionFormSchema } from './review-resolution-form';

const schema = resolutionFormSchema('100000.00');
const messages = (input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('resolutionFormSchema', () => {
  it('trims the note and accepts a status change with an equal amount, compared as decimals', () => {
    const result = schema.safeParse({ action: 'SUCCEEDED', note: '  checked  ', amount: ' 100000 ' });
    expect(result.data).toEqual({ action: 'SUCCEEDED', note: 'checked', amount: '100000' });
  });

  it('requires a note', () => {
    expect(messages({ action: 'FAILED', note: '   ', amount: '' })).toEqual(['note: Enter a note explaining the decision.']);
  });

  it('limits the trimmed note to 2000 characters', () => {
    expect(messages({ action: 'FAILED', note: 'x'.repeat(2000), amount: '' })).toEqual([]);
    expect(messages({ action: 'FAILED', note: 'x'.repeat(2001), amount: '' })).toEqual(['note: The note can be at most 2000 characters.']);
    expect(messages({ action: 'FAILED', note: ` ${'x'.repeat(2000)} `, amount: '' })).toEqual([]);
  });

  it('requires an amount for SUCCEEDED only', () => {
    expect(messages({ action: 'SUCCEEDED', note: 'n', amount: '' })).toEqual(['amount: Enter the amount the PaymentGateway collected.']);
    expect(messages({ action: 'FAILED', note: 'n', amount: '' })).toEqual([]);
    expect(messages({ action: 'NOTE', note: 'n', amount: 'junk' })).toEqual([]);
  });

  it('rejects an amount that is not a decimal, or differs from the Payment Amount', () => {
    expect(messages({ action: 'SUCCEEDED', note: 'n', amount: '1e5' })).toEqual(['amount: Enter a number, for example 100000.']);
    expect(messages({ action: 'SUCCEEDED', note: 'n', amount: '99999.99' })).toEqual([
      'amount: The amount must equal the Payment Amount (100000.00).',
    ]);
    expect(messages({ action: 'SUCCEEDED', note: 'n', amount: '100000.0000' })).toEqual([]);
  });
});
