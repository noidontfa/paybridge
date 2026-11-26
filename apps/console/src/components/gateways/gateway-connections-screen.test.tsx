import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OperatorProvider, type Operator } from '@/lib/operator';
import { GatewayConnectionsScreen } from './gateway-connections-screen';

const connection = (over: object = {}) => ({
  id: 'c1',
  organizationId: 'o1',
  gatewayId: 'stripe',
  enabled: true,
  credentialsVersion: 1,
  credentialFields: ['publishableKey', 'secretKey', 'webhookSecret'],
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z',
  ...over,
});

let items = [connection()];
const calls: string[] = [];
const server = setupServer(
  http.get('*/internal/gateway-connections', () => HttpResponse.json({ items })),
  http.post('*/internal/gateway-connections/c1/disable', () => {
    calls.push('disable');
    items = [connection({ enabled: false })];
    return HttpResponse.json(items[0]);
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  items = [connection()];
  calls.length = 0;
});
afterAll(() => server.close());

function renderScreen(operator: Operator) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OperatorProvider operator={operator}>
        <GatewayConnectionsScreen />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe('GatewayConnectionsScreen', () => {
  it('lists connections by the credential fields that are set, never their values, and disables one', async () => {
    renderScreen({ id: 'u', name: 'Ana', permissions: ['gateway-connections:manage'] });
    expect(await screen.findByRole('article', { name: 'stripe' })).toHaveTextContent('Enabled');
    expect(screen.getByText(/Values are never shown/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    expect(calls).toEqual(['disable']);
  });

  it('tells a User without the Permission, and calls nothing', () => {
    renderScreen({ id: 'u', name: 'Una', permissions: ['payments:view'] });
    expect(screen.getByText('You do not have permission to manage Gateway Connections.')).toBeInTheDocument();
  });
});
