import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OverviewRange } from '@/features/overview/utils/overview-range';
import { createHandlers } from '@/mocks/handlers';
import { computeOverview } from '@/mocks/overview';
import { MockStore, type MockAttempt, type MockPayment } from '@/mocks/store';
import { OverviewScreen } from './overview-screen';

const NOW = new Date();
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function pay(id: string, status: MockPayment['status'], amount: string, hoursAgo: number): MockPayment {
  return {
    id,
    upstreamReference: `order-${id}`,
    amount,
    currency: 'VND',
    status,
    expiresAt: ago(hoursAgo - 1),
    createdAt: ago(hoursAgo),
    updatedAt: ago(hoursAgo),
  };
}

function att(id: string, paymentId: string, gatewayId: string, status: MockAttempt['status'], hoursAgo: number): MockAttempt {
  return { id, paymentId, gatewayId, status, providerRef: null, refundRequired: false, createdAt: ago(hoursAgo), updatedAt: ago(hoursAgo) };
}

const store = new MockStore(NOW);
store.payments.push(
  pay('a', 'SUCCEEDED', '100000', 2),
  pay('b', 'SUCCEEDED', '50000', 30),
  pay('c', 'CANCELLED', '70000', 3),
  pay('d', 'PENDING', '20000', 1),
  pay('e', 'EXPIRED', '10000', 24 * 10),
);
store.attempts.push(
  att('a1', 'a', 'stripe', 'SUCCEEDED', 2),
  att('b1', 'b', 'fake', 'SUCCEEDED', 30),
  att('c1', 'c', 'stripe', 'CANCELLED', 3),
  att('e1', 'e', 'fake', 'EXPIRED', 24 * 10),
  att('r1', 'c', 'stripe', 'REQUIRES_REVIEW', 2.5),
  att('r2', 'b', 'fake', 'REQUIRES_REVIEW', 5),
);

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Stands in for the page, which keeps the range in the URL. */
function Harness({ initial }: { initial: OverviewRange }) {
  const [range, setRange] = useState(initial);
  return <OverviewScreen range={range} onRangeChange={setRange} />;
}

function renderScreen(initial: OverviewRange = '24h') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

const figure = (name: string) => screen.getByRole('region', { name });

describe('Overview screen', () => {
  it('shows skeletons while loading', () => {
    renderScreen();
    expect(screen.getByRole('status', { name: 'Loading overview' })).toBeInTheDocument();
  });

  it('shows the figures for the 24 hour range', async () => {
    renderScreen('24h');
    expect(await within(await screen.findByRole('region', { name: 'Volume collected' })).findByText('100.000 ₫')).toBeInTheDocument();
    expect(within(figure('Payments')).getByText('3')).toBeInTheDocument();
    expect(within(figure('Success rate')).getByText('50%')).toBeInTheDocument();
    expect(within(figure('Open Reviews')).getByText('2')).toBeInTheDocument();
    expect(within(figure('Open Reviews')).getByRole('link', { name: /Exceptions/ })).toHaveAttribute('href', '/exceptions');
  });

  it('updates the figures when the range changes, and reports the selection', async () => {
    const user = userEvent.setup();
    renderScreen('24h');
    await screen.findByRole('region', { name: 'Volume collected' });
    expect(screen.getByRole('radio', { name: 'Last 24 hours' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    expect(await within(figure('Volume collected')).findByText('150.000 ₫')).toBeInTheDocument();
    expect(within(figure('Payments')).getByText('4')).toBeInTheDocument();
    expect(within(figure('Success rate')).getByText('67%')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Last 7 days' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));
    expect(await within(figure('Payments')).findByText('5')).toBeInTheDocument();
    expect(within(figure('Success rate')).getByText('50%')).toBeInTheDocument();
  });

  it('starts on the range it is given (a reload keeps the range)', async () => {
    renderScreen('30d');
    expect(await within(await screen.findByRole('region', { name: 'Payments' })).findByText('5')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toBeChecked();
  });

  it('shows no revenue or fee figures', async () => {
    renderScreen('30d');
    await screen.findByRole('region', { name: 'Volume collected' });
    expect(screen.queryByText(/revenue|fee/i)).not.toBeInTheDocument();
  });

  it('labels both charts and lists Payments by status with counts', async () => {
    renderScreen('24h');
    await screen.findByRole('region', { name: 'Volume collected' });
    expect(screen.getByRole('img', { name: /Volume over time/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Payments by status/ })).toBeInTheDocument();

    const statuses = screen.getByRole('list', { name: 'Payments by status' });
    expect(within(statuses).getByRole('listitem', { name: /Succeeded/ })).toHaveTextContent('1');
    expect(within(statuses).getByRole('listitem', { name: /Expired/ })).toHaveTextContent('0');
  });

  it('breaks down Payments per PaymentGateway', async () => {
    renderScreen('30d');
    await screen.findByRole('region', { name: 'Volume collected' });
    const table = screen.getByRole('table', { name: 'Payments by PaymentGateway' });
    const stripe = within(table).getByRole('row', { name: /stripe/ });
    expect(within(stripe).getAllByRole('cell').map((c) => c.textContent?.replace(/\s/g, ' '))).toEqual(['stripe', '2', '100.000 ₫', '50%']);
    const fake = within(table).getByRole('row', { name: /fake/ });
    expect(within(fake).getAllByRole('cell').map((c) => c.textContent?.replace(/\s/g, ' '))).toEqual(['fake', '2', '50.000 ₫', '50%']);
  });

  it('lists the most recent Payments, each linking to its detail page', async () => {
    renderScreen('24h');
    await screen.findByRole('region', { name: 'Volume collected' });
    const recent = screen.getByRole('list', { name: 'Recent Payments' });
    const links = within(recent).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/payments/d', '/payments/a', '/payments/c']);
    expect(links[1]).toHaveTextContent('order-a');
    expect(links[1]).toHaveTextContent('100.000 ₫');
    expect(links[1]).toHaveTextContent('Succeeded');
  });

  it('shows an empty state when the range has no Payments', async () => {
    server.use(
      http.get('*/api/bff/internal/overview', () => HttpResponse.json(computeOverview(new MockStore(NOW), '24h'))),
    );
    renderScreen('24h');
    expect(await screen.findByRole('heading', { name: 'No Payments in this range' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Volume collected' })).not.toBeInTheDocument();
  });

  it('shows the API error with a retry that recovers', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        '*/api/bff/internal/overview',
        () => HttpResponse.json({ statusCode: 500, message: 'metrics are down', code: 'INTERNAL_ERROR' }, { status: 500 }),
        { once: true },
      ),
    );
    renderScreen('24h');
    expect(await screen.findByText('metrics are down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await within(await screen.findByRole('region', { name: 'Volume collected' })).findByText('100.000 ₫')).toBeInTheDocument();
  });
});
