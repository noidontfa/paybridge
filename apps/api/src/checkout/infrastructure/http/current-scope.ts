import {
  createParamDecorator,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../../common/principal/principal.js';
import {
  organizationScope,
  type OrganizationScope,
} from '../../../payment-core/port/organization-scope.js';
import type { PricingPlanEditor } from '../../domain/entities/pricing-plan.js';

function principalOf(context: ExecutionContext): Principal {
  const request = context.switchToHttp().getRequest<Record<string, unknown>>();
  const principal = request[PRINCIPAL_REQUEST_KEY] as Principal | undefined;
  if (!principal) throw new UnauthorizedException();
  return principal;
}

/**
 * The one Organization the caller works in (ADR 0006), from the principal
 * identity attached, never from the request body. A Super Admin must choose
 * one; "all Organizations" is not one.
 */
export const CheckoutScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationScope => {
    const principal = principalOf(context);
    if (!principal.organizationId) {
      throw new ForbiddenException({
        message: 'Choose one Organization to work in',
        code: 'ORGANIZATION_REQUIRED',
      });
    }
    return organizationScope(principal.organizationId);
  },
);

/** The signed-in User making a change, with the name a sensitive write re-read. */
export const CheckoutEditor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PricingPlanEditor => {
    const { user } = principalOf(context);
    if (!user) throw new UnauthorizedException();
    return { userId: user.id, role: user.role, name: user.name ?? '' };
  },
);
