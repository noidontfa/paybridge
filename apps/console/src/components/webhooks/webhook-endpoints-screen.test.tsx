import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OperatorProvider, type Operator } from '@/lib/operator';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { seedWebhookDeliveries } from '@/mocks/webhook-deliveries';
import { WebhookEndpointsScreen } from './webhook-endpoints-screen';

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  store.webhookEndpoints.length = 0;
  store.webhookDeliveries.length = 0;
});
afterAll(() => server.close());

function renderScreen(operator: Operator) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={operator}>
        <WebhookEndpointsScreen />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}
const admin: Operator = { id: 'u', name: 'Ana', permissions: ['payments:view', 'webhook-endpoints:manage'] };

async function register(user: ReturnType<typeof userEvent.setup>, url: string, kinds: string[] = []) {
  const form = screen.getByRole('form', { name: 'Add Webhook Endpoint' });
  await user.clear(within(form).getByLabelText('URL'));
  await user.type(within(form).getByLabelText('URL'), url);
  for (const kind of kinds) await user.click(within(form).getByRole('checkbox', { name: kind }));
  await user.click(within(form).getByRole('button', { name: 'Add endpoint' }));
}

describe('WebhookEndpointsScreen', () => {
  it('adds an endpoint, shows the signing secret once, then lists only its prefix', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Webhook Endpoints yet.');

    await register(user, 'https://erp.example.com/hook', ['payment.created']);

    const banner = await screen.findByRole('status', { name: 'New signing secret' });
    const secret = banner.querySelector('code')!.textContent!;
    expect(secret).toMatch(/^whsec_pb_/);
    const row = (await screen.findByText('https://erp.example.com/hook')).closest('tr')!;
    expect(within(row).getByText('payment.created, payment.succeeded')).toBeInTheDocument();
    expect(within(row).getByText('Enabled')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it('subscribes a new endpoint to payment.succeeded by default and needs at least one kind', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Webhook Endpoints yet.');
    const form = screen.getByRole('form', { name: 'Add Webhook Endpoint' });

    expect(within(form).getByRole('checkbox', { name: 'payment.succeeded' })).toBeChecked();
    await user.click(within(form).getByRole('checkbox', { name: 'payment.succeeded' }));
    await user.type(within(form).getByLabelText('URL'), 'https://x.example.com');
    expect(within(form).getByRole('button', { name: 'Add endpoint' })).toBeDisabled();
  });

  it('disables, enables and deletes an endpoint', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Webhook Endpoints yet.');
    await register(user, 'https://old.example.com/hook');
    const url = 'https://old.example.com/hook';
    const rowOf = async () => (await screen.findByText(url)).closest('tr')!;

    await user.click(within(await rowOf()).getByRole('button', { name: `Disable ${url}` }));
    expect(await within(await rowOf()).findByText('Disabled')).toBeInTheDocument();

    await user.click(within(await rowOf()).getByRole('button', { name: `Enable ${url}` }));
    expect(await within(await rowOf()).findByText('Enabled')).toBeInTheDocument();

    await user.click(within(await rowOf()).getByRole('button', { name: `Delete ${url}` }));
    expect(await screen.findByText('No Webhook Endpoints yet.')).toBeInTheDocument();
  });

  it('edits the URL and the kinds of an endpoint', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Webhook Endpoints yet.');
    await register(user, 'https://a.example.com/hook');

    await user.click(await screen.findByRole('button', { name: 'Edit https://a.example.com/hook' }));
    const form = screen.getByRole('form', { name: 'Edit Webhook Endpoint' });
    await user.clear(within(form).getByLabelText('URL'));
    await user.type(within(form).getByLabelText('URL'), 'https://b.example.com/hook');
    await user.click(within(form).getByRole('checkbox', { name: 'payment.expired' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const row = (await screen.findByText('https://b.example.com/hook')).closest('tr')!;
    expect(within(row).getByText('payment.succeeded, payment.expired')).toBeInTheDocument();
  });

  it('shows the API error when the URL is refused', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Webhook Endpoints yet.');

    await register(user, 'not a url');

    expect(await screen.findByRole('alert')).toHaveTextContent('The URL is not valid');
  });

  it('tells a User without the Permission, and calls nothing', () => {
    renderScreen({ id: 'u', name: 'Una', permissions: ['payments:view'] });
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('marks an endpoint whose latest deliveries all failed', async () => {
    store.events.push(
      ...[1, 2, 3].map((n) => ({
        id: `event-${n}`,
        type: 'PaymentCreated' as const,
        paymentId: `payment-${n}`,
        payload: {},
        createdAt: `2026-11-2${n}T03:00:00.000Z`,
        publishedAt: null,
      })),
    );
    seedWebhookDeliveries(store);
    store.events.length = 0;
    renderScreen(admin);

    const crm = (await screen.findByText('https://crm.example.test/hooks/paybridge')).closest('tr')!;
    const erp = screen.getByText('https://erp.example.test/paybridge/webhooks').closest('tr')!;
    expect(within(crm).getByText('Failing')).toBeInTheDocument();
    expect(within(erp).queryByText('Failing')).not.toBeInTheDocument();
  });

  it('sends a test event and shows what the receiver answered', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Webhook Endpoints yet.');
    await register(user, 'https://erp.example.com/hook');

    await user.click(await screen.findByRole('button', { name: 'Send a test event to https://erp.example.com/hook' }));

    expect(await screen.findByRole('status', { name: 'Test result for https://erp.example.com/hook' })).toHaveTextContent(
      'Test delivered (HTTP 200)',
    );
    expect(store.webhookDeliveries.map((d) => d.eventKind)).toEqual(['webhook.test']);
  });
});
