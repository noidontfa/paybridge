import { describe, expect, it } from 'vitest';
import { newPasswordProblem, passwordMessage } from './password-forms';

describe('newPasswordProblem', () => {
  it('refuses a password shorter than 12 characters', () => {
    expect(newPasswordProblem('short-pass1', 'short-pass1')).toMatch(/at least 12/);
  });

  it('refuses two different passwords', () => {
    expect(newPasswordProblem('a-long-enough-password', 'another-long-password')).toMatch(/not the same/);
  });

  it('accepts 12 characters that match', () => {
    expect(newPasswordProblem('exactly12chr', 'exactly12chr')).toBeNull();
  });
});

describe('passwordMessage', () => {
  it('explains an expired link and a wrong current password', () => {
    expect(passwordMessage(400, 'INVALID_RESET_TOKEN')).toMatch(/expired/);
    expect(passwordMessage(400, 'INVALID_CURRENT_PASSWORD')).toMatch(/current password/);
  });
});
