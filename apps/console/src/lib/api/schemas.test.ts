import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema, operatorPaymentSchema } from './schemas';

const sample = {
  id: '6f1c2c1e-6b0f-4d6e-9a53-0d2a3f6a9c11',
  upstreamReference: 'order-2026-0001',
  amount: '150000',
  currency: 'VND',
  status: 'PENDING',
  expiresAt: '2026-11-25T04:00:00.000Z',
  createdAt: '2026-11-25T03:00:00.000Z',
  updatedAt: '2026-11-25T03:05:00.000Z',
  checkoutOrigin: { pricingPlanId: 'plan-pro', pricingPlanName: 'Pro', customerReference: 'user-42', customerEmail: null },
  attempts: [
    {
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      gatewayId: 'stripe',
      status: 'REQUIRES_REVIEW',
      providerRef: 'pi_123',
      reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
      reviewOpenedAt: '2026-11-25T03:10:00.000Z',
      refundRequired: true,
      createdAt: '2026-11-25T03:00:00.000Z',
      updatedAt: '2026-11-25T03:10:00.000Z',
      transitions: [
        {
          id: 't1',
          entityType: 'PAYMENT_TRANSACTION',
          entityId: 'a1b2c3d4-0000-4000-8000-000000000001',
          fromStatus: 'PENDING',
          toStatus: 'REQUIRES_REVIEW',
          trigger: 'status_query',
          actor: 'system',
          reason: 'AMBIGUOUS_PROVIDER_STATUS',
          createdAt: '2026-11-25T03:10:00.000Z',
        },
      ],
    },
    {
      id: 'a1b2c3d4-0000-4000-8000-000000000002',
      gatewayId: 'fake',
      status: 'PENDING',
      providerRef: null,
      nextAction: { type: 'REDIRECT', url: 'https://fake.example/pay/1' },
      refundRequired: false,
      createdAt: '2026-11-25T03:11:00.000Z',
      updatedAt: '2026-11-25T03:11:00.000Z',
      transitions: [],
    },
  ],
  events: [
    {
      id: 'e1',
      type: 'PaymentCreated',
      paymentId: '6f1c2c1e-6b0f-4d6e-9a53-0d2a3f6a9c11',
      payload: { amount: '150000' },
      createdAt: '2026-11-25T03:00:00.000Z',
      publishedAt: null,
    },
  ],
};

describe('operatorPaymentSchema', () => {
  it('accepts the operator Payment detail response', () => {
    const parsed = operatorPaymentSchema.parse(sample);
    expect(parsed.attempts[0]?.reviewReason).toBe('AMBIGUOUS_PROVIDER_STATUS');
    expect(parsed.attempts[1]?.nextAction).toEqual({ type: 'REDIRECT', url: 'https://fake.example/pay/1' });
    expect(parsed.events[0]?.publishedAt).toBeNull();
  });

  it('keeps the amount as the decimal string', () => {
    expect(operatorPaymentSchema.parse(sample).amount).toBe('150000');
  });

  it('rejects an unknown Payment status', () => {
    expect(operatorPaymentSchema.safeParse({ ...sample, status: 'PAID' }).success).toBe(false);
  });

  it('rejects a numeric amount', () => {
    expect(operatorPaymentSchema.safeParse({ ...sample, amount: 150000 }).success).toBe(false);
  });

  it('rejects an attempt without refundRequired', () => {
    const { refundRequired: _drop, ...broken } = sample.attempts[1]!;
    expect(operatorPaymentSchema.safeParse({ ...sample, attempts: [broken] }).success).toBe(false);
  });
});

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
