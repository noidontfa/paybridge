import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import {
  ORGANIZATION_HEADER,
  type Principal,
} from '../../../common/principal/principal.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import { AccessTokenService } from '../../domain/services/access-token.service.js';
import { IdentityClock } from '../../domain/services/clock.js';
import { PrincipalResolver } from '../../domain/services/principal-resolver.js';
import { AuthenticateApiKey } from '../../application/use-cases/api-keys.js';
import { InvalidApiKeyError } from '../../domain/entities/api-key.js';
import { AuthenticatePublishableKey } from '../../application/use-cases/publishable-keys.js';
import {
  CheckoutOrganizationSuspendedError,
  InvalidPublishableKeyError,
  OriginNotAllowedError,
} from '../../domain/entities/publishable-key.js';
import { HOST_ORIGIN_HEADER, isCheckoutPath } from './checkout-endpoint.js';

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
 * or expired token is refused. A checkout route (`/api/checkout/...`) needs a
 * Publishable Key presented from one of its allowed origins (ADR 0009). Every
 * other route is the public payments API, scoped by the API Key it carries.
 */
@Injectable()
export class HttpPrincipalResolver extends PrincipalResolver {
  constructor(
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(AuthenticateApiKey)
    private readonly apiKeys: AuthenticateApiKey,
    @Inject(AuthenticatePublishableKey)
    private readonly publishableKeys: AuthenticatePublishableKey,
  ) {
    super();
  }

  async resolve(request: unknown): Promise<Principal> {
    const req = request as RequestLike;
    const path = req.path ?? req.url ?? '';
    if (isCheckoutPath(path)) {
      return this.resolveCheckout(
        req.headers.authorization,
        req.headers.origin,
        req.headers[HOST_ORIGIN_HEADER],
      );
    }
    if (!path.startsWith(`/${INTERNAL_PREFIX}/`)) {
      return this.resolvePublic(path, req.headers.authorization);
    }

    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    const claims = match ? this.tokens.verify(match[1]!, this.clock.now()) : null;
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

  /**
   * A Customer's browser: only a Publishable Key, and only from one of its
   * allowed origins. An API Key is refused here like any unknown key.
   */
  private async resolveCheckout(
    authorization: string | string[] | undefined,
    origin: string | string[] | undefined,
    hostOrigin: string | string[] | undefined,
  ): Promise<Principal> {
    const match =
      typeof authorization === 'string'
        ? /^Bearer (\S+)$/.exec(authorization)
        : null;
    try {
      if (!match) throw new InvalidPublishableKeyError();
      const caller = await this.publishableKeys.execute(
        match[1]!,
        typeof origin === 'string' ? origin : undefined,
        typeof hostOrigin === 'string' ? hostOrigin : undefined,
      );
      return {
        organizationId: caller.organizationId,
        user: null,
        checkout: {
          publishableKeyId: caller.publishableKeyId,
          allowedOrigins: caller.allowedOrigins,
          origin: caller.origin,
        },
      };
    } catch (error) {
      if (error instanceof InvalidPublishableKeyError) {
        throw new UnauthorizedException({
          message: error.message,
          code: 'INVALID_PUBLISHABLE_KEY',
        });
      }
      if (error instanceof OriginNotAllowedError) {
        throw new ForbiddenException({
          message: error.message,
          code: 'ORIGIN_NOT_ALLOWED',
        });
      }
      if (error instanceof CheckoutOrganizationSuspendedError) {
        // The checkout's generic "unavailable" answer (checkout module).
        throw new UnprocessableEntityException({
          message: error.message,
          code: 'CHECKOUT_UNAVAILABLE',
          details: { reason: 'ORGANIZATION_SUSPENDED' },
        });
      }
      throw error;
    }
  }

  /**
   * The public payments API takes the Organization from the API Key. The two
   * routes that carry no key (the customer's browser return, and gateway
   * Callbacks) are `@Public()` and never reach the resolver.
   */
  private async resolvePublic(
    path: string,
    authorization: string | string[] | undefined,
  ): Promise<Principal> {
    const match =
      typeof authorization === 'string'
        ? /^Bearer (\S+)$/.exec(authorization)
        : null;
    try {
      if (!match) throw new InvalidApiKeyError();
      const { organizationId } = await this.apiKeys.execute(match[1]!);
      return { organizationId, user: null };
    } catch (error) {
      if (error instanceof InvalidApiKeyError) {
        throw new UnauthorizedException({
          message: error.message,
          code: 'INVALID_API_KEY',
        });
      }
      throw error;
    }
  }
}
