import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { currentLocation, resetNavigation } from '@/test/fake-navigation';
import { AuditScreen } from './audit-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const NOW = new Date('2026-11-25T03:00:00.000Z');
const MINUTE = 60_000;

// Transition n is n minutes old. Kinds cycle Payment (pay-n), PaymentTransaction (att-n of pay-n) and Refund (ref-n).
// Even ones are an operator resolution, odd ones a webhook.
function build(): MockStore {
  const store = new MockStore(NOW);
  for (let n = 1; n <= 25; n += 1) {
    const kind = (['PAYMENT', 'PAYMENT_TRANSACTION', 'REFUND'] as const)[n % 3];
    const operator = n % 2 === 0;
    const id = String(n).padStart(2, '0');
    const entityId = kind === 'PAYMENT' ? `pay-${id}` : kind === 'PAYMENT_TRANSACTION' ? `att-${id}` : `ref-${id}`;
    if (kind === 'PAYMENT_TRANSACTION') {
      store.attempts.push({
        id: entityId,
        paymentId: `pay-${id}`,
        gatewayId: 'stripe',
        status: 'SUCCEEDED',
        providerRef: null,
        refundRequired: false,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      });
    }
    store.transitions.push({
      id: `t${id}`,
      entityType: kind,
      entityId,
      fromStatus: n === 1 ? null : 'PENDING',
      toStatus: 'SUCCEEDED',
      trigger: operator ? 'operator_resolution' : 'webhook',
      actor: operator ? 'operator' : 'system',
      reason: operator ? `note ${id}` : null,
      createdAt: new Date(NOW.getTime() - n * MINUTE).toISOString(),
    });
  }
  return store;
}

const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store: build() }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetNavigation('/audit-log'));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditScreen />
    </QueryClientProvider>,
  );
}

const table = () => screen.getByRole('table', { name: 'Audit log' });
/** The entity ids of the rows, in order. */
const entityIds = () => within(table()).getAllByText(/^(pay|att|ref)-\d+$/, { selector: 'td span' }).map((e) => e.textContent);
const rowOf = (entityId: string) => within(table()).getByText(entityId, { selector: 'td span' }).closest('tr')!;
const optionNames = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('Audit log screen', () => {
  it('shows a loading state, then every transition with its cause, newest first', async () => {
    renderScreen();
    expect(table()).toHaveAttribute('aria-busy', 'true');

    await waitFor(() => expect(entityIds()).toHaveLength(20));
    expect(table()).toHaveAttribute('aria-busy', 'false');
    expect(entityIds().slice(0, 3)).toEqual(['att-01', 'ref-02', 'pay-03']);

    const operator = rowOf('ref-02');
    expect(within(operator).getByText('Refund')).toBeInTheDocument();
    expect(within(operator).getByText('operator_resolution')).toBeInTheDocument();
    expect(within(operator).getByText('operator')).toBeInTheDocument();
    expect(within(operator).getByText('note 02')).toBeInTheDocument();
    expect(within(rowOf('att-01')).getByText('PaymentTransaction')).toBeInTheDocument();

    // A created entity has no from status; an ordinary row shows from and to.
    const created = rowOf('att-01');
    expect(within(created).getByText('None')).toBeInTheDocument();
    expect(within(created).getByText('Succeeded')).toBeInTheDocument();
    const moved = rowOf('pay-03');
    expect(within(moved).getByText('Pending')).toBeInTheDocument();
    expect(within(moved).getByText('Succeeded')).toBeInTheDocument();
  });

  it('links each row to its Payment, resolving a PaymentTransaction through its attempt', async () => {
    renderScreen();
    await waitFor(() => expect(entityIds()).toHaveLength(20));

    // The PaymentTransaction row att-01 belongs to pay-01.
    expect(within(rowOf('att-01')).getByRole('link', { name: 'pay-01' })).toHaveAttribute('href', '/payments/pay-01');
    expect(within(rowOf('pay-03')).getByRole('link', { name: 'pay-03' })).toHaveAttribute('href', '/payments/pay-03');
    // A Refund has no Payment to open.
    expect(within(rowOf('ref-02')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('filters by entity type and keeps it in the URL', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(entityIds()).toHaveLength(20));

    expect(optionNames(screen.getByRole('combobox', { name: 'Entity type' }))).toEqual([
      'All entity types',
      'Payment',
      'PaymentTransaction',
      'Refund',
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Entity type' }), 'PAYMENT_TRANSACTION');

    await waitFor(() => expect(entityIds().slice(0, 3)).toEqual(['att-01', 'att-04', 'att-07']));
    expect(entityIds().every((id) => id?.startsWith('att-'))).toBe(true);
    expect(currentLocation()).toBe('/audit-log?entityType=PAYMENT_TRANSACTION');
  });

  it('filters by trigger, to see all operator resolutions', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(entityIds()).toHaveLength(20));

    const triggers = optionNames(screen.getByRole('combobox', { name: 'Trigger' }));
    expect(triggers).toEqual(expect.arrayContaining(['All triggers', 'operator_resolution', 'operator_note', 'gateway_switch', 'webhook']));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Trigger' }), 'operator_resolution');

    await waitFor(() => expect(entityIds().slice(0, 3)).toEqual(['ref-02', 'att-04', 'pay-06']));
    expect(within(table()).queryByText('webhook')).not.toBeInTheDocument();
    expect(currentLocation()).toBe('/audit-log?trigger=operator_resolution');
  });

  it('filters by actor and combines filters', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(entityIds()).toHaveLength(20));

    expect(optionNames(screen.getByRole('combobox', { name: 'Actor' }))).toEqual(['All actors', 'system', 'merchant', 'operator']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Actor' }), 'system');
    await waitFor(() => expect(entityIds().slice(0, 3)).toEqual(['att-01', 'pay-03', 'ref-05']));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Entity type' }), 'PAYMENT');
    await waitFor(() => expect(entityIds().slice(0, 2)).toEqual(['pay-03', 'pay-09']));
    expect(currentLocation()).toBe('/audit-log?entityType=PAYMENT&actor=system');
  });

  it('starts from the filters in the URL', async () => {
    resetNavigation('/audit-log?trigger=webhook&actor=system');
    renderScreen();
    await waitFor(() => expect(entityIds().slice(0, 2)).toEqual(['att-01', 'pay-03']));
    expect(screen.getByRole('combobox', { name: 'Trigger' })).toHaveValue('webhook');
    expect(screen.getByRole('combobox', { name: 'Actor' })).toHaveValue('system');
  });

  it('loads the next page and appends it', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(entityIds()).toHaveLength(20));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(entityIds()).toHaveLength(25));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers to clear the filters when nothing matches', async () => {
    const user = userEvent.setup();
    resetNavigation('/audit-log?trigger=gateway_switch');
    renderScreen();

    expect(await screen.findByText('No status transitions match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(entityIds()).toHaveLength(20));
    expect(currentLocation()).toBe('/audit-log');
  });

  it('shows an empty state when nothing was recorded', async () => {
    server.use(http.get('*/api/bff/internal/status-transitions', () => HttpResponse.json({ items: [], nextCursor: null })));
    renderScreen();
    expect(await screen.findByText('No status transitions yet')).toBeInTheDocument();
  });

  it('shows the API error and retries', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        '*/api/bff/internal/status-transitions',
        () => HttpResponse.json({ statusCode: 500, message: 'The database is down', code: 'INTERNAL' }, { status: 500 }),
        { once: true },
      ),
    );
    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is down');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(entityIds()).toHaveLength(20));
  });
});
