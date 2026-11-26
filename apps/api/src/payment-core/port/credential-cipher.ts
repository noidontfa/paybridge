// Encryption at rest for secrets other modules hold (AES-256-GCM, rotating
// identified keys from GATEWAY_CREDENTIAL_KEYS).
export type { SealedValue } from '../domain/services/credential-cipher.js';
export { AesCredentialCipher } from '../infrastructure/crypto/credential-cipher.js';
