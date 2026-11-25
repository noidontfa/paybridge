import {
  createParamDecorator,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../common/principal/principal.js';
import {
  organizationScope,
  type OrganizationScope,
} from '../domain/organization-scope.js';

/**
 * The Organization scope of the authenticated caller (ADR 0006). It comes
 * from the principal the identity module attached to the request, never from
 * a body, query or path parameter.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationScope => {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal | undefined;
    if (!principal) throw new UnauthorizedException();
    if (!principal.organizationId) {
      // A Super Admin belongs to no Organization; choosing one comes later.
      throw new ForbiddenException({
        message: 'Choose an Organization to work in',
        code: 'ORGANIZATION_REQUIRED',
      });
    }
    return organizationScope(principal.organizationId);
  },
);

/** Who is acting: the signed-in User and the Role they hold now. */
export interface Actor {
  readonly userId: string;
  readonly role: string;
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal | undefined;
    if (!principal?.user) throw new UnauthorizedException();
    return { userId: principal.user.id, role: principal.user.role };
  },
);
