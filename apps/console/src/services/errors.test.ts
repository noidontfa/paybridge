import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema } from './errors';

describe('apiErrorBodySchema', () => {
  it('accepts the API error envelope', () => {
    const body = apiErrorBodySchema.parse({
      statusCode: 404,
      error: 'Not Found',
      message: 'Payment x not found',
      code: 'PAYMENT_NOT_FOUND',
      path: '/internal/payments/x',
      method: 'GET',
      timestamp: '2026-11-25T03:00:00.000Z',
      requestId: 'r1',
    });
    expect(body.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('accepts a validation error with a message list and no code', () => {
    expect(apiErrorBodySchema.parse({ statusCode: 400, message: ['a', 'b'] }).message).toEqual(['a', 'b']);
  });
});
