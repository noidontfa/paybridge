/** An encrypted value and the id of the key that sealed it. */
export interface SealedValue {
  /** Opaque to callers; what the cipher returns is what it accepts back. */
  readonly ciphertext: string;
  readonly keyId: string;
}

/** The row names an encrypting key this process does not hold. */
export class UnknownCredentialKeyError extends Error {
  override readonly name = 'UnknownCredentialKeyError';

  constructor(readonly keyId: string) {
    super(`No credential encryption key "${keyId}" is configured`);
  }
}

/**
 * Seals and opens gateway credentials. Keys are identified, so a key can be
 * rotated: new values are sealed with the primary key, and a value sealed with
 * an older key still opens while that key is configured.
 *
 * Nest injects it by this abstract class; `infrastructure/crypto` provides the
 * real one, and a unit test can provide a fake.
 */
export abstract class CredentialCipher {
  /** The id of the key `encrypt` seals with. */
  abstract readonly primaryKeyId: string;

  abstract encrypt(plaintext: string): SealedValue;

  /** Throws `UnknownCredentialKeyError` when the sealing key is not held. */
  abstract decrypt(sealed: SealedValue): string;
}
