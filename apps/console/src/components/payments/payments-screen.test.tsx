import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '@/mocks/handlers';
import { MockStore, type MockAttempt, type MockPayment } from '@/mocks/store';
import { currentLocation, navigations, resetNavigation } from '@/test/fake-navigation';
import { PaymentsScreen } from './payments-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const NOW = new Date('2026-11-25T03:00:00.000Z');
const HOUR = 3_600_000;

// 25 Payments, newest first by number. Every third has SUCCEEDED; odd numbers used `fake`, even `stripe`.
function build(): MockStore {
  const store = new MockStore(NOW);
  for (let n = 1; n <= 25; n += 1) {
    const createdAt = new Date(NOW.getTime() - n * HOUR).toISOString();
    const payment: MockPayment = {
      id: `pay-${String(n).padStart(2, '0')}`,
      upstreamReference: `order-${String(n).padStart(2, '0')}`,
      // Amounts run opposite to age: the oldest is the cheapest.
      amount: String((26 - n) * 10_000),
      currency: 'VND',
      status: n % 3 === 0 ? 'SUCCEEDED' : 'PENDING',
      expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
      createdAt,
      updatedAt: createdAt,
    };
    store.payments.push(payment);
    const attempt: MockAttempt = {
      id: `att-${n}`,
      paymentId: payment.id,
      gatewayId: n % 2 === 0 ? 'stripe' : 'fake',
      status: payment.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING',
      providerRef: null,
      refundRequired: false,
      createdAt,
      updatedAt: createdAt,
    };
    store.attempts.push(attempt);
  }
  return store;
}

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store: build() }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetNavigation('/payments'));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PaymentsScreen />
    </QueryClientProvider>,
  );
}

const table = () => screen.getByRole('table', { name: 'Payments' });
/** Upstream References of the rows, in order. */
const refs = () =>
  within(table())
    .getAllByRole('link', { name: /^order-/ })
    .map((a) => a.textContent);
const optionNames = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('Payments list screen', () => {
  it('shows a loading state, then the Payments with status and the latest PaymentTransaction', async () => {
    renderScreen();
    expect(screen.getByRole('table', { name: 'Payments' })).toHaveAttribute('aria-busy', 'true');

    await screen.findByRole('link', { name: 'order-01' });
    expect(table()).toHaveAttribute('aria-busy', 'false');
    expect(refs()).toHaveLength(20);
    const row = screen.getByRole('link', { name: 'order-03' }).closest('tr')!;
    // Payment status and latest PaymentTransaction status.
    expect(within(row).getAllByText('Succeeded')).toHaveLength(2);
    expect(within(row).getByText('fake')).toBeInTheDocument();
    expect(within(row).getByText(/230\.000/)).toBeInTheDocument();
  });

  it('filters by status and keeps it in the URL', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('link', { name: 'order-01' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'SUCCEEDED');

    await waitFor(() => expect(refs()).toEqual(['order-03', 'order-06', 'order-09', 'order-12', 'order-15', 'order-18', 'order-21', 'order-24']));
    expect(currentLocation()).toBe('/payments?status=SUCCEEDED');
  });

  it('filters by gateway, combined with status', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('link', { name: 'order-01' });

    expect(optionNames(screen.getByRole('combobox', { name: 'Gateway' }))).toEqual(['All gateways', 'stripe', 'fake']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gateway' }), 'stripe');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'SUCCEEDED');

    await waitFor(() => expect(refs()).toEqual(['order-06', 'order-12', 'order-18', 'order-24']));
    expect(currentLocation()).toBe('/payments?status=SUCCEEDED&gatewayId=stripe');
  });

  it('filters by created date range', async () => {
    renderScreen();
    await screen.findByRole('link', { name: 'order-01' });

    // order-04 is 23:00 on the 24th; order-03 is 00:00 on the 25th.
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-11-25' } });
    await waitFor(() => expect(refs()).toEqual(['order-01', 'order-02', 'order-03']));
    fireEvent.change(screen.getByLabelText('Created to'), { target: { value: '2026-11-25' } });
    await waitFor(() => expect(currentLocation()).toBe('/payments?createdFrom=2026-11-25&createdTo=2026-11-25'));
  });

  it('searches by Payment id or Upstream Reference', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('link', { name: 'order-01' });

    await user.type(screen.getByRole('searchbox', { name: 'Search Payments' }), 'pay-07');
    await waitFor(() => expect(refs()).toEqual(['order-07']));
    expect(currentLocation()).toBe('/payments?q=pay-07');
  });

  it('sorts by Amount and by created time through the column headers', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('link', { name: 'order-01' });
    expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: /Amount/ }));
    // Amount is cheapest for the oldest, so descending amount is newest first, and ascending is oldest first.
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'descending'));
    expect(currentLocation()).toBe('/payments?sort=amount&order=desc');

    await user.click(screen.getByRole('button', { name: /Amount/ }));
    await waitFor(() => expect(refs()[0]).toBe('order-25'));
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(currentLocation()).toBe('/payments?sort=amount&order=asc');

    await user.click(screen.getByRole('button', { name: /Created/ }));
    await waitFor(() => expect(refs()[0]).toBe('order-01'));
  });

  it('loads the next page and appends it', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('link', { name: 'order-01' });
    expect(refs()).toHaveLength(20);

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(refs()).toHaveLength(25));
    expect(refs().at(-1)).toBe('order-25');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('starts from the filters in the URL', async () => {
    resetNavigation('/payments?status=SUCCEEDED&sort=amount&order=asc');
    renderScreen();
    await screen.findByRole('link', { name: 'order-24' });
    expect(refs()[0]).toBe('order-24');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('SUCCEEDED');
  });

  it('offers to clear the filters when nothing matches', async () => {
    const user = userEvent.setup();
    resetNavigation('/payments?q=no-such-payment&status=SUCCEEDED');
    renderScreen();

    expect(await screen.findByText('No Payments match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    await screen.findByRole('link', { name: 'order-01' });
    expect(currentLocation()).toBe('/payments');
    expect(screen.getByRole('searchbox', { name: 'Search Payments' })).toHaveValue('');
  });

  it('shows an empty state when there are no Payments at all', async () => {
    server.use(http.get('*/api/bff/internal/payments', () => HttpResponse.json({ items: [], nextCursor: null })));
    renderScreen();
    expect(await screen.findByText('No Payments yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows the API error and retries', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/bff/internal/payments', () =>
        HttpResponse.json({ statusCode: 500, message: 'The database is down', code: 'INTERNAL' }, { status: 500 }),
        { once: true },
      ),
    );
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The database is down');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    await screen.findByRole('link', { name: 'order-01' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('makes each row reachable by keyboard and opens the Payment', async () => {
    const user = userEvent.setup();
    renderScreen();
    const link = await screen.findByRole('link', { name: 'order-02' });
    expect(link).toHaveAttribute('href', '/payments/pay-02');

    // The link is in the tab order (a real anchor), and the rest of the row opens the Payment on click.
    expect(link).not.toHaveAttribute('tabindex', '-1');
    await user.click(within(link.closest('tr')!).getByText('stripe'));
    expect(navigations).toContain('/payments/pay-02');
  });
});
