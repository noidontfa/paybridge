import type { Principal } from '../../common/principal/principal.js';

/**
 * Decides who is calling. Until sign-in exists (ticket 04), the only
 * implementation is the stub that returns a principal scoped to the default
 * Organization. The scope never comes from a body or query parameter.
 */
export abstract class PrincipalResolver {
  abstract resolve(request: unknown): Principal | Promise<Principal>;
}
