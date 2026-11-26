import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReviewSummary } from '@/lib/api/reviews';
import { OperatorProvider, type Operator } from '@/lib/operator';
import type { OrganizationList } from '@/lib/api/organizations';
import { organizationKeys } from '@/lib/queries/organizations';
import { reviewKeys } from '@/lib/queries/reviews';
import { AppSidebar } from './app-sidebar';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

function summary(open: number): ReviewSummary {
  return {
    open,
    total: open,
    byReason: { AMBIGUOUS_PROVIDER_STATUS: open, AMOUNT_MISMATCH: 0, LATE_SUCCESS_ON_CLOSED_PAYMENT: 0, DUPLICATE_SUCCESS: 0 },
  };
}

/** The Review summary is served from the query cache, so no network is needed. */
function renderShell(
  path = '/',
  openReviews: number | null = null,
  operator: Operator = { id: 'operator', name: 'Operator' },
  organizations?: OrganizationList,
) {
  pathname.current = path;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (openReviews !== null) client.setQueryData(reviewKeys.summary(), summary(openReviews));
  if (organizations) client.setQueryData(organizationKeys.list(), organizations);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system">
        <TooltipProvider>
          <OperatorProvider operator={operator}>
            <SidebarProvider>
              <AppSidebar />
            </SidebarProvider>
          </OperatorProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('Console sidebar', () => {
  it('shows the product name in the header', () => {
    renderShell();
    expect(screen.getByText('PayBridge Console')).toBeInTheDocument();
  });

  it.each([
    ['Overview', '/'],
    ['Payments', '/payments'],
    ['Exceptions', '/exceptions'],
    ['Gateways', '/gateways'],
    ['Callbacks', '/callbacks'],
    ['Events', '/events'],
    ['Audit log', '/audit-log'],
    ['Pricing Plans', '/pricing-plans'],
    ['Settings', '/settings'],
    ['Docs', '/docs'],
  ])('links %s to %s', (name, href) => {
    renderShell();
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('groups items under Payments and Developers', () => {
    renderShell();
    const payments = screen.getByRole('group', { name: 'Payments' });
    expect(within(payments).getByRole('link', { name: 'Exceptions' })).toBeInTheDocument();
    const developers = screen.getByRole('group', { name: 'Developers' });
    expect(within(developers).getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it('shows Refunds as disabled, marked Soon, with no route', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: /refunds/i })).not.toBeInTheDocument();
    const refunds = screen.getByRole('button', { name: /refunds/i });
    expect(refunds).toBeDisabled();
    expect(refunds).toHaveTextContent('Soon');
  });

  it('highlights the active item, also for nested routes', () => {
    renderShell('/payments/pay_123');
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Exceptions' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('highlights Overview only on the root', () => {
    renderShell('/');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers the Operator menu in the footer', () => {
    renderShell();
    expect(screen.getByRole('button', { name: /operator/i })).toBeInTheDocument();
  });

  it('shows who the Operator is signed in as, from the current Operator', () => {
    renderShell('/', null, { id: 'op-9', name: 'Linh Tran' });
    const footer = screen.getByRole('button', { name: 'Linh Tran menu' });
    expect(within(footer).getByText('Linh Tran')).toBeInTheDocument();
    expect(within(footer).getByText('op-9')).toBeInTheDocument();
  });

  it('shows the Role and Organization of the signed-in User', () => {
    renderShell('/', null, { id: 'u-1', name: 'Una Ops', role: 'OPERATOR', organization: 'Acme Retail' });
    const footer = screen.getByRole('button', { name: 'Una Ops menu' });
    expect(within(footer).getByText('Operator · Acme Retail')).toBeInTheDocument();
  });

  it('shows only the Role for a Super Admin, who has no Organization', () => {
    renderShell('/', null, { id: 'u-2', name: 'Sam', role: 'SUPER_ADMIN', organization: null });
    expect(within(screen.getByRole('button', { name: 'Sam menu' })).getByText('Super Admin')).toBeInTheDocument();
  });

  describe('Exceptions badge', () => {
    it('shows the number of open Reviews on the Exceptions item', () => {
      renderShell('/', 7);
      expect(screen.getByLabelText('7 open Reviews')).toHaveTextContent('7');
      expect(screen.getByRole('link', { name: /Exceptions/ })).toBeInTheDocument();
    });

    it('says "1 open Review" for a single one', () => {
      renderShell('/', 1);
      expect(screen.getByLabelText('1 open Review')).toBeInTheDocument();
    });

    it('is hidden at zero', () => {
      renderShell('/', 0);
      expect(screen.queryByLabelText(/open Review/)).not.toBeInTheDocument();
    });

    it('is hidden until the count is known', () => {
      renderShell('/');
      expect(screen.queryByLabelText(/open Review/)).not.toBeInTheDocument();
    });
  });

  describe('the Organization switcher', () => {
    const superAdmin: Operator = { id: 'sa', name: 'Sam Super', role: 'SUPER_ADMIN', organization: null, permissions: ['payments:view', 'organizations:manage'] };
    const organizations = { items: [{ id: '6f1f3f0e-3b8e-4c43-9a5c-1f2d3e4f5a6b', name: 'Acme Retail', status: 'ACTIVE' as const }] };

    it('is offered to a Super Admin, with All Organizations and each Organization', () => {
      renderShell('/', null, superAdmin, organizations);
      const select = screen.getByRole('combobox', { name: 'Organization' });
      expect(within(select).getByRole('option', { name: 'All Organizations' })).toBeInTheDocument();
      expect(within(select).getByRole('option', { name: 'Acme Retail' })).toBeInTheDocument();
    });

    it('remembers the choice in the organization cookie', async () => {
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, reload });
      renderShell('/', null, superAdmin, organizations);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), 'Acme Retail');
      expect(document.cookie).toContain('pb_org=6f1f3f0e-3b8e-4c43-9a5c-1f2d3e4f5a6b');
      expect(reload).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('is not offered to anyone else', () => {
      renderShell('/', null, { id: 'u', name: 'Una', role: 'ORGANIZATION_ADMIN', organization: 'Acme Retail', permissions: ['payments:view', 'users:manage'] }, organizations);
      expect(screen.queryByRole('combobox', { name: 'Organization' })).not.toBeInTheDocument();
    });
  });

  describe('Checkout items', () => {
    it('shows Pricing Plans under Checkout with pricing:view', () => {
      renderShell('/', null, { id: 'u', name: 'Olu', role: 'OPERATOR', permissions: ['payments:view', 'pricing:view'] });
      const checkout = screen.getByRole('group', { name: 'Checkout' });
      expect(within(checkout).getByRole('link', { name: 'Pricing Plans' })).toHaveAttribute('href', '/pricing-plans');
    });

    it('hides the Checkout section without pricing:view', () => {
      renderShell('/', null, { id: 'u', name: 'Olu', role: 'OPERATOR', permissions: ['payments:view'] });
      expect(screen.queryByRole('link', { name: 'Pricing Plans' })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Checkout' })).not.toBeInTheDocument();
    });
  });

  describe('Settings items', () => {
    const names = ['Users', 'Invitations', 'API Keys', 'Publishable Keys', 'Gateway Connections'];

    it('hides what the User has no Permission for', () => {
      renderShell('/', null, { id: 'u', name: 'Olu', role: 'OPERATOR', permissions: ['payments:view', 'reviews:resolve'] });
      for (const name of names) expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    });

    it('shows them with the Permissions', () => {
      renderShell('/', null, {
        id: 'u',
        name: 'Ana',
        role: 'ORGANIZATION_ADMIN',
        permissions: [
          'payments:view',
          'users:manage',
          'api-keys:manage',
          'publishable-keys:manage',
          'gateway-connections:manage',
        ],
      });
      for (const name of names) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    });
  });
});
