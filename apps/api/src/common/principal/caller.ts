import {
  createParamDecorator,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ALL_ORGANIZATIONS,
  organizationScope,
  type OrganizationScope,
  type ReadScope,
} from '../organization-scope.js';
import { roleOf, type Actor } from './actor.js';
import { PRINCIPAL_REQUEST_KEY, type Principal } from './principal.js';

// The caller of an operator route, for every module's controllers: the
// Organization scope (ADR 0006) and the acting User. Both come from the
// principal the identity module attached to the request, never from a body,
// query or path parameter.

type Request = Record<string, unknown>;

function principalOf(request: Request): Principal {
  const principal = request[PRINCIPAL_REQUEST_KEY] as Principal | undefined;
  if (!principal) throw new UnauthorizedException();
  return principal;
}

/**
 * The one Organization the caller works in. A Super Admin belongs to none:
 * a write, or an ordinary read, needs exactly one chosen Organization ("all"
 * is not one).
 */
export function organizationScopeOf(request: Request): OrganizationScope {
  const { organizationId } = principalOf(request);
  if (!organizationId) {
    throw new ForbiddenException({
      message: 'Choose one Organization to work in',
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  return organizationScope(organizationId);
}

/**
 * The scope of an operator read model: the caller's Organization, or for a
 * Super Admin who chose "all Organizations", every one. Never use it for a
 * write.
 */
export function readScopeOf(request: Request): ReadScope {
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

/** The signed-in User making a change. */
export function actorOf(request: Request): Actor {
  const { user } = principalOf(request);
  if (!user) throw new UnauthorizedException();
  return { userId: user.id, role: roleOf(user.role), name: user.name ?? '' };
}

/** A write's caller: who they are and the one Organization they write in. */
export function callerOf(request: Request): {
  scope: OrganizationScope;
  actor: Actor;
} {
  const actor = actorOf(request);
  return { scope: organizationScopeOf(request), actor };
}

const requestOf = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<Request>();

/** `organizationScopeOf` as a parameter decorator. */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationScope =>
    organizationScopeOf(requestOf(context)),
);

/** `readScopeOf` as a parameter decorator. */
export const CurrentReadScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ReadScope =>
    readScopeOf(requestOf(context)),
);

/** `actorOf` as a parameter decorator. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor =>
    actorOf(requestOf(context)),
);
