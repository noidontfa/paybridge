import { OperatorProvider } from '@/lib/operator';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewReason, StatusTransition } from '@/lib/api/schemas';
import { createHandlers } from '@/mocks/handlers';
import { MockStore, type MockAttempt, type MockPayment } from '@/mocks/store';
import { currentLocation, resetNavigation } from '@/test/fake-navigation';
import { ExceptionsScreen } from './exceptions-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const NOW = new Date();
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

interface Spec {
  n: string;
  reason: ReviewReason;
  gatewayId: 'stripe' | 'fake';
  openedHoursAgo: number;
  amount?: string;
  reported?: string;
  closed?: boolean;
}

// Oldest first: ambiguous (100h), mismatch (90h), late (50h), duplicate (10h), plus one closed.
const SPECS: Spec[] = [
  { n: 'ambiguous', reason: 'AMBIGUOUS_PROVIDER_STATUS', gatewayId: 'stripe', openedHoursAgo: 100 },
  { n: 'mismatch', reason: 'AMOUNT_MISMATCH', gatewayId: 'fake', openedHoursAgo: 90, amount: '250000', reported: '240000' },
  { n: 'late', reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT', gatewayId: 'stripe', openedHoursAgo: 50 },
  { n: 'duplicate', reason: 'DUPLICATE_SUCCESS', gatewayId: 'stripe', openedHoursAgo: 10 },
  { n: 'resolved', reason: 'AMBIGUOUS_PROVIDER_STATUS', gatewayId: 'fake', openedHoursAgo: 200, closed: true },
];

function build(): MockStore {
  const store = new MockStore(NOW);
  for (const spec of SPECS) {
    const payment: MockPayment = {
      id: `pay-${spec.n}`,
      upstreamReference: `order-${spec.n}`,
      amount: spec.amount ?? '100000',
      currency: 'VND',
      status: spec.reason === 'LATE_SUCCESS_ON_CLOSED_PAYMENT' ? 'EXPIRED' : 'PENDING',
      expiresAt: ago(-1),
      createdAt: ago(spec.openedHoursAgo + 1),
      updatedAt: ago(spec.openedHoursAgo),
    };
    const attempt: MockAttempt = {
      id: `att-${spec.n}`,
      paymentId: payment.id,
      gatewayId: spec.gatewayId,
      status: spec.closed ? 'FAILED' : 'REQUIRES_REVIEW',
      providerRef: `ref-${spec.n}`,
      reviewReason: spec.reason,
      reviewOpenedAt: ago(spec.openedHoursAgo),
      refundRequired: spec.reason !== 'AMBIGUOUS_PROVIDER_STATUS',
      providerReportedAmount: spec.reported,
      createdAt: ago(spec.openedHoursAgo + 0.5),
      updatedAt: ago(spec.openedHoursAgo),
    };
    const step = (id: string, from: string | null, to: string, trigger: string): StatusTransition => ({
      id: `${attempt.id}-${id}`,
      entityType: 'PAYMENT_TRANSACTION',
      entityId: attempt.id,
      fromStatus: from,
      toStatus: to,
      trigger,
      actor: 'system',
      reason: to === 'REQUIRES_REVIEW' ? spec.reason : null,
      createdAt: ago(spec.openedHoursAgo),
    });
    store.payments.push(payment);
    store.attempts.push(attempt);
    store.transitions.push(step('1', null, 'CREATED', 'start_attempt'), step('2', 'CREATED', 'REQUIRES_REVIEW', 'status_query'));
  }
  return store;
}

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store: build() }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetNavigation('/exceptions'));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={{ id: 'operator', name: 'Operator' }}>
        <ExceptionsScreen />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

const table = () => screen.getByRole('table', { name: 'Exceptions' });
/** Upstream References of the Payments in the rows, in order. */
const rows = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByText(/^order-/).textContent);

