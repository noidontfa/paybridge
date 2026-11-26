import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  CredentialCipher,
  UnknownCredentialKeyError,
  type SealedValue,
} from '../../domain/services/credential-cipher.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class InvalidCredentialKeysError extends Error {
  override readonly name = 'InvalidCredentialKeysError';
}

/**
 * AES-256-GCM over gateway credentials, with identified keys. The first key
 * of the configuration encrypts; every key can decrypt, so a key can be
 * rotated by prepending a new one and re-encrypting the rows. A sealed
 * `ciphertext` is base64 of nonce (12) + auth tag (16) + ciphertext.
 */
export class AesCredentialCipher extends CredentialCipher {
  private constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    readonly primaryKeyId: string,
  ) {
    super();
  }

  /** `id:base64key,id2:base64key2`; each key is 32 bytes; the first is primary. */
  static fromConfig(config: string): AesCredentialCipher {
    const keys = new Map<string, Buffer>();
    let primary: string | undefined;
    for (const entry of config.split(',').map((e) => e.trim())) {
      const at = entry.indexOf(':');
      const id = at > 0 ? entry.slice(0, at) : '';
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new InvalidCredentialKeysError(
          'Each credential key must be written id:base64key',
        );
      }
      const key = Buffer.from(entry.slice(at + 1), 'base64');
      if (key.length !== KEY_BYTES) {
        throw new InvalidCredentialKeysError(
          `Credential key "${id}" must be ${KEY_BYTES} bytes (base64)`,
        );
      }
      if (keys.has(id)) {
        throw new InvalidCredentialKeysError(
          `Credential key id "${id}" appears twice`,
        );
      }
      keys.set(id, key);
      primary ??= id;
    }
    if (!primary) {
      throw new InvalidCredentialKeysError('No credential key is configured');
    }
    return new AesCredentialCipher(keys, primary);
  }

  encrypt(plaintext: string): SealedValue {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.primaryKeyId)!,
      iv,
    );
    const body = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
        'base64',
      ),
      keyId: this.primaryKeyId,
    };
  }

  decrypt(sealed: SealedValue): string {
    const key = this.keys.get(sealed.keyId);
    if (!key) throw new UnknownCredentialKeyError(sealed.keyId);
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      bytes.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
