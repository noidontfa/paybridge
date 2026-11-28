import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PageHeader } from './page-header';

vi.mock('next/navigation', () => ({ usePathname: () => '/exceptions' }));

describe('page header', () => {
  it('shows a breadcrumb for the current page and its title', () => {
    render(
      <SidebarProvider>
        <PageHeader title="Exceptions" description="Reviews that need an Operator." />
      </SidebarProvider>,
    );
    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(crumbs).toHaveTextContent('PayBridge Console');
    expect(crumbs).toHaveTextContent('Payments');
    expect(crumbs.querySelector('[aria-current="page"]')).toHaveTextContent('Exceptions');
    expect(screen.getByRole('heading', { level: 1, name: 'Exceptions' })).toBeInTheDocument();
  });
});
