import { describe, expect, it } from 'vitest';
import { isMockModeEnabled } from './mode';

describe('isMockModeEnabled', () => {
  it('is off by default', () => {
    expect(isMockModeEnabled({})).toBe(false);
    expect(isMockModeEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is on when the flag is "true" outside production', () => {
    expect(
      isMockModeEnabled({ CONSOLE_API_MOCKS: 'true', NODE_ENV: 'development' }),
    ).toBe(true);
    expect(isMockModeEnabled({ CONSOLE_API_MOCKS: 'true' })).toBe(true);
  });

  it('ignores any other flag value', () => {
    expect(isMockModeEnabled({ CONSOLE_API_MOCKS: '1' })).toBe(false);
    expect(isMockModeEnabled({ CONSOLE_API_MOCKS: 'false' })).toBe(false);
  });

  it('refuses to start in a production build', () => {
    expect(() =>
      isMockModeEnabled({ CONSOLE_API_MOCKS: 'true', NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });
});
