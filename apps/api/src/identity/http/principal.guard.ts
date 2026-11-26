import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PRINCIPAL_REQUEST_KEY } from '../../common/principal/principal.js';
import { PrincipalResolver } from '../port/principal-resolver.js';

export const IS_PUBLIC = 'identity:public';

/** Marks an operator route that needs no access token (sign-in and the like). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC, true);

/** Global guard: attaches the resolved principal to every request. */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    @Inject(PrincipalResolver) private readonly resolver: PrincipalResolver,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    request[PRINCIPAL_REQUEST_KEY] = await this.resolver.resolve(request);
    return true;
  }
}
