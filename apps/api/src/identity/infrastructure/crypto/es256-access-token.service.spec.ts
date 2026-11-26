import { generateKeyPairSync } from 'node:crypto';
import type { AccessClaims } from '../../domain/services/access-token.service.js';
import { Es256AccessTokenService } from './es256-access-token.service.js';

const NOW = new Date('2026-05-01T10:00:00.000Z');
const CLAIMS: AccessClaims = {
  userId: 'u1',
  role: 'OPERATOR',
  organizationId: 'o1',
  permissions: [],
};

function keyPair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: pair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('Es256AccessTokenService key rotation', () => {
  it('verifies tokens signed by a retired key and publishes both keys', () => {
    const oldKey = keyPair();
    const before = new Es256AccessTokenService(oldKey.privatePem);
    const token = before.sign(CLAIMS, NOW);

    const rotated = new Es256AccessTokenService(keyPair().privatePem, [
      oldKey.publicPem,
    ]);
    expect(rotated.verify(token, NOW)?.userId).toBe('u1');
    expect(rotated.verify(rotated.sign(CLAIMS, NOW), NOW)?.userId).toBe('u1');
    expect(rotated.jwks().keys).toHaveLength(2);
    expect(rotated.jwks().keys.map((k) => k.kid)).toEqual(
      expect.arrayContaining(before.jwks().keys.map((k) => k.kid)),
    );
  });

  it('refuses the old tokens once the retired key is dropped', () => {
    const token = new Es256AccessTokenService(keyPair().privatePem).sign(
      CLAIMS,
      NOW,
    );
    const rotated = new Es256AccessTokenService(keyPair().privatePem);
    expect(rotated.verify(token, NOW)).toBeNull();
    expect(rotated.jwks().keys).toHaveLength(1);
  });

  it('tokens of the new key do not verify on the old service', () => {
    const oldKey = keyPair();
    const old = new Es256AccessTokenService(oldKey.privatePem);
    const rotated = new Es256AccessTokenService(keyPair().privatePem, [
      oldKey.publicPem,
    ]);
    expect(old.verify(rotated.sign(CLAIMS, NOW), NOW)).toBeNull();
  });
});
