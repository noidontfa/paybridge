import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/principal/principal.js';
import { DEFAULT_ORGANIZATION_ID } from '../domain/organization.js';
import { PrincipalResolver } from '../port/principal-resolver.js';

/**
 * Temporary: no sign-in exists yet, so every caller is scoped to the default
 * Organization. Ticket 04 replaces this with the User's access token, and
 * ticket 09 adds API Keys.
 */
@Injectable()
export class StubPrincipalResolver extends PrincipalResolver {
  resolve(): Principal {
    return { organizationId: DEFAULT_ORGANIZATION_ID };
  }
}
