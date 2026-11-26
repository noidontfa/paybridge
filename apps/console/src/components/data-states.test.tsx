import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ErrorState } from './data-states';

describe('ErrorState', () => {
  it('asks a Super Admin to choose an Organization instead of showing a failure', () => {
    const error = new ApiError({ status: 403, code: 'ORGANIZATION_REQUIRED', message: 'Choose one Organization to work in' });
    render(<ErrorState error={error} onRetry={vi.fn()} />);
    expect(screen.getByText('Choose an Organization')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('still shows other errors with a retry', () => {
    const error = new ApiError({ status: 500, code: 'BOOM', message: 'Broke' });
    render(<ErrorState error={error} onRetry={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
