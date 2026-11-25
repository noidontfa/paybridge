import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getEnvironment } = await import('./environment');

describe('server environment', () => {
  it('reports the configured API base URL and mock mode', () => {
    const env = getEnvironment({
      CONSOLE_API_BASE_URL: 'http://api.internal:4000',
      CONSOLE_API_MOCKS: 'true',
    });
    expect(env.apiBaseUrl).toBe('http://api.internal:4000');
    expect(env.mockMode).toBe(true);
    expect(env.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('defaults to the local API with mocks off', () => {
    const env = getEnvironment({});
    expect(env.apiBaseUrl).toBe('http://localhost:3000');
    expect(env.mockMode).toBe(false);
  });
});
