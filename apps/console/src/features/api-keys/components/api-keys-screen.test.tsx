import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OperatorProvider } from '@/features/auth/components/operator-provider';
import type { Operator } from '@/features/auth/utils/operator';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { ApiKeysScreen } from './api-keys-screen';

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  store.apiKeys.length = 0;
});
afterAll(() => server.close());

function renderScreen(operator: Operator) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={operator}>
        <ApiKeysScreen />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}
const admin: Operator = { id: 'u', name: 'Ana', permissions: ['payments:view', 'api-keys:manage'] };

describe('ApiKeysScreen', () => {
  it('creates a key, shows the full key once, then lists only its prefix', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No API Keys yet.');

    await user.type(screen.getByLabelText('Label'), 'Billing system');
    await user.click(screen.getByRole('button', { name: 'Create API Key' }));

    const banner = await screen.findByRole('status', { name: 'New API Key' });
    const full = banner.querySelector('code')!.textContent!;
    expect(full).toMatch(/^pb_live_/);
    expect(await screen.findByText('Billing system')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(full)).not.toBeInTheDocument();
  });

  it('revokes a key', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await user.type(await screen.findByLabelText('Label'), 'Old');
    await user.click(screen.getByRole('button', { name: 'Create API Key' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke Old' }));

    expect(await screen.findByText(/^Revoked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke Old' })).not.toBeInTheDocument();
  });

  it('tells a User without the Permission, and calls nothing', () => {
    renderScreen({ id: 'u', name: 'Una', permissions: ['payments:view'] });
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
