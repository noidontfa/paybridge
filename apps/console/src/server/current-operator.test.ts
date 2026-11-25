import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getCurrentOperator, DEFAULT_OPERATOR } = await import('./current-operator');

describe('getCurrentOperator', () => {
  it('returns the configured identity', () => {
    expect(getCurrentOperator({ CONSOLE_OPERATOR_ID: 'op-9', CONSOLE_OPERATOR_NAME: 'Linh Tran' })).toEqual({ id: 'op-9', name: 'Linh Tran' });
  });

  it('falls back to the default Operator, and uses the id as the name when only an id is set', () => {
    expect(getCurrentOperator({})).toEqual(DEFAULT_OPERATOR);
    expect(getCurrentOperator({ CONSOLE_OPERATOR_ID: 'op-9' })).toEqual({ id: 'op-9', name: 'op-9' });
  });
});
