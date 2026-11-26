import type { Principal } from '../../common/principal/principal.js';

/**
 * Decides who is calling. The scope never comes from a body or query
 * parameter: only from a User's access token (or, later, an API Key).
 */
export abstract class PrincipalResolver {
  abstract resolve(request: unknown): Principal | Promise<Principal>;
}
