import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/principal/principal.js';
import { DEFAULT_ORGANIZATION_ID } from '../domain/organization.js';

/**
 * Temporary: the public payments API has no API Keys yet, so its callers are
 * scoped to the default Organization. Ticket 09 replaces this with API Keys.
 * Operator routes never use it: they need a User's access token.
 */
@Injectable()
export class StubPrincipalResolver {
  resolve(): Principal {
    return { organizationId: DEFAULT_ORGANIZATION_ID, user: null };
  }
}
