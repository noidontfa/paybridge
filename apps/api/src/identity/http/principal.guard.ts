import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { PRINCIPAL_REQUEST_KEY } from '../../common/principal/principal.js';
import { PrincipalResolver } from '../port/principal-resolver.js';

/** Global guard: attaches the resolved principal to every request. */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    @Inject(PrincipalResolver) private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    request[PRINCIPAL_REQUEST_KEY] = await this.resolver.resolve(request);
    return true;
  }
}
