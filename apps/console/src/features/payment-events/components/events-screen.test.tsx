import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentEvent } from '@/features/payments/schemas';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { currentLocation, resetNavigation } from '@/test/fake-navigation';
import { EventDetailScreen } from './event-detail-screen';
import { EventsScreen } from './events-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const NOW = new Date('2026-11-25T03:00:00.000Z');
const HOUR = 3_600_000;

// Event n is n hours old. Odd ones are PaymentCreated, even ones PaymentSucceeded; every third is unpublished.
function build(): MockStore {
  const store = new MockStore(NOW);
  for (let n = 1; n <= 25; n += 1) {
    const createdAt = new Date(NOW.getTime() - n * HOUR).toISOString();
    store.events.push({
      id: `evt-${String(n).padStart(2, '0')}`,
      type: n % 2 === 1 ? 'PaymentCreated' : 'PaymentSucceeded',
      paymentId: `pay-${n}`,
      payload: { paymentId: `pay-${n}`, amount: '50000', status: 'PENDING' },
      createdAt,
      publishedAt: n % 3 === 0 ? null : new Date(NOW.getTime() - n * HOUR + 2000).toISOString(),
    } satisfies PaymentEvent);
  }
  return store;
}

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store: build() }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetNavigation('/events'));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const table = () => screen.getByRole('table', { name: 'Payment Events' });
/** The event ids of the rows, in order (each row's type cell links to its detail). */
const rowIds = () =>
  within(table())
    .getAllByRole('link', { name: /^Payment (created|succeeded)$/ })
    .map((a) => a.getAttribute('href')!.replace('/events/', ''));
const optionNames = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('Events screen', () => {
  it('shows a loading state, then type, Payment, created and published time, newest first', async () => {
    wrap(<EventsScreen />);
    expect(table()).toHaveAttribute('aria-busy', 'true');

    await screen.findAllByRole('link', { name: 'Payment created' });
    expect(table()).toHaveAttribute('aria-busy', 'false');
    expect(rowIds().slice(0, 3)).toEqual(['evt-01', 'evt-02', 'evt-03']);
    expect(rowIds()).toHaveLength(20);

    const first = within(table()).getAllByRole('row')[1]!;
    expect(within(first).getByRole('link', { name: 'pay-1' })).toHaveAttribute('href', '/payments/pay-1');
    expect(within(first).queryByText('Unpublished')).not.toBeInTheDocument();
    expect(first.querySelectorAll('time')).toHaveLength(2);
    // evt-03 was never relayed.
    const third = within(table()).getAllByRole('row')[3]!;
    expect(within(third).getByText('Unpublished')).toBeInTheDocument();
  });

  it('filters by type and keeps it in the URL', async () => {
    const user = userEvent.setup();
    wrap(<EventsScreen />);
    await screen.findAllByRole('link', { name: 'Payment created' });

    expect(optionNames(screen.getByRole('combobox', { name: 'Type' }))).toEqual([
      'All types',
      'Payment created',
      'Payment succeeded',
      'Payment cancelled',
      'Payment expired',
      'Payment requires review',
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'PaymentSucceeded');

    await waitFor(() => expect(rowIds()).toHaveLength(12));
    expect(rowIds()[0]).toBe('evt-02');
    expect(currentLocation()).toBe('/events?type=PaymentSucceeded');
  });

  it('filters unpublished events to spot a stuck relay', async () => {
    const user = userEvent.setup();
    wrap(<EventsScreen />);
    await screen.findAllByRole('link', { name: 'Payment created' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Published' }), 'false');
    await waitFor(() => expect(rowIds().slice(0, 3)).toEqual(['evt-03', 'evt-06', 'evt-09']));
    expect(within(table()).getAllByText('Unpublished')).toHaveLength(rowIds().length);
    expect(currentLocation()).toBe('/events?published=false');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Published' }), 'true');
    await waitFor(() => expect(rowIds().slice(0, 3)).toEqual(['evt-01', 'evt-02', 'evt-04']));
    expect(screen.queryByText('Unpublished')).not.toBeInTheDocument();
  });

  it('combines type and published, and starts from the URL', async () => {
    resetNavigation('/events?type=PaymentCreated&published=false');
    wrap(<EventsScreen />);
    await screen.findAllByRole('link', { name: 'Payment created' });
    // Odd and divisible by three: 3, 9, 15, 21.
    expect(rowIds()).toEqual(['evt-03', 'evt-09', 'evt-15', 'evt-21']);
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('PaymentCreated');
    expect(screen.getByRole('combobox', { name: 'Published' })).toHaveValue('false');
  });

  it('loads the next page and appends it', async () => {
    const user = userEvent.setup();
    wrap(<EventsScreen />);
    await screen.findAllByRole('link', { name: 'Payment created' });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rowIds()).toHaveLength(25));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers to clear the filters when nothing matches', async () => {
    const user = userEvent.setup();
    resetNavigation('/events?type=PaymentExpired');
    wrap(<EventsScreen />);

    expect(await screen.findByText('No Payment Events match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findAllByRole('link', { name: 'Payment created' });
    expect(currentLocation()).toBe('/events');
  });

  it('shows an empty state when the outbox is empty', async () => {
    server.use(http.get('*/api/bff/internal/payment-events', () => HttpResponse.json({ items: [], nextCursor: null })));
    wrap(<EventsScreen />);
    expect(await screen.findByText('No Payment Events yet')).toBeInTheDocument();
  });

  it('shows the API error and retries', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        '*/api/bff/internal/payment-events',
        () => HttpResponse.json({ statusCode: 500, message: 'The database is down', code: 'INTERNAL' }, { status: 500 }),
        { once: true },
      ),
    );
    wrap(<EventsScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is down');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findAllByRole('link', { name: 'Payment created' });
  });
});

describe('Event detail screen', () => {
  it('shows the event, a link to its Payment and the pretty-printed payload', async () => {
    wrap(<EventDetailScreen id="evt-03" />);
    expect(screen.getByRole('status', { name: 'Loading Payment Event' })).toBeInTheDocument();

    expect(await screen.findByText('Payment created')).toBeInTheDocument();
    expect(screen.getByText('Unpublished')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'pay-3' })).toHaveAttribute('href', '/payments/pay-3');
    const payload = screen.getByRole('region', { name: 'Payload' });
    expect(within(payload).getByText(/"amount": "50000"/)).toBeInTheDocument();
    expect(payload.querySelector('pre')?.textContent).toBe(
      JSON.stringify({ paymentId: 'pay-3', amount: '50000', status: 'PENDING' }, null, 2),
    );
  });

  it('copies the payload', async () => {
    const user = userEvent.setup();
    wrap(<EventDetailScreen id="evt-01" />);
    await screen.findByRole('region', { name: 'Payload' });
    await user.click(screen.getByRole('button', { name: 'Copy payload' }));
    expect(await navigator.clipboard.readText()).toBe(
      JSON.stringify({ paymentId: 'pay-1', amount: '50000', status: 'PENDING' }, null, 2),
    );
  });

  it('says so when the event does not exist', async () => {
    wrap(<EventDetailScreen id="evt-99" />);
    expect(await screen.findByText('Payment Event not found')).toBeInTheDocument();
  });

  it('shows an error with retry for any other failure', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        '*/api/bff/internal/payment-events/evt-01',
        () => HttpResponse.json({ statusCode: 500, message: 'Boom', code: 'INTERNAL' }, { status: 500 }),
        { once: true },
      ),
    );
    wrap(<EventDetailScreen id="evt-01" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Payload' })).toBeInTheDocument();
  });
});
