import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Principal } from '../../common/principal/principal.js';
import { INTERNAL_PREFIX } from '../../constants.js';
import { AccessTokenService } from '../port/access-token.service.js';
import { IdentityClock } from '../port/clock.js';
import { PrincipalResolver } from '../port/principal-resolver.js';
import { StubPrincipalResolver } from './stub-principal.resolver.js';

interface RequestLike {
  readonly path?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * Who is calling. An operator route (`/internal/...`) needs the access token
 * of a User, verified with the public key only: a missing, malformed, forged
 * or expired token is refused. Every other route is the public payments API,
 * still on the stub until API Keys arrive (ticket 09).
 */
@Injectable()
export class HttpPrincipalResolver extends PrincipalResolver {
  constructor(
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(StubPrincipalResolver)
    private readonly publicApi: StubPrincipalResolver,
  ) {
    super();
  }

  resolve(request: unknown): Principal {
    const req = request as RequestLike;
    const path = req.path ?? req.url ?? '';
    if (!path.startsWith(`/${INTERNAL_PREFIX}/`)) return this.publicApi.resolve();

    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    const claims = match ? this.tokens.verify(match[1]!, this.clock.now()) : null;
    if (!claims) {
      throw new UnauthorizedException({
        message: 'A valid access token is required',
        code: 'UNAUTHENTICATED',
      });
    }
    return {
      organizationId: claims.organizationId,
      user: {
        id: claims.userId,
        role: claims.role,
        permissions: claims.permissions,
      },
    };
  }
}
