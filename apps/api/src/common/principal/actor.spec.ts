import { actorLabel, isRole, roleOf } from './actor.js';

describe('the writer label', () => {
  it('shows a Super Admin as the platform', () => {
    expect(actorLabel({ role: 'SUPER_ADMIN' })).toBe('Super Admin (PayBridge)');
  });

  it.each(['ORGANIZATION_ADMIN', 'OPERATOR', null])(
    'shows nobody else as the platform (%s)',
    (role) => {
      expect(actorLabel({ role })).toBeNull();
    },
  );
});

describe('a Role read back from an audit record', () => {
  it('is one of the three Roles', () => {
    expect(roleOf('OPERATOR')).toBe('OPERATOR');
    expect(isRole('ORGANIZATION_ADMIN')).toBe(true);
  });

  it('fails on anything else', () => {
    expect(isRole('ADMIN')).toBe(false);
    expect(() => roleOf('ADMIN')).toThrow(/Unknown Role/);
  });
});
