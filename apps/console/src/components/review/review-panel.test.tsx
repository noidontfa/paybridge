import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDetailScreen } from '@/components/payment-detail/payment-detail-screen';
import type { ReviewReason } from '@/lib/api/schemas';
import { apiError, createHandlers } from '@/mocks/handlers';
import { resolveReview } from '@/mocks/review-resolution';
import { MockStore, type MockAttempt, type MockPayment } from '@/mocks/store';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const NOW = new Date();
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

interface Spec {
  n: string;
  reason: ReviewReason;
  openedHoursAgo: number;
  amount?: string;
  paymentStatus?: MockPayment['status'];
}
const SPECS: Spec[] = [
  { n: 'ambiguous', reason: 'AMBIGUOUS_PROVIDER_STATUS', openedHoursAgo: 100, amount: '150000' },
  { n: 'expired', reason: 'AMBIGUOUS_PROVIDER_STATUS', openedHoursAgo: 100, paymentStatus: 'EXPIRED' },
  { n: 'mismatch', reason: 'AMOUNT_MISMATCH', openedHoursAgo: 90 },
  { n: 'late', reason: 'LATE_SUCCESS_ON_CLOSED_PAYMENT', openedHoursAgo: 80, paymentStatus: 'EXPIRED' },
  { n: 'duplicate', reason: 'DUPLICATE_SUCCESS', openedHoursAgo: 80, paymentStatus: 'SUCCEEDED' },
  { n: 'young', reason: 'AMBIGUOUS_PROVIDER_STATUS', openedHoursAgo: 10 },
];

function build(): MockStore {
  const store = new MockStore(NOW);
  for (const spec of SPECS) {
    const payment: MockPayment = {
      id: `pay-${spec.n}`,
      upstreamReference: `order-${spec.n}`,
      amount: spec.amount ?? '100000',
      currency: 'VND',
      status: spec.paymentStatus ?? 'PENDING',
      expiresAt: ago(-1),
      createdAt: ago(spec.openedHoursAgo + 1),
      updatedAt: ago(spec.openedHoursAgo),
    };
    const attempt: MockAttempt = {
      id: `att-${spec.n}`,
      paymentId: payment.id,
      gatewayId: 'stripe',
      status: 'REQUIRES_REVIEW',
      providerRef: `ref-${spec.n}`,
      reviewReason: spec.reason,
      reviewOpenedAt: ago(spec.openedHoursAgo),
      refundRequired: spec.reason !== 'AMBIGUOUS_PROVIDER_STATUS',
      createdAt: ago(spec.openedHoursAgo + 0.5),
      updatedAt: ago(spec.openedHoursAgo),
    };
    store.payments.push(payment);
    store.attempts.push(attempt);
  }
  return store;
}

