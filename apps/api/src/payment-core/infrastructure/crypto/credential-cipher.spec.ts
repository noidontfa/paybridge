import { randomBytes } from 'node:crypto';
import {
  CredentialCipher,
  InvalidCredentialKeysError,
  UnknownCredentialKeyError,
} from './credential-cipher.js';

const key = () => randomBytes(32).toString('base64');

describe('CredentialCipher', () => {
  it('round-trips a value under the primary key and names that key', () => {
    const cipher = CredentialCipher.fromConfig(`k1:${key()}`);
    const sealed = cipher.encrypt('{"secretKey":"sk_test_1"}');

    expect(sealed.keyId).toBe('k1');
    expect(sealed.ciphertext).not.toContain('sk_test_1');
    expect(cipher.decrypt(sealed)).toBe('{"secretKey":"sk_test_1"}');
  });

  it('uses a fresh nonce each time', () => {
    const cipher = CredentialCipher.fromConfig(`k1:${key()}`);
    expect(cipher.encrypt('x').ciphertext).not.toBe(
      cipher.encrypt('x').ciphertext,
    );
  });

  it('encrypts with the first key and still decrypts with the others', () => {
    const k1 = key();
    const k2 = key();
    const old = CredentialCipher.fromConfig(`k1:${k1}`).encrypt('secret');
    const rotated = CredentialCipher.fromConfig(`k2:${k2},k1:${k1}`);

    expect(rotated.primaryKeyId).toBe('k2');
    expect(rotated.decrypt(old)).toBe('secret');
    expect(rotated.encrypt('secret').keyId).toBe('k2');
  });

  it('refuses a key id it does not hold', () => {
    const sealed = CredentialCipher.fromConfig(`k1:${key()}`).encrypt('s');
    const other = CredentialCipher.fromConfig(`k9:${key()}`);
    expect(() => other.decrypt(sealed)).toThrow(UnknownCredentialKeyError);
  });

  it('detects tampering', () => {
    const cipher = CredentialCipher.fromConfig(`k1:${key()}`);
    const sealed = cipher.encrypt('secret');
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(() =>
      cipher.decrypt({ ...sealed, ciphertext: bytes.toString('base64') }),
    ).toThrow();
  });

  it.each([
    ['empty', ''],
    ['no id', `:${key()}`],
    ['short key', 'k1:' + Buffer.alloc(16).toString('base64')],
    ['duplicate id', `k1:${key()},k1:${key()}`],
    ['no separator', 'abc'],
  ])('rejects a malformed key list (%s)', (_name, config) => {
    expect(() => CredentialCipher.fromConfig(config)).toThrow(
      InvalidCredentialKeysError,
    );
  });
});