describe('Exceptions list screen', () => {
  it('lists open Reviews, oldest first, with the facts an Operator prioritises by', async () => {
    renderScreen();
    expect(screen.getByRole('table', { name: 'Exceptions' })).toHaveAttribute('aria-busy', 'true');
    await screen.findByText('order-ambiguous');

    expect(rows()).toEqual(['order-ambiguous', 'order-mismatch', 'order-late', 'order-duplicate']);
    const mismatch = screen.getByText('order-mismatch').closest('tr')!;
    expect(within(mismatch).getByText('Amount mismatch')).toBeInTheDocument();
    expect(within(mismatch).getByText('fake')).toBeInTheDocument();
    expect(within(mismatch).getByText(/250\.000/)).toBeInTheDocument();
    expect(within(mismatch).getByText(/240\.000/)).toBeInTheDocument();
    expect(within(mismatch).getByText('4 days')).toBeInTheDocument();
    expect(within(mismatch).getByText('Yes')).toBeInTheDocument();
    const ambiguous = screen.getByText('order-ambiguous').closest('tr')!;
    expect(within(ambiguous).getByText('No')).toBeInTheDocument();
    // Provider-reported amount is shown only when known.
    expect(within(ambiguous).queryByText(/240\.000/)).not.toBeInTheDocument();
  });

  it('filters by review reason and keeps it in the URL', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('order-ambiguous');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Review reason' }), 'DUPLICATE_SUCCESS');

    await waitFor(() => expect(rows()).toEqual(['order-duplicate']));
    expect(currentLocation()).toBe('/exceptions?reason=DUPLICATE_SUCCESS');
  });

  it('filters by PaymentGateway', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('order-ambiguous');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Gateway' }), 'fake');

    await waitFor(() => expect(rows()).toEqual(['order-mismatch']));
    expect(currentLocation()).toBe('/exceptions?gatewayId=fake');
  });

  it('switches to closed Reviews and back to open', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('order-ambiguous');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Closed' }));
    await waitFor(() => expect(rows()).toEqual(['order-resolved']));
    expect(currentLocation()).toBe('/exceptions?state=closed');
    expect(screen.getByRole('button', { name: 'Closed' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(currentLocation()).toBe('/exceptions');
  });

  it('starts from the filters in the URL', async () => {
    resetNavigation('/exceptions?state=closed&gatewayId=fake');
    renderScreen();
    await screen.findByText('order-resolved');
    expect(screen.getByRole('combobox', { name: 'Gateway' })).toHaveValue('fake');
  });

  it('offers to clear the filters when none match', async () => {
    const user = userEvent.setup();
    resetNavigation('/exceptions?reason=AMOUNT_MISMATCH&gatewayId=stripe');
    renderScreen();

    expect(await screen.findByText('No Reviews match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    await screen.findByText('order-ambiguous');
    expect(currentLocation()).toBe('/exceptions');
  });

  it('shows an empty state when there are no open Reviews', async () => {
    server.use(http.get('*/api/bff/internal/reviews', () => HttpResponse.json({ items: [], nextCursor: null })));
    renderScreen();
    expect(await screen.findByText('No open Reviews')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows the API error and retries', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        '*/api/bff/internal/reviews',
        () => HttpResponse.json({ statusCode: 500, message: 'The database is down', code: 'INTERNAL' }, { status: 500 }),
        { once: true },
      ),
    );
    renderScreen();

    expect(await screen.findByText('The database is down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('order-ambiguous')).toBeInTheDocument();
  });
});

describe('Review sheet', () => {
  async function openSheet(user: ReturnType<typeof userEvent.setup>, reference: string) {
    await screen.findByText(reference);
    await user.click(within(screen.getByText(reference).closest('tr')!).getByRole('button', { name: /Review/ }));
    return await screen.findByRole('dialog');
  }

  it.each([
    ['ambiguous', 'Ambiguous status', 'order-ambiguous'],
    ['mismatch', 'Amount mismatch', 'order-mismatch'],
    ['late', 'Late success', 'order-late'],
    ['duplicate', 'Duplicate success', 'order-duplicate'],
  ])('opens from the %s row with the Payment summary, the PaymentTransaction and its history', async (n, label, reference) => {
    const user = userEvent.setup();
    renderScreen();
    const sheet = await openSheet(user, reference);

    expect(await within(sheet).findByRole('heading', { name: `Review: ${label}` })).toBeInTheDocument();
    const summary = await within(sheet).findByRole('region', { name: 'Payment summary' });
    expect(within(summary).getByText(`pay-${n}`)).toBeInTheDocument();
    expect(within(summary).getByText(reference)).toBeInTheDocument();
    const transaction = within(sheet).getByRole('listitem', { name: 'PaymentTransaction 1' });
    expect(within(transaction).getByText(`ref-${n}`)).toBeInTheDocument();
    const review = within(sheet).getByRole('group', { name: 'Review' });
    expect(within(review).getByText(label)).toBeInTheDocument();
    const history = within(transaction).getByRole('table', { name: 'Status history' });
    expect(within(history).getByText('status_query')).toBeInTheDocument();
    expect(currentLocation()).toBe(`/exceptions?payment=pay-${n}&transaction=att-${n}`);
  });

  it('keeps the filters in the URL while the sheet is open, and closes with Escape', async () => {
    const user = userEvent.setup();
    resetNavigation('/exceptions?gatewayId=stripe');
    renderScreen();
    await openSheet(user, 'order-late');
    expect(currentLocation()).toBe('/exceptions?gatewayId=stripe&payment=pay-late&transaction=att-late');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(currentLocation()).toBe('/exceptions?gatewayId=stripe');
  });

  it('opens from the URL, on reload, even when the Review is not in the list page', async () => {
    resetNavigation('/exceptions?state=closed&payment=pay-late&transaction=att-late');
    renderScreen();
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('group', { name: 'Review' })).toBeInTheDocument();
    expect(within(sheet).getByText('ref-late')).toBeInTheDocument();
  });

  it('says so when the PaymentTransaction is not on the Payment', async () => {
    resetNavigation('/exceptions?payment=pay-late&transaction=att-nope');
    renderScreen();
    expect(await screen.findByText('Review not found')).toBeInTheDocument();
  });

  it('shows the resolution form of an open Review', async () => {
    const user = userEvent.setup();
    renderScreen();
    const sheet = await openSheet(user, 'order-ambiguous');
    await within(sheet).findByRole('group', { name: 'Review' });
    expect(within(sheet).getByRole('form', { name: 'Resolve Review' })).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: 'Resolve to FAILED' })).toBeEnabled();
  });

  it('tells when a Review under 72 hours old becomes resolvable', async () => {
    const user = userEvent.setup();
    renderScreen();
    const fresh = await openSheet(user, 'order-duplicate');
    // Opened 10 hours ago: resolvable in 62 hours.
    expect(await within(fresh).findByText(/Resolvable from/)).toBeInTheDocument();
  });

  it('shows no resolvable hint once a Review is older than 72 hours', async () => {
    const user = userEvent.setup();
    renderScreen();
    const old = await openSheet(user, 'order-ambiguous');
    await within(old).findByRole('group', { name: 'Review' });
    expect(within(old).queryByText(/Resolvable from/)).not.toBeInTheDocument();
  });
});
