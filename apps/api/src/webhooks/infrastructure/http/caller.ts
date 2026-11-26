import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../../common/principal/principal.js';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
  type OrganizationScope,
  type ReadScope,
} from '../../../payment-core/port/organization-scope.js';
import type { Actor } from '../../domain/entities/webhook-endpoint.js';

type SignedIn = Principal & { user: NonNullable<Principal['user']> };

function principalOf(request: Record<string, unknown>): SignedIn {
  const principal = request[PRINCIPAL_REQUEST_KEY] as Principal | undefined;
  if (!principal?.user) throw new UnauthorizedException();
  return principal as SignedIn;
}

/** The Organization the caller works in (ADR 0006), and who they are. */
export function callerOf(request: Record<string, unknown>): {
  scope: OrganizationScope;
  actor: Actor;
} {
  const principal = principalOf(request);
  const { user } = principal;
  if (!principal.organizationId) {
    throw new ForbiddenException({
      message: 'Choose one Organization to work in',
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  return {
    scope: organizationScope(principal.organizationId),
    actor: { userId: user.id, role: user.role, name: user.name ?? '' },
  };
}

/**
 * The scope of a read: the caller's Organization, or for a Super Admin who
 * chose "all Organizations", every one. Never use it for a write.
 */
export function readScopeOf(request: Record<string, unknown>): ReadScope {
  const principal = principalOf(request);
  if (principal.allOrganizations) return ALL_ORGANIZATIONS;
  if (!principal.organizationId) {
    throw new ForbiddenException({
      message: 'Choose an Organization, or all Organizations, to read',
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  return organizationScope(principal.organizationId);
}
