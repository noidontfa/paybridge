import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorProvider } from '@/features/auth/components/operator-provider';
import type { Operator } from '@/features/auth/utils/operator';
import { createHandlers } from '@/mocks/handlers';
import { seedPricingPlans } from '@/mocks/pricing-plans';
import { seedPricingTables } from '@/mocks/pricing-tables';
import { MockStore } from '@/mocks/store';
import { NewPricingTableScreen, PricingTableEditorScreen } from './pricing-table-editor';
import { PricingTablesScreen } from './pricing-tables-screen';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const store = new MockStore(new Date('2026-11-25T03:00:00.000Z'));
const server = setupServer(...createHandlers({ baseUrl: '*/api/bff', store }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  seedPricingPlans(store);
  seedPricingTables(store);
});
afterEach(() => {
  server.resetHandlers();
  store.pricingPlans.length = 0;
  store.pricingTables.length = 0;
  store.publishableKeys.length = 0;
  push.mockReset();
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
const admin: Operator = {
  id: 'u',
  name: 'Ana',
  permissions: ['pricing:view', 'pricing:manage', 'publishable-keys:manage'],
};
const operator: Operator = { id: 'o', name: 'Olu', permissions: ['pricing:view'] };

function addKey() {
  store.publishableKeys.push({
    id: 'pk-1',
    label: 'Website',
    key: 'pb_pk_test_123',
    allowedOrigins: ['https://shop.example'],
    createdAt: store.now.toISOString(),
    updatedAt: store.now.toISOString(),
    revokedAt: null,
    createdBy: { name: 'Ana', role: 'ORGANIZATION_ADMIN', label: null },
    updatedBy: { name: 'Ana', role: 'ORGANIZATION_ADMIN', label: null },
  });
}

describe('Pricing Tables for an Operator', () => {
  it('lists them with their Pricing Plans, without the New Pricing Table link', async () => {
    renderWith(operator, <PricingTablesScreen />);
    const row = (await screen.findByRole('link', { name: 'Home page pricing' })).closest('tr')!;
    expect(await within(row).findByText(/Pro \(recommended\)/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New Pricing Table' })).not.toBeInTheDocument();
  });

  it('shows a Pricing Table read-only, without a snippet key picker', async () => {
    renderWith(operator, <PricingTableEditorScreen id="table-home" />);
    const form = await screen.findByRole('form', { name: 'Pricing Table' });
    expect(within(form).getByLabelText('Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete…' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Embed' })).toHaveTextContent('An Organization Admin can copy the snippet');
  });
});

describe('the preview', () => {
  it('draws the cards in order, recommended badge, archived not buyable, in the language', async () => {
    renderWith(admin, <PricingTableEditorScreen id="table-home" />);
    const preview = await screen.findByRole('region', { name: 'Preview' });
    const cards = within(preview).getAllByRole('listitem', { name: /Basic|Pro|Legacy Starter/ });
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Basic', 'Pro', 'Legacy Starter']);
    expect(within(cards[1]!).getByText('Đề xuất')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('button', { name: 'Mua ngay' })).toBeEnabled();
    expect(within(cards[2]!).getByRole('button', { name: 'Tạm ngừng bán' })).toBeDisabled();
  });

  it('follows the form as it changes', async () => {
    const user = userEvent.setup();
    renderWith(admin, <PricingTableEditorScreen id="table-home" />);
    const form = await screen.findByRole('form', { name: 'Pricing Table' });
    await user.selectOptions(within(form).getByLabelText('Language'), 'en');
    await user.selectOptions(within(form).getByLabelText('Theme'), 'dark');
    await user.click(within(form).getByRole('button', { name: 'Move Pro left' }));
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(preview).toHaveAttribute('data-theme', 'dark');
    expect(within(preview).getByText('Recommended')).toBeInTheDocument();
    const names = within(preview)
      .getAllByRole('listitem', { name: /Basic|Pro|Legacy Starter/ })
      .map((c) => c.getAttribute('aria-label'));
    expect(names).toEqual(['Pro', 'Basic', 'Legacy Starter']);
  });
});

describe('the snippet', () => {
  it('uses a chosen Publishable Key and the Pricing Table id', async () => {
    addKey();
    renderWith(admin, <PricingTableEditorScreen id="table-home" />);
    const snippet = await screen.findByLabelText('Snippet');
    expect(snippet).toHaveTextContent('data-key="pb_pk_test_123"');
    expect(snippet).toHaveTextContent('data-table="table-home"');
    expect(snippet).toHaveTextContent('/v1/paybridge.js');
    expect(screen.getByRole('button', { name: 'Copy snippet' })).toBeInTheDocument();
    expect(screen.getByText('data-customer-ref')).toBeInTheDocument();
  });

  it('asks for a Publishable Key when there is none', async () => {
    renderWith(admin, <PricingTableEditorScreen id="table-home" />);
    expect(await screen.findByText(/No Publishable Key yet/)).toBeInTheDocument();
  });
});

describe('creating a Pricing Table', () => {
  it('allows at most three Pricing Plans and sends them in order', async () => {
    store.pricingPlans.push({ ...store.pricingPlans[0]!, id: 'plan-team', name: 'Team' });
    const user = userEvent.setup();
    renderWith(admin, <NewPricingTableScreen />);
    const form = await screen.findByRole('form', { name: 'Pricing Table' });
    await user.type(within(form).getByLabelText('Name'), 'Promo');
    await user.click(within(form).getByRole('checkbox', { name: /^Pro/ }));
    await user.click(within(form).getByRole('checkbox', { name: /^Basic/ }));
    await user.click(within(form).getByRole('checkbox', { name: /^Team/ }));
    expect(within(form).getByRole('checkbox', { name: /^Legacy Starter/ })).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText('Recommended'), 'plan-basic');
    await user.click(within(form).getByRole('button', { name: 'Create Pricing Table' }));

    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    const created = store.pricingTables.find((t) => t.name === 'Promo')!;
    expect(created).toMatchObject({ planIds: ['plan-pro', 'plan-basic', 'plan-team'], recommendedPlanId: 'plan-basic' });
  });

  it('shows the API refusal', async () => {
    const user = userEvent.setup();
    renderWith(admin, <NewPricingTableScreen />);
    const form = await screen.findByRole('form', { name: 'Pricing Table' });
    await user.type(within(form).getByLabelText('Name'), 'Empty');
    await user.click(within(form).getByRole('button', { name: 'Create Pricing Table' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('planIds');
  });
});
