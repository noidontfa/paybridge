import {
  createParamDecorator,
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
    return organizationScope(principal.organizationId);
  },
);
