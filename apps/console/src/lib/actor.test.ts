import { describe, expect, it } from 'vitest';
import { actorText } from './actor';

describe('actorText', () => {
  it('shows the actor as recorded for system and Organization actors', () => {
    expect(actorText({ actor: 'system' })).toBe('system');
  });

  it("labels the platform with the Super Admin's name", () => {
    expect(actorText({ actor: 'u1', actorName: 'Sam Super', actorLabel: 'Super Admin (PayBridge)' })).toBe(
      'Super Admin (PayBridge): Sam Super',
    );
  });
});
