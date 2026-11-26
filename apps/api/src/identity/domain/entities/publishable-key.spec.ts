import {
  InvalidAllowedOriginsError,
  isOriginAllowed,
  normaliseAllowedOrigins,
} from './publishable-key.js';

// The rules behind a Publishable Key's allowed origins. The HTTP behaviour is
// covered in test/identity/publishable-keys.int-spec.ts; production is not
// reachable there, so its rule is pinned here.

const production = { allowLocalhost: false };
const development = { allowLocalhost: true };

describe('allowed origins in production', () => {
  it.each([
    'http://localhost:5173',
    'https://localhost',
    'http://app.localhost:3000',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
  ])('refuses the local origin %s', (origin) => {
    expect(() => normaliseAllowedOrigins([origin], production)).toThrow(
      InvalidAllowedOriginsError,
    );
  });

  it('accepts public https origins', () => {
    expect(
      normaliseAllowedOrigins(['https://shop.example.com'], production),
    ).toEqual(['https://shop.example.com']);
  });
});

describe('allowed origins outside production', () => {
  it('accepts local origins over http', () => {
    expect(
      normaliseAllowedOrigins(
        ['http://localhost:5173', 'http://[::1]:8080'],
        development,
      ),
    ).toEqual(['http://localhost:5173', 'http://[::1]:8080']);
  });

  it('still requires https on a public host', () => {
    expect(() =>
      normaliseAllowedOrigins(['http://shop.example.com'], development),
    ).toThrow(InvalidAllowedOriginsError);
  });

  it('refuses more than 20 origins', () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://s${i}.example.com`);
    expect(() => normaliseAllowedOrigins(many, development)).toThrow(
      InvalidAllowedOriginsError,
    );
  });
});

describe('matching a request Origin', () => {
  const key = { allowedOrigins: ['https://shop.example.com'] };

  it.each([
    ['the exact origin', 'https://shop.example.com', true],
    ['the default port spelt out', 'https://shop.example.com:443', true],
    ['another port', 'https://shop.example.com:444', false],
    ['a subdomain', 'https://www.shop.example.com', false],
    ['no Origin', undefined, false],
    ['the opaque origin', 'null', false],
  ])('%s → %s', (_name, origin, allowed) => {
    expect(isOriginAllowed(key, origin)).toBe(allowed);
  });
});
