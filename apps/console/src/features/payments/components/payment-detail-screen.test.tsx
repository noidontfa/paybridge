import { OperatorProvider } from '@/lib/operator';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers } from '@/mocks/handlers';
import { MockStore, type MockAttempt, type MockPayment } from '@/mocks/store';
import { PaymentDetailScreen } from './payment-detail-screen';

const NOW = new Date();
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function payment(overrides: Partial<MockPayment> & Pick<MockPayment, 'id' | 'upstreamReference'>): MockPayment {
  return {
    amount: '150000',
    currency: 'VND',
    status: 'PENDING',
    expiresAt: ago(-30 * MINUTE),
    createdAt: ago(10 * MINUTE),
    updatedAt: ago(5 * MINUTE),
    ...overrides,
  };
}

function attempt(overrides: Partial<MockAttempt> & Pick<MockAttempt, 'id' | 'paymentId' | 'gatewayId'>): MockAttempt {
  return {
    status: 'PENDING',
    providerRef: null,
    refundRequired: false,
    createdAt: ago(9 * MINUTE),
    updatedAt: ago(8 * MINUTE),
    ...overrides,
  };
}

const store = new MockStore(NOW);
store.payments.push(
  payment({ id: 'pay-switch', upstreamReference: 'order-switch', amount: '1250000' }),
  payment({ id: 'pay-review', upstreamReference: 'order-review', status: 'PENDING' }),
);
store.attempts.push(
  attempt({ id: 'att-1', paymentId: 'pay-switch', gatewayId: 'stripe', status: 'FAILED', providerRef: 'pi_first', createdAt: ago(9 * MINUTE) }),
  attempt({
    id: 'att-2',
    paymentId: 'pay-switch',
    gatewayId: 'fake',
    status: 'PENDING',
    providerRef: 'FAKE-2',
    nextAction: { type: 'REDIRECT', url: 'https://fake.example/pay/2' },
    createdAt: ago(6 * MINUTE),
  }),
  attempt({
    id: 'att-review',
    paymentId: 'pay-review',
    gatewayId: 'stripe',
    status: 'REQUIRES_REVIEW',
    providerRef: 'pi_review',
    reviewReason: 'AMBIGUOUS_PROVIDER_STATUS',
    reviewOpenedAt: ago(3 * DAY + MINUTE),
    refundRequired: true,
  }),
);
store.transitions.push(
  { id: 't1', entityType: 'PAYMENT_TRANSACTION', entityId: 'att-1', fromStatus: null, toStatus: 'CREATED', trigger: 'start_attempt', actor: 'system', reason: null, createdAt: ago(9 * MINUTE) },
  { id: 't2', entityType: 'PAYMENT_TRANSACTION', entityId: 'att-1', fromStatus: 'CREATED', toStatus: 'FAILED', trigger: 'gateway_rejected', actor: 'system', reason: 'card declined', createdAt: ago(8 * MINUTE) },
);
store.events.push({
  id: 'ev1',
  type: 'PaymentCreated',
  paymentId: 'pay-switch',
  payload: {},
  createdAt: ago(10 * MINUTE),
  publishedAt: null,
});

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderScreen(id: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={{ id: 'operator', name: 'Operator' }}>
        <PaymentDetailScreen id={id} />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe('Payment detail screen', () => {
  it('shows skeletons while loading', () => {
    renderScreen('pay-switch');
    expect(screen.getByRole('status', { name: 'Loading payment' })).toBeInTheDocument();
  });

  it('tells the story of a Payment with a gateway switch', async () => {
    renderScreen('pay-switch');

    expect(await screen.findByText('order-switch')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Payment summary' });
    expect(within(summary).getByText(/1\.250\.000/)).toBeInTheDocument();
    expect(within(summary).getByText('Pending')).toBeInTheDocument();

    const timeline = screen.getByRole('list', { name: 'PaymentTransactions' });
    const [first, second] = within(timeline).getAllByRole('listitem', { name: /PaymentTransaction/ });
    expect(within(first!).getByText('stripe')).toBeInTheDocument();
    expect(within(first!).getAllByText('Failed').length).toBeGreaterThan(0);
    expect(within(first!).getByText('pi_first')).toBeInTheDocument();
    expect(within(second!).getByText('fake')).toBeInTheDocument();
    expect(within(second!).getAllByText('Pending').length).toBeGreaterThan(0);
    expect(within(second!).getByText('Redirect')).toBeInTheDocument();
    expect(within(second!).getByText(/Switched from stripe/)).toBeInTheDocument();

    // Status history from the audit trail.
    expect(within(first!).getByText('gateway_rejected')).toBeInTheDocument();
    expect(within(first!).getByText('card declined')).toBeInTheDocument();

    // Payment Events.
    const events = screen.getByRole('region', { name: 'Payment Events' });
    expect(within(events).getByText('PaymentCreated')).toBeInTheDocument();
    expect(within(events).getByText('Unpublished')).toBeInTheDocument();
  });

  it('offers no cancel action', async () => {
    renderScreen('pay-switch');
    await screen.findByText('order-switch');
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('shows the review reason, how long it has been open and that a refund is required', async () => {
    renderScreen('pay-review');
    await screen.findByText('order-review');

    const review = screen.getByRole('group', { name: 'Review' });
    expect(within(review).getByText('Ambiguous status')).toBeInTheDocument();
    expect(within(review).getByText(/Open for 3 days/)).toBeInTheDocument();
    expect(within(review).getByText(/Refund required/)).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();
  });

  it('copies the Payment id, Upstream Reference and Attempt Key with one click', async () => {
    const user = userEvent.setup();
    renderScreen('pay-switch');
    await screen.findByText('order-switch');

    await user.click(screen.getByRole('button', { name: 'Copy Payment id' }));
    expect(await navigator.clipboard.readText()).toBe('pay-switch');
    await user.click(screen.getByRole('button', { name: 'Copy Upstream Reference' }));
    expect(await navigator.clipboard.readText()).toBe('order-switch');
    await user.click(screen.getAllByRole('button', { name: 'Copy Attempt Key' })[1]!);
    expect(await navigator.clipboard.readText()).toBe('att-2');
  });

  it('shows a not-found state for an unknown id', async () => {
    renderScreen('nope');
    expect(await screen.findByRole('heading', { name: 'Payment not found' })).toBeInTheDocument();
    expect(screen.getByText(/nope/)).toBeInTheDocument();
  });

  it('shows the API error with a retry that recovers', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/bff/internal/payments/:id', () =>
        HttpResponse.json({ statusCode: 500, message: 'database is down', code: 'INTERNAL_ERROR' }, { status: 500 }),
        { once: true },
      ),
    );
    renderScreen('pay-switch');

    expect(await screen.findByText('database is down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('order-switch')).toBeInTheDocument();
  });

  it('reports a response that does not match the contract', async () => {
    server.use(http.get('*/api/bff/internal/payments/:id', () => HttpResponse.json({ id: 'x' })));
    renderScreen('pay-switch');
    expect(await screen.findByText(/did not match the expected shape/)).toBeInTheDocument();
  });
});
