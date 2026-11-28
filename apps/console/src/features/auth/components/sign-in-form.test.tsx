import { describe, expect, it } from 'vitest';
import { signInMessage } from './sign-in-form';

describe('signInMessage', () => {
  it('says the same thing for every credentials failure', () => {
    expect(signInMessage(401, 'INVALID_CREDENTIALS')).toBe('The email or password is not right.');
  });

  it('explains a deactivated account and a suspended Organization', () => {
    expect(signInMessage(403, 'ACCOUNT_DEACTIVATED')).toMatch(/deactivated/);
    expect(signInMessage(403, 'ORGANIZATION_SUSPENDED')).toMatch(/suspended/);
  });

  it('says so when the API cannot be reached', () => {
    expect(signInMessage(502, 'API_UNREACHABLE')).toMatch(/could not reach/);
  });
});
