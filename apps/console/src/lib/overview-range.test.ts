import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGE, overviewHref, parseRange } from './overview-range';

describe('overview range in the URL', () => {
  it('reads a valid range and falls back to the default', () => {
    expect(parseRange('24h')).toBe('24h');
    expect(parseRange('30d')).toBe('30d');
    expect(parseRange('90d')).toBe(DEFAULT_RANGE);
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
    expect(parseRange(['7d', '24h'])).toBe('7d');
  });

  it('writes the range, leaving the default out of the URL', () => {
    expect(overviewHref('24h')).toBe('/?range=24h');
    expect(overviewHref(DEFAULT_RANGE)).toBe('/');
  });
});
