import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCESS_POLICY_KEY,
  type AccessPolicy,
} from '../../../common/principal/access-policy.js';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../../common/principal/principal.js';
import { permissionsOf, type Permission } from '../../domain/permissions.js';
import { OrganizationRepository } from '../../domain/repositories/organization.repository.js';
import { UserRepository } from '../../domain/repositories/user.repository.js';
import { IS_PUBLIC } from './principal.guard.js';

const refuse = (message: string, code: string): never => {
  throw new ForbiddenException({ message, code });
};

/**
 * Global guard, after `PrincipalGuard`: decides by Permission, never by Role
 * name. A signed-in caller on an operator route that declares no access
 * policy is refused, so a new route is closed until it is classified.
 *
 * A sensitive write also re-reads the User, their Role and their
 * Organization in the database, so deactivation, a Role change and
 * suspension block it at once (ADR 0008). Reads trust the access token.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal | undefined;
    // The public payments API belongs to an API Key, not a User: no policy applies.
    if (!principal?.user) return true;

    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY_KEY,
      targets,
    );
    if (!policy) return refuse('This action is not available', 'FORBIDDEN');
    if (policy.permission === null) return true;
    const required: Permission = policy.permission;
    if (!principal.user.permissions.includes(required)) {
      return refuse(`Missing permission ${required}`, 'FORBIDDEN');
    }
    if (!policy.sensitive) return true;

    request[PRINCIPAL_REQUEST_KEY] = await this.recheck(principal, required);
    return true;
  }

  private async recheck(
    principal: Principal,
    required: Permission,
  ): Promise<Principal> {
    const claimed = principal.user!;
    const user = await this.users.findById(claimed.id);
    if (!user || !user.active) {
      return refuse('This account is deactivated', 'ACCOUNT_DEACTIVATED');
    }
    if (user.role !== claimed.role) {
      return refuse('Your Role has changed; sign in again', 'ROLE_CHANGED');
    }
    if (!permissionsOf(user.role).includes(required)) {
      return refuse(`Missing permission ${required}`, 'FORBIDDEN');
    }
    // A Super Admin acts for the platform: a suspended Organization does not
    // stop them. Everyone else is bound to their own Organization.
    if (user.organizationId) {
      const organization = await this.organizations.findById(
        user.organizationId,
      );
      if (!organization || organization.status !== 'ACTIVE') {
        return refuse('Your Organization is suspended', 'ORGANIZATION_SUSPENDED');
      }
    }
    return { ...principal, user: { ...claimed, name: user.name } };
  }
}
