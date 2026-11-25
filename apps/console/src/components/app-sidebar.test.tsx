import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
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

function renderShell(path = '/') {
  pathname.current = path;
  return render(
    <ThemeProvider attribute="class" defaultTheme="system">
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>,
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
});
