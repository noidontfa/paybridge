import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorProvider } from '@/features/auth/components/operator-provider';
import type { Operator } from '@/features/auth/utils/operator';
import { createHandlers } from '@/mocks/handlers';
import { seedPricingPlans } from '@/mocks/pricing-plans';
import { MockStore } from '@/mocks/store';
import { PricingPlanEditorScreen } from './pricing-plan-editor';
import { PricingPlansScreen } from './pricing-plans-screen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => seedPricingPlans(store));
afterEach(() => {
  server.resetHandlers();
  store.pricingPlans.length = 0;
});
afterAll(() => server.close());

function renderWith(operator: Operator, ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorProvider operator={operator}>{ui}</OperatorProvider>
    </QueryClientProvider>,
  );
}
const admin: Operator = { id: 'u', name: 'Ana', permissions: ['pricing:view', 'pricing:manage'] };
const operator: Operator = { id: 'o', name: 'Olu', permissions: ['pricing:view'] };

describe('Pricing Plans for an Operator', () => {
  it('lists them without the New Pricing Plan link', async () => {
    renderWith(operator, <PricingPlansScreen />);
    expect(await screen.findByRole('link', { name: 'Pro' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New Pricing Plan' })).not.toBeInTheDocument();
  });

  it('shows a Pricing Plan read-only', async () => {
    renderWith(operator, <PricingPlanEditorScreen id="plan-pro" />);
    const form = await screen.findByRole('form', { name: 'Pricing Plan' });
    expect(within(form).getByLabelText('Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive…' })).not.toBeInTheDocument();
  });
});

describe('archiving a Pricing Plan', () => {
  it('names the Pricing Tables that show it before archiving', async () => {
    server.use(
      http.get('*/api/bff/internal/pricing-plans/plan-pro', () =>
        HttpResponse.json({ ...store.pricingPlans.find((p) => p.id === 'plan-pro'), pricingTables: [{ id: 't1', name: 'Home page' }] }),
      ),
    );
    const user = userEvent.setup();
    renderWith(admin, <PricingPlanEditorScreen id="plan-pro" />);
    await user.click(await screen.findByRole('button', { name: 'Archive…' }));

    const confirm = screen.getByRole('group', { name: 'Archive Pricing Plan' });
    expect(confirm).toHaveTextContent('Home page');
    await user.click(within(confirm).getByRole('button', { name: 'Archive Pricing Plan' }));
    await vi.waitFor(() => expect(store.pricingPlans.find((p) => p.id === 'plan-pro')?.status).toBe('ARCHIVED'));
  });

  it('shows feature lines as plain text', async () => {
    store.pricingPlans[0]!.features = [{ text: '<b>bold</b>', included: true }];
    renderWith(admin, <PricingPlanEditorScreen id={store.pricingPlans[0]!.id} />);
    expect(await screen.findByDisplayValue('<b>bold</b>')).toBeInTheDocument();
  });
});
