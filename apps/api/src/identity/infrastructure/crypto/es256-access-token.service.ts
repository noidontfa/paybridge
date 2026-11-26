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

/**
 * Access JWTs signed with ES256 (ADR 0008). Anyone holding the published
 * public key (the JWKS) can verify a token; no lookup is needed.
 */
export class Es256AccessTokenService extends AccessTokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly kid: string;

  /** `privatePem`: a PKCS#8 PEM EC (P-256) key; omitted => a fresh key (dev, tests). */
  constructor(privatePem?: string) {
    super();
    if (privatePem) {
      this.privateKey = createPrivateKey(privatePem.replace(/\\n/g, '\n'));
      this.publicKey = createPublicKey(this.privateKey);
    } else {
      const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
    }
    const jwk = this.publicKey.export({ format: 'jwk' });
    // RFC 7638 thumbprint as the key id.
    this.kid = createHash('sha256')
      .update(
        JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
      )
      .digest('base64url');
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
      if (head.alg !== 'ES256' || head.kid !== this.kid) return null;
      const valid = verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key: this.publicKey, dsaEncoding: 'ieee-p1363' },
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
      keys: [
        {
          ...this.publicKey.export({ format: 'jwk' }),
          kid: this.kid,
          alg: 'ES256',
          use: 'sig',
        },
      ],
    };
  }
}
