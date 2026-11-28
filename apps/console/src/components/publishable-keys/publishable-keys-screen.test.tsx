import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OperatorProvider, type Operator } from '@/lib/operator';
import { createHandlers } from '@/mocks/handlers';
import { MockStore } from '@/mocks/store';
import { PublishableKeysScreen } from './publishable-keys-screen';

vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  store.publishableKeys.length = 0;
});
afterAll(() => server.close());

function renderScreen(operator: Operator) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={operator}>
        <PublishableKeysScreen />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}
const admin: Operator = { id: 'u', name: 'Ana', permissions: ['payments:view', 'publishable-keys:manage'] };

async function createKey(user: ReturnType<typeof userEvent.setup>, label: string, origins: string) {
  await user.type(await screen.findByLabelText('Label'), label);
  await user.type(screen.getByLabelText('Allowed origins'), origins);
  await user.click(screen.getByRole('button', { name: 'Create Publishable Key' }));
}

describe('PublishableKeysScreen', () => {
  it('creates a key and keeps showing the full key with its allowed origins', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await screen.findByText('No Publishable Keys yet.');

    await createKey(user, 'Landing page', 'https://shop.example.com{enter}https://www.example.com');

    const row = (await screen.findByText('Landing page')).closest('tr')!;
    expect(within(row).getByText(/^pb_pk_/)).toBeInTheDocument();
    expect(within(row).getByText('https://shop.example.com')).toBeInTheDocument();
    expect(within(row).getByText('https://www.example.com')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy Publishable Key' })).toBeInTheDocument();
  });

  it('shows why an origin is refused', async () => {
    const user = userEvent.setup();
    renderScreen(admin);

    await createKey(user, 'Bad', 'shop.example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(/not an origin/);
  });

  it('edits the allowed origins of a key', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await createKey(user, 'Landing page', 'https://shop.example.com');

    await user.click(await screen.findByRole('button', { name: 'Edit origins of Landing page' }));
    const editor = screen.getByLabelText('Allowed origins of Landing page');
    await user.clear(editor);
    await user.type(editor, 'https://new.example.com');
    await user.click(screen.getByRole('button', { name: 'Save origins' }));

    expect(await screen.findByText('https://new.example.com')).toBeInTheDocument();
    expect(screen.queryByText('https://shop.example.com')).not.toBeInTheDocument();
  });

  it('revokes a key', async () => {
    const user = userEvent.setup();
    renderScreen(admin);
    await createKey(user, 'Old', 'https://shop.example.com');

    await user.click(await screen.findByRole('button', { name: 'Revoke Old' }));

    expect(await screen.findByText(/^Revoked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke Old' })).not.toBeInTheDocument();
  });

  it('tells a User without the Permission, and calls nothing', () => {
    renderScreen({ id: 'u', name: 'Una', permissions: ['payments:view'] });
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
