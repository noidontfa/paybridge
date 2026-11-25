import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReviewSummary } from '@/lib/api/reviews';
import { OperatorProvider } from '@/lib/operator';
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
function renderShell(path = '/', openReviews: number | null = null, operator = { id: 'operator', name: 'Operator' }) {
  pathname.current = path;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (openReviews !== null) client.setQueryData(reviewKeys.summary(), summary(openReviews));
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
});
