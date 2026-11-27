import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OperatorProvider } from '@/features/auth/components/operator-provider';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { OrganizationsScreen } from './organizations-screen';
import { SuperAdminsScreen } from './super-admins-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderScreen(ui: React.ReactNode, permissions?: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={{ id: 'sam', name: 'Sam', permissions }}>{ui}</OperatorProvider>
    </QueryClientProvider>,
  );
}

describe('Organizations screen', () => {
  it('suspends and reactivates an Organization', async () => {
    const user = userEvent.setup();
    renderScreen(<OrganizationsScreen />, ['organizations:manage']);
    const acme = await screen.findByRole('row', { name: 'Acme Retail' });
    expect(within(acme).getByText('Active')).toBeInTheDocument();

    await user.click(within(acme).getByRole('button', { name: 'Suspend' }));
    const suspended = await screen.findByRole('row', { name: 'Acme Retail' });
    expect(await within(suspended).findByText('Suspended')).toBeInTheDocument();

    await user.click(await within(suspended).findByRole('button', { name: 'Reactivate' }));
    const again = await screen.findByRole('row', { name: 'Acme Retail' });
    expect(await within(again).findByText('Active')).toBeInTheDocument();
  });

  it('creates an Organization with its first admin email', async () => {
    const user = userEvent.setup();
    renderScreen(<OrganizationsScreen />, ['organizations:manage']);
    await screen.findByRole('row', { name: 'Acme Retail' });
    await user.type(screen.getByLabelText('Organization name'), 'Brand New Co');
    await user.type(screen.getByLabelText('First Organization Admin email'), 'first@brandnew.test');
    await user.click(screen.getByRole('button', { name: 'Create Organization' }));
    expect(await screen.findByRole('row', { name: 'Brand New Co' })).toBeInTheDocument();
  });

  it('hides the area from a User without the Permission', () => {
    renderScreen(<OrganizationsScreen />, ['payments:view']);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Create Organization' })).toBeNull();
  });
});

describe('Super Admins screen', () => {
  it('deactivates one Super Admin and refuses the last active one', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    renderScreen(<SuperAdminsScreen />, ['super-admins:manage']);
    const sam = await screen.findByRole('row', { name: 'sam@example.test' });
    expect(within(sam).queryByRole('button', { name: 'Make Operator' })).toBeNull();

    await user.click(within(sam).getByRole('button', { name: 'Deactivate' }));
    expect(await within(await screen.findByRole('row', { name: 'sam@example.test' })).findByText('Deactivated')).toBeInTheDocument();

    const sue = screen.getByRole('row', { name: 'sue@example.test' });
    await user.click(within(sue).getByRole('button', { name: 'Deactivate' }));
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The platform must keep at least one active Super Admin.'),
    );
    expect(within(screen.getByRole('row', { name: 'sue@example.test' })).getByText('Active')).toBeInTheDocument();
  });

  it('invites another Super Admin', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    renderScreen(<SuperAdminsScreen />, ['super-admins:manage']);
    await screen.findByRole('row', { name: 'sue@example.test' });
    await user.type(screen.getByLabelText('Email'), 'new.sa@example.test');
    await user.click(screen.getByRole('button', { name: 'Invite Super Admin' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation sent.'));
  });
});
