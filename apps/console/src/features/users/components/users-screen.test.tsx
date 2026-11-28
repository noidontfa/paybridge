import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { OperatorProvider } from '@/features/auth/components/operator-provider';
import { UsersScreen } from './users-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderScreen(permissions?: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={{ id: 'dana', name: 'Dana', permissions }}>
        <UsersScreen />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe('Users screen', () => {
  it('lists Users with Role and state, and deactivates and reactivates one', async () => {
    const user = userEvent.setup();
    renderScreen(['users:manage']);
    const olu = await screen.findByRole('row', { name: 'olu@example.test' });
    expect(within(olu).getByText('Operator')).toBeInTheDocument();
    expect(within(olu).getByText('Active')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: 'pat@example.test' })).getByText(
        'Deactivated',
      ),
    ).toBeInTheDocument();

    await user.click(within(olu).getByRole('button', { name: 'Deactivate' }));
    const deactivated = await screen.findByRole('row', {
      name: 'olu@example.test',
    });
    expect(
      await within(deactivated).findByText('Deactivated'),
    ).toBeInTheDocument();
    await user.click(
      await within(deactivated).findByRole('button', { name: 'Reactivate' }),
    );
    const again = await screen.findByRole('row', { name: 'olu@example.test' });
    expect(await within(again).findByText('Active')).toBeInTheDocument();
  });

  it('hides the list from a User without the Permission', () => {
    renderScreen(['payments:view']);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
