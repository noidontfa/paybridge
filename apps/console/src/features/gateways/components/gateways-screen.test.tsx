import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '@/mocks/handlers';
import { MockStore, type MockCallback } from '@/mocks/store';
import { GatewayDetailScreen } from './gateway-detail-screen';
import { GatewaysScreen } from './gateways-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const NOW = new Date('2026-11-25T03:00:00.000Z');
const HOUR = 3_600_000;

function callback(n: number, hoursAgo: number, overrides: Partial<MockCallback> = {}): MockCallback {
  return {
    id: `cb-${n}`,
    gatewayId: 'stripe',
    providerEventId: `evt_${n}`,
    attemptKey: null,
    status: 'PROCESSED',
    attempts: 1,
    receivedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    processedAt: null,
    headers: {},
    query: {},
    rawBody: '{}',
    lastError: null,
    ...overrides,
  };
}

const store = new MockStore(NOW);
store.gateways.splice(
  0,
  store.gateways.length,
  { id: 'stripe', registered: true, configured: true, mode: 'live', callbackUrl: 'https://pay.test/webhooks/stripe' },
  { id: 'fake', registered: true, configured: false, mode: 'test', callbackUrl: 'https://pay.test/webhooks/fake' },
);
store.callbacks.push(
  callback(1, 2),
  callback(2, 3, { status: 'FAILED', lastError: 'Signature verification failed' }),
  callback(3, 4, { status: 'FAILED', lastError: 'Signature verification failed' }),
  callback(4, 5, { status: 'RECEIVED' }),
);

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const serverError = () =>
  HttpResponse.json({ statusCode: 500, error: 'Internal Server Error', message: 'boom', code: 'INTERNAL' }, { status: 500 });

describe('Gateways list screen', () => {
  it('shows each gateway with registration, configuration, mode and a Callback URL with copy', async () => {
    renderWithClient(<GatewaysScreen />);
    expect(screen.getByRole('status', { name: 'Loading gateways' })).toBeInTheDocument();

    const stripe = await screen.findByRole('article', { name: 'stripe' });
    expect(within(stripe).getByText('Registered')).toBeInTheDocument();
    expect(within(stripe).getByText('Configured')).toBeInTheDocument();
    expect(within(stripe).getByText('Live')).toBeInTheDocument();
    expect(within(stripe).getByText('https://pay.test/webhooks/stripe')).toBeInTheDocument();
    expect(within(stripe).getByRole('button', { name: 'Copy Callback URL' })).toBeInTheDocument();
    expect(within(stripe).getByRole('link', { name: 'stripe' })).toHaveAttribute('href', '/gateways/stripe');

    const fake = screen.getByRole('article', { name: 'fake' });
    expect(within(fake).getByText('Not configured')).toBeInTheDocument();
    expect(within(fake).getByText('Test')).toBeInTheDocument();
  });

  it('makes live mode look different from test mode', async () => {
    renderWithClient(<GatewaysScreen />);
    const stripe = await screen.findByRole('article', { name: 'stripe' });
    const live = within(stripe).getByText('Live').closest('[data-mode]')!;
    const test = within(screen.getByRole('article', { name: 'fake' })).getByText('Test').closest('[data-mode]')!;
    expect(live).toHaveAttribute('data-mode', 'live');
    expect(test).toHaveAttribute('data-mode', 'test');
    expect(live.className).not.toBe(test.className);
  });

  it('offers no way to enter credentials or enable and disable a gateway', async () => {
    renderWithClient(<GatewaysScreen />);
    await screen.findByRole('article', { name: 'stripe' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /enable|disable|save|credential|key|secret/i })).toBeNull();
  });

  it('shows an empty state when the API reports no gateways', async () => {
    server.use(http.get('*/api/bff/internal/gateways', () => HttpResponse.json({ items: [] })));
    renderWithClient(<GatewaysScreen />);
    expect(await screen.findByText('No PaymentGateways are registered')).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/bff/internal/gateways', serverError, { once: true }));
    renderWithClient(<GatewaysScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('article', { name: 'stripe' })).toBeInTheDocument();
  });
});

describe('Gateway detail screen', () => {
  it('shows the Callback counts by status for the last 24 hours, the last Callback time and errors by category', async () => {
    renderWithClient(<GatewayDetailScreen id="stripe" />);
    expect(screen.getByRole('status', { name: 'Loading gateway' })).toBeInTheDocument();

    const counts = await screen.findByRole('region', { name: 'Callbacks in the last 24 hours' });
    expect(within(within(counts).getByText('Received').closest('div')!).getByText('1')).toBeInTheDocument();
    expect(within(within(counts).getByText('Processing').closest('div')!).getByText('0')).toBeInTheDocument();
    expect(within(within(counts).getByText('Processed').closest('div')!).getByText('1')).toBeInTheDocument();
    expect(within(within(counts).getByText('Failed').closest('div')!).getByText('2')).toBeInTheDocument();

    const last = screen.getByRole('region', { name: 'Last Callback' });
    expect(last.querySelector('time')).toHaveAttribute('dateTime', new Date(NOW.getTime() - 2 * HOUR).toISOString());

    const errors = screen.getByRole('region', { name: 'Recent gateway errors' });
    const row = within(errors).getByText('Signature invalid').closest('li')!;
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('links to this gateway\'s Payments and Callbacks, already filtered', async () => {
    renderWithClient(<GatewayDetailScreen id="stripe" />);
    await screen.findByRole('region', { name: 'Callbacks in the last 24 hours' });
    expect(screen.getByRole('link', { name: 'View Payments' })).toHaveAttribute('href', '/payments?gatewayId=stripe');
    expect(screen.getByRole('link', { name: 'View Callbacks' })).toHaveAttribute('href', '/callbacks?gatewayId=stripe');
    expect(screen.getByRole('link', { name: 'View failed Callbacks' })).toHaveAttribute('href', '/callbacks?gatewayId=stripe&status=FAILED');
  });

  it('shows the same summary as the list, and says so when nothing was received', async () => {
    renderWithClient(<GatewayDetailScreen id="fake" />);
    const summary = await screen.findByRole('region', { name: 'Gateway summary' });
    expect(within(summary).getByText('Not configured')).toBeInTheDocument();
    expect(within(summary).getByText('https://pay.test/webhooks/fake')).toBeInTheDocument();
    expect(screen.getByText('No Callback received yet')).toBeInTheDocument();
    expect(screen.getByText('No gateway errors in the last 24 hours')).toBeInTheDocument();
  });

  it('shows a not-found state for an unknown gateway id', async () => {
    renderWithClient(<GatewayDetailScreen id="vnpay" />);
    expect(await screen.findByText('Gateway not found')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View Payments' })).toBeNull();
  });

  it('shows an error with retry', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/bff/internal/gateways/stripe', serverError, { once: true }));
    renderWithClient(<GatewayDetailScreen id="stripe" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Gateway summary' })).toBeInTheDocument();
  });
});
