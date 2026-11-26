import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { ACCESS_TOKEN_TTL_MS } from '../../domain/refresh-token.js';
import { PERMISSIONS, type Permission } from '../../domain/permissions.js';
import { USER_ROLES, type UserRole } from '../../domain/user.js';
import {
  AccessTokenService,
  type AccessClaims,
  type JsonWebKeySet,
} from '../../port/access-token.service.js';

export const TOKEN_ISSUER = 'paybridge';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const thumbprint = (key: KeyObject): string => {
  const jwk = key.export({ format: 'jwk' });
  // RFC 7638 thumbprint as the key id.
  return createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest('base64url');
};

const unescapePem = (pem: string): string => pem.replace(/\\n/g, '\n');

/**
 * Access JWTs signed with ES256 (ADR 0008). Anyone holding the published
 * public keys (the JWKS) can verify a token; no lookup is needed.
 *
 * Rotation: sign with the current key and keep the previous public keys as
 * retired keys. Tokens carry their `kid`, so tokens signed before the
 * rotation still verify (and are published in the JWKS) until the retired
 * key is dropped, after the access-token lifetime.
 */
export class Es256AccessTokenService extends AccessTokenService {
  private readonly privateKey: KeyObject;
  private readonly kid: string;
  /** Verification keys by `kid`: the current key first, then the retired ones. */
  private readonly verificationKeys = new Map<string, KeyObject>();

  /**
   * `privatePem`: a PKCS#8 PEM EC (P-256) key; omitted => a fresh key (dev,
   * tests). `retiredPublicPems`: public keys (SPKI PEM) of earlier signing keys.
   */
  constructor(
    privatePem?: string,
    retiredPublicPems: readonly string[] = [],
  ) {
    super();
    let publicKey: KeyObject;
    if (privatePem) {
      this.privateKey = createPrivateKey(unescapePem(privatePem));
      publicKey = createPublicKey(this.privateKey);
    } else {
      const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      this.privateKey = pair.privateKey;
      publicKey = pair.publicKey;
    }
    this.kid = thumbprint(publicKey);
    this.verificationKeys.set(this.kid, publicKey);
    for (const pem of retiredPublicPems) {
      const retired = createPublicKey(unescapePem(pem));
      this.verificationKeys.set(thumbprint(retired), retired);
    }
  }

  sign(claims: AccessClaims, now: Date): string {
    const iat = Math.floor(now.getTime() / 1000);
    const header = encode({ alg: 'ES256', typ: 'JWT', kid: this.kid });
    const payload = encode({
      iss: TOKEN_ISSUER,
      sub: claims.userId,
      role: claims.role,
      ...(claims.organizationId && { org: claims.organizationId }),
      permissions: claims.permissions,
      iat,
      exp: iat + Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    });
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: this.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `${header}.${payload}.${signature.toString('base64url')}`;
  }

  verify(token: string, now: Date): AccessClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];
    try {
      const head = JSON.parse(
        Buffer.from(header, 'base64url').toString('utf8'),
      ) as { alg?: unknown; kid?: unknown };
      const key =
        typeof head.kid === 'string'
          ? this.verificationKeys.get(head.kid)
          : undefined;
      if (head.alg !== 'ES256' || !key) return null;
      const valid = verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      );
      if (!valid) return null;
      const body = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        body.iss !== TOKEN_ISSUER ||
        typeof body.exp !== 'number' ||
        now.getTime() >= body.exp * 1000 ||
        typeof body.sub !== 'string' ||
        !USER_ROLES.includes(body.role as UserRole) ||
        !Array.isArray(body.permissions)
      ) {
        return null;
      }
      return {
        userId: body.sub,
        role: body.role as UserRole,
        organizationId: typeof body.org === 'string' ? body.org : null,
        permissions: body.permissions.filter((p): p is Permission =>
          PERMISSIONS.includes(p as Permission),
        ),
      };
    } catch {
      return null;
    }
  }

  jwks(): JsonWebKeySet {
    return {
      keys: [...this.verificationKeys].map(([kid, key]) => ({
        ...key.export({ format: 'jwk' }),
        kid,
        alg: 'ES256',
        use: 'sig',
      })),
    };
  }
}
