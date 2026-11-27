import { readEmail } from './email.js';

describe('the email the Customer types', () => {
  it.each([
    ['an@example.com', 'an@example.com'],
    ['  An.Nguyen+shop@Example.COM.vn ', 'an.nguyen+shop@example.com.vn'],
  ])('accepts %j as %j', (typed, email) => {
    expect(readEmail(typed)).toBe(email);
  });

  it.each([
    '',
    '   ',
    'an',
    'an@',
    '@example.com',
    'an@example',
    'an @example.com',
    'an@exa mple.com',
    'an..b@example.com',
    `${'a'.repeat(250)}@example.com`,
  ])('refuses %j', (typed) => {
    expect(readEmail(typed)).toBeNull();
  });
});
