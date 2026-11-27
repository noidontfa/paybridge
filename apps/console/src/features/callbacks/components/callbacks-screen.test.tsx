import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '@/mocks/handlers';
import { MockStore, type MockCallback } from '@/mocks/store';
import { currentLocation, resetNavigation } from '@/test/fake-navigation';
import { CallbackDetailScreen } from './callback-detail-screen';
import { CallbacksScreen } from './callbacks-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const NOW = new Date('2026-11-25T03:00:00.000Z');
const MINUTE = 60_000;

function callback(n: number, overrides: Partial<MockCallback> = {}): MockCallback {
  const receivedAt = new Date(NOW.getTime() - n * MINUTE).toISOString();
  return {
    id: `cb-${n}`,
    gatewayId: 'stripe',
    providerEventId: `evt_${n}`,
    attemptKey: null,
    status: 'PROCESSED',
    attempts: 1,
    receivedAt,
    processedAt: new Date(NOW.getTime() - n * MINUTE + 2000).toISOString(),
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
    query: {},
    rawBody: '{"id":"evt","data":{"ok":true}}',
    lastError: null,
    ...overrides,
  };
}

function build(): MockStore {
  const store = new MockStore(NOW);
  store.payments.push({
    id: 'pay-1',
    upstreamReference: 'order-1',
    amount: '1000',
    currency: 'VND',
    status: 'PENDING',
    expiresAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  store.attempts.push({
    id: 'att-1',
    paymentId: 'pay-1',
    gatewayId: 'stripe',
    status: 'PENDING',
    providerRef: null,
    refundRequired: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  store.callbacks.push(
    callback(1, { attemptKey: 'att-1', query: { gateway: 'stripe' } }),
    callback(2, { gatewayId: 'fake', status: 'FAILED', attempts: 4, lastError: 'Signature verification failed', processedAt: null, rawBody: 'ref=FAKE-1&result=PAID', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    callback(3, { status: 'RECEIVED', processedAt: null, attempts: 0, providerEventId: null }),
    callback(4, { attemptKey: 'ffffffff-0000-4000-8000-000000000000', gatewayId: 'fake', status: 'PROCESSING' }),
    callback(5, { rawBody: '<script>alert(1)</script><b>bold</b>' }),
  );
  return store;
}

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store: build() }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetNavigation('/callbacks'));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const table = () => screen.getByRole('table', { name: 'Callbacks' });
const rowLinks = () => within(table()).getAllByRole('link').map((a) => a.getAttribute('href'));

describe('Callbacks list screen', () => {
  it('shows a loading state, then each Callback with its gateway, ids, status, attempts and times', async () => {
    renderWithClient(<CallbacksScreen />);
    expect(table()).toHaveAttribute('aria-busy', 'true');

    await screen.findByRole('link', { name: 'evt_1' });
    expect(table()).toHaveAttribute('aria-busy', 'false');
    for (const name of ['Gateway', 'Provider event id', 'Attempt Key', 'Status', 'Attempts', 'Received', 'Processed']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(rowLinks()).toEqual(['/callbacks/cb-1', '/callbacks/cb-2', '/callbacks/cb-3', '/callbacks/cb-4', '/callbacks/cb-5']);

    const failed = screen.getByRole('link', { name: 'evt_2' }).closest('tr')!;
    expect(within(failed).getByText('fake')).toBeInTheDocument();
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(within(failed).getByText('4')).toBeInTheDocument();
    expect(within(failed).getByText('Not processed')).toBeInTheDocument();

    const known = screen.getByRole('link', { name: 'evt_1' }).closest('tr')!;
    expect(within(known).getByText('att-1')).toBeInTheDocument();
    const noEventId = screen.getByRole('link', { name: 'No event id' }).closest('tr')!;
    expect(within(noEventId).getByText('Received')).toBeInTheDocument();
  });

  it('filters by gateway and by status, keeping both in the URL', async () => {
    const user = userEvent.setup();
    renderWithClient(<CallbacksScreen />);
    await screen.findByRole('link', { name: 'evt_1' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Gateway' }), 'fake');
    await waitFor(() => expect(rowLinks()).toEqual(['/callbacks/cb-2', '/callbacks/cb-4']));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'FAILED');
    await waitFor(() => expect(rowLinks()).toEqual(['/callbacks/cb-2']));
    expect(currentLocation()).toBe('/callbacks?gatewayId=fake&status=FAILED');
    expect(within(screen.getByRole('combobox', { name: 'Status' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All statuses',
      'Received',
      'Processing',
      'Processed',
      'Failed',
    ]);
  });

  it('starts from the filters in the URL', async () => {
    resetNavigation('/callbacks?status=RECEIVED');
    renderWithClient(<CallbacksScreen />);
    await screen.findByRole('link', { name: 'No event id' });
    expect(rowLinks()).toEqual(['/callbacks/cb-3']);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('RECEIVED');
  });

  it('offers to clear the filters when nothing matches', async () => {
    const user = userEvent.setup();
    resetNavigation('/callbacks?gatewayId=fake&status=RECEIVED');
    renderWithClient(<CallbacksScreen />);
    await screen.findByText('No Callbacks match these filters');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByRole('link', { name: 'evt_1' });
    expect(currentLocation()).toBe('/callbacks');
  });

  it('shows an empty state when no gateway has sent anything, and an error with retry', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/bff/internal/callbacks', () => HttpResponse.json({ items: [], nextCursor: null })));
    const first = renderWithClient(<CallbacksScreen />);
    await screen.findByText('No Callbacks yet');
    first.unmount();

    let fail = true;
    server.use(
      http.get('*/api/bff/internal/callbacks', () =>
        fail
          ? HttpResponse.json({ statusCode: 500, error: 'Internal Server Error', message: 'database down', code: 'INTERNAL' }, { status: 500 })
          : HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithClient(<CallbacksScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('database down');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No Callbacks yet');
  });
});

describe('Callback detail screen', () => {
  it('pretty-prints a JSON body as text, with allow-listed headers and query', async () => {
    renderWithClient(<CallbackDetailScreen id="cb-1" />);
    const body = await screen.findByRole('region', { name: 'Raw body' });
    expect(body).toHaveTextContent('"ok": true');
    expect(within(body).getByText(/"data": \{/).textContent).toBe('{\n  "id": "evt",\n  "data": {\n    "ok": true\n  }\n}');
    expect(screen.getByRole('region', { name: 'Headers' })).toHaveTextContent('stripe-signature');
    expect(screen.getByRole('region', { name: 'Headers' })).toHaveTextContent('t=1,v1=abc');
    expect(screen.getByRole('region', { name: 'Query' })).toHaveTextContent('gateway');
    expect(screen.getByRole('button', { name: 'Copy raw body' })).toBeInTheDocument();
  });

  it('shows a non-JSON body exactly as received', async () => {
    renderWithClient(<CallbackDetailScreen id="cb-2" />);
    const body = await screen.findByRole('region', { name: 'Raw body' });
    expect(body.querySelector('pre')?.textContent).toBe('ref=FAKE-1&result=PAID');
  });

  it('never renders a body as HTML', async () => {
    renderWithClient(<CallbackDetailScreen id="cb-5" />);
    const body = await screen.findByRole('region', { name: 'Raw body' });
    expect(body.querySelector('pre')?.textContent).toBe('<script>alert(1)</script><b>bold</b>');
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
  });

  it('shows the last error of a failed Callback', async () => {
    renderWithClient(<CallbackDetailScreen id="cb-2" />);
    const error = await screen.findByRole('region', { name: 'Last error' });
    expect(error).toHaveTextContent('Signature verification failed');
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('links to the Payment only when the Attempt Key matches a PaymentTransaction', async () => {
    const known = renderWithClient(<CallbackDetailScreen id="cb-1" />);
    expect(await screen.findByRole('link', { name: 'View Payment' })).toHaveAttribute('href', '/payments/pay-1');
    known.unmount();

    renderWithClient(<CallbackDetailScreen id="cb-4" />);
    await screen.findByRole('region', { name: 'Raw body' });
    expect(screen.queryByRole('link', { name: 'View Payment' })).not.toBeInTheDocument();
    expect(screen.getByText(/matches no PaymentTransaction/)).toBeInTheDocument();
  });

  it('says so when a Callback names no Attempt Key', async () => {
    renderWithClient(<CallbackDetailScreen id="cb-3" />);
    await screen.findByRole('region', { name: 'Raw body' });
    expect(screen.queryByRole('link', { name: 'View Payment' })).not.toBeInTheDocument();
    expect(screen.getByText(/names no Attempt Key/)).toBeInTheDocument();
  });

  it('shows a loading state, a not-found state and an error with retry', async () => {
    const user = userEvent.setup();
    const missing = renderWithClient(<CallbackDetailScreen id="nope" />);
    expect(screen.getByRole('status', { name: 'Loading Callback' })).toBeInTheDocument();
    await screen.findByText('Callback not found');
    missing.unmount();

    let fail = true;
    server.use(
      http.get('*/api/bff/internal/callbacks/cb-1', () =>
        fail
          ? HttpResponse.json({ statusCode: 500, error: 'Internal Server Error', message: 'boom', code: 'INTERNAL' }, { status: 500 })
          : HttpResponse.json({ ...callback(1), paymentId: null }),
      ),
    );
    renderWithClient(<CallbackDetailScreen id="cb-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('region', { name: 'Raw body' });
  });
});
