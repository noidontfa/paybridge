import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OperatorAttempt } from '@/features/payments/schemas';
import { OperatorProvider } from '@/features/auth/components/operator-provider';
import type { Operator } from '@/features/auth/utils/operator';
import { ReviewPanel } from './review-panel';

const HOUR = 3_600_000;
const attempt: OperatorAttempt = {
  id: 'att-1',
  gatewayId: 'fake',
  status: 'REQUIRES_REVIEW',
  providerRef: null,
  reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
  reviewOpenedAt: new Date(Date.now() - 100 * HOUR).toISOString(),
  refundRequired: false,
  createdAt: new Date(Date.now() - 101 * HOUR).toISOString(),
  updatedAt: new Date(Date.now() - 100 * HOUR).toISOString(),
  transitions: [],
};
const payment = { id: 'pay-1', status: 'PENDING' as const, amount: '100000', currency: 'VND' };

function renderPanel(operator: Operator) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OperatorProvider operator={operator}>
        <ReviewPanel attempt={attempt} payment={payment} />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe('ReviewPanel and the Permission to resolve Reviews', () => {
  it('offers the resolution form to a User who may resolve Reviews', () => {
    renderPanel({ id: 'u', name: 'Una', permissions: ['payments:view', 'reviews:resolve'] });
    expect(screen.getByRole('form', { name: 'Resolve Review' })).toBeInTheDocument();
  });

  it('hides the form from a User who may not, and says why', () => {
    renderPanel({ id: 'u', name: 'Una', permissions: ['payments:view'] });
    expect(screen.queryByRole('form', { name: 'Resolve Review' })).not.toBeInTheDocument();
    expect(screen.getByText('You do not have permission to resolve Reviews.')).toBeInTheDocument();
  });
});
