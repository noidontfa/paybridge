import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import {
  ORGANIZATION_HEADER,
  type Principal,
} from '../../common/principal/principal.js';
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
 * A Super Admin belongs to no Organization: they choose one (a UUID) or
 * "all" (reads only) in the `X-Organization-Id` header. Choosing nothing
 * leaves the scope empty, which every Organization-scoped call refuses.
 */
function superAdminScope(
  header: string | string[] | undefined,
): Pick<Principal, 'organizationId' | 'allOrganizations'> {
  const value = typeof header === 'string' ? header.trim() : '';
  if (!value) return { organizationId: null };
  if (value.toLowerCase() === 'all') {
    return { organizationId: null, allOrganizations: true };
  }
  if (!isUuid(value)) {
    throw new BadRequestException({
      message: `${ORGANIZATION_HEADER} must be an Organization id or "all"`,
      code: 'INVALID_ORGANIZATION',
    });
  }
  return { organizationId: value.toLowerCase() };
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
    if (!path.startsWith(`/${INTERNAL_PREFIX}/`))
      return this.publicApi.resolve();

    const header = req.headers.authorization;
    const match =
      typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    const claims = match
      ? this.tokens.verify(match[1]!, this.clock.now())
      : null;
    if (!claims) {
      throw new UnauthorizedException({
        message: 'A valid access token is required',
        code: 'UNAUTHENTICATED',
      });
    }
    const user = {
      id: claims.userId,
      role: claims.role,
      permissions: claims.permissions,
    };
    if (claims.role === 'SUPER_ADMIN') {
      return { ...superAdminScope(req.headers[ORGANIZATION_HEADER]), user };
    }
    // Everyone else works in the Organization their token names; a header
    // naming another one is ignored.
    return { organizationId: claims.organizationId, user };
  }
}
