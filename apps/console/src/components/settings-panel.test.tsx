import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './settings-panel';

const environment = { apiBaseUrl: 'http://api.internal:3000', mockMode: true, version: '1.2.3' };

function renderPanel() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system">
      <SettingsPanel environment={environment} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  delete document.documentElement.dataset.density;
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

describe('Settings', () => {
  it('shows the server-provided environment, read-only', () => {
    renderPanel();
    expect(screen.getByText('http://api.internal:3000')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
  });

  it('shows mock mode off', () => {
    render(
      <ThemeProvider attribute="class">
        <SettingsPanel environment={{ ...environment, mockMode: false }} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('switches the theme and remembers it', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('remembers the table density and applies it', async () => {
    renderPanel();
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(window.localStorage.getItem('paybridge.density')).toBe('compact');
    expect(document.documentElement.dataset.density).toBe('compact');
  });

  it('restores a remembered density on load', async () => {
    window.localStorage.setItem('paybridge.density', 'compact');
    renderPanel();
    expect(await screen.findByRole('radio', { name: 'Compact' })).toBeChecked();
  });

  it('still works when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderPanel();
    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked();
    vi.restoreAllMocks();
  });
});
