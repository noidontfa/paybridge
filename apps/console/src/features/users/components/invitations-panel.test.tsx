import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OperatorProvider, type Operator } from '@/lib/operator';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { InvitationsPanel } from './invitations-panel';

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  store.invitations.length = 0;
});
afterAll(() => server.close());

function renderPanel(operator: Operator) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={operator}>
        <InvitationsPanel />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}
const admin: Operator = { id: 'u', name: 'Ana', permissions: ['payments:view', 'users:manage'] };

describe('InvitationsPanel', () => {
  it('sends an Invitation, lists it as pending, and revokes it', async () => {
    const user = userEvent.setup();
    renderPanel(admin);
    await screen.findByText('No pending Invitations.');

    await user.type(screen.getByLabelText('Email'), 'new.person@example.test');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('new.person@example.test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('No pending Invitations.')).toBeInTheDocument();
  });

  it('offers the Super Admin Role only with the Permission to manage Super Admins', async () => {
    renderPanel(admin);
    await screen.findByText('No pending Invitations.');
    expect(screen.queryByRole('option', { name: 'Super Admin' })).not.toBeInTheDocument();
  });

  it('tells a User without the Permission, and calls nothing', () => {
    renderPanel({ id: 'u', name: 'Una', permissions: ['payments:view'] });
    expect(screen.getByText(/Only an Organization Admin/)).toBeInTheDocument();
  });
});