let store = build();
// The BFF adds `actor` in the real Console; this test stands in for it.
const sentBodies: Record<string, unknown>[] = [];
const bff = http.post('*/api/bff/internal/payments/:id/review-resolution', async ({ request, params }) => {
  const body = (await request.json()) as Record<string, unknown>;
  sentBodies.push(body);
  const outcome = resolveReview(store, String(params.id), { ...body, actor: 'op-test' });
  return outcome.ok ? HttpResponse.json(outcome.result) : apiError(request, outcome.failure, NOW);
});
const server = setupServer(
  bff,
  ...createHandlers({ baseUrl: '*/api/bff', store: new Proxy({} as MockStore, { get: (_t, key) => Reflect.get(store, key) }) }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  store = build();
  sentBodies.length = 0;
  toast.success.mockClear();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function open(n: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <PaymentDetailScreen id={`pay-${n}`} />
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole('group', { name: 'Review' });
  return { user, panel, form: within(panel).queryByRole('form', { name: 'Resolve Review' }) };
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name });

describe('Review resolution form', () => {
  it('AMBIGUOUS_PROVIDER_STATUS on a PENDING Payment offers SUCCEEDED and FAILED, not a note', async () => {
    await open('ambiguous');
    expect(radio('Resolve to SUCCEEDED')).toBeEnabled();
    expect(radio('Resolve to FAILED')).toBeEnabled();
    expect(radio('Add note only')).toBeDisabled();
  });

  it('does not offer SUCCEEDED when the Payment is no longer PENDING, and says why', async () => {
    await open('expired');
    expect(radio('Resolve to SUCCEEDED')).toBeDisabled();
    expect(screen.getByText(/needs the Payment to be PENDING; it is EXPIRED/)).toBeInTheDocument();
    expect(radio('Resolve to FAILED')).toBeEnabled();
  });

  it('AMOUNT_MISMATCH offers only FAILED', async () => {
    await open('mismatch');
    expect(radio('Resolve to SUCCEEDED')).toBeDisabled();
    expect(radio('Resolve to FAILED')).toBeEnabled();
    expect(radio('Add note only')).toBeDisabled();
  });

  it.each(['late', 'duplicate'])('%s offers only "add note"', async (n) => {
    await open(n);
    expect(radio('Resolve to SUCCEEDED')).toBeDisabled();
    expect(radio('Resolve to FAILED')).toBeDisabled();
    expect(radio('Add note only')).toBeEnabled();
    expect(radio('Add note only')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled();
  });

  it('locks everything while the Review is under 72 hours old', async () => {
    await open('young');
    expect(screen.getByText(/Resolvable from/)).toBeInTheDocument();
    for (const name of ['Resolve to SUCCEEDED', 'Resolve to FAILED', 'Add note only']) expect(radio(name)).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resolve Review' })).toBeDisabled();
  });

  it('requires a note', async () => {
    const { user } = await open('mismatch');
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    expect(await screen.findByText('Enter a note explaining the decision.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(sentBodies).toEqual([]);
  });

  it('counts the note and refuses more than 2000 characters', async () => {
    const { user } = await open('mismatch');
    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.type(note, 'abc');
    expect(screen.getByLabelText('Note length')).toHaveTextContent('3 / 2000');
    await user.clear(note);
    await user.click(note);
    await user.paste('x'.repeat(2001));
    expect(screen.getByLabelText('Note length')).toHaveTextContent('2001 / 2000');
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    expect(await screen.findByText('The note can be at most 2000 characters.')).toBeInTheDocument();
    expect(sentBodies).toEqual([]);
  });

  it('asks for the amount for SUCCEEDED and requires it to equal the Payment Amount', async () => {
    const { user } = await open('ambiguous');
    await user.click(radio('Resolve to FAILED'));
    expect(screen.queryByRole('textbox', { name: /Amount collected/ })).not.toBeInTheDocument();
    await user.click(radio('Resolve to SUCCEEDED'));
    const amount = screen.getByRole('textbox', { name: /Amount collected/ });
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Seen in dashboard');

    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    expect(await screen.findByText('Enter the amount the PaymentGateway collected.')).toBeInTheDocument();

    await user.type(amount, '149999.99');
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    expect(await screen.findByText('The amount must equal the Payment Amount (150000).')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(sentBodies).toEqual([]);
  });

  it('asks for confirmation before a status change, and sends nothing if cancelled', async () => {
    const { user } = await open('mismatch');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Provider confirmed less');
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Resolve this Review to FAILED?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(sentBodies).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Provider confirmed less');
  });

  it('resolves to FAILED: sends no actor, toasts, and updates the Payment detail', async () => {
    const { user } = await open('mismatch');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), '  Provider confirmed less  ');
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirm FAILED' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Resolve Review' })).not.toBeInTheDocument());
    expect(sentBodies).toEqual([{ attemptId: 'att-mismatch', status: 'FAILED', note: 'Provider confirmed less' }]);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
    const history = screen.getByRole('table', { name: 'Status history' });
    expect(within(history).getByText('operator_resolution')).toBeInTheDocument();
    expect(within(history).getByText('op-test')).toBeInTheDocument();
    expect(within(history).getByText('Provider confirmed less')).toBeInTheDocument();
  });

  it('adds a note without a confirmation, and the Review stays open', async () => {
    const { user } = await open('late');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Refund by hand');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Note added to the Review.'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(sentBodies).toEqual([{ attemptId: 'att-late', note: 'Refund by hand' }]);
    expect(await screen.findByText('operator_note')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Resolve Review' })).toBeInTheDocument();
  });

  it('resolves to SUCCEEDED with the amount, and the Payment becomes SUCCEEDED', async () => {
    const { user } = await open('ambiguous');
    await user.click(radio('Resolve to SUCCEEDED'));
    await user.type(screen.getByRole('textbox', { name: /Amount collected/ }), '150000');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Seen in dashboard');
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirm SUCCEEDED' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Resolve Review' })).not.toBeInTheDocument());
    expect(sentBodies).toEqual([{ attemptId: 'att-ambiguous', status: 'SUCCEEDED', amount: '150000', note: 'Seen in dashboard' }]);
    expect(await screen.findByText('PaymentSucceeded')).toBeInTheDocument();
  });

  it("shows the API's message when Core refuses, and keeps the note", async () => {
    const { user } = await open('ambiguous');
    await user.click(radio('Resolve to SUCCEEDED'));
    await user.type(screen.getByRole('textbox', { name: /Amount collected/ }), '150000');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'My careful note');
    // The Payment expires behind the Operator's back.
    store.getPayment('pay-ambiguous')!.status = 'EXPIRED';
    await user.click(screen.getByRole('button', { name: 'Resolve Review' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirm SUCCEEDED' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The Payment is no longer pending');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('My careful note');
    expect(toast.success).not.toHaveBeenCalled();
    expect(store.attempts.find((a) => a.id === 'att-ambiguous')!.status).toBe('REQUIRES_REVIEW');
  });
});
