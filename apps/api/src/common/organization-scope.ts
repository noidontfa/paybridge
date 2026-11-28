// The Organization scope every repository method takes first (ADR 0006): in
// Payment Core, checkout, webhooks and identity's Publishable Keys.
//
// Isolation is enforced in application code, not by Postgres RLS: a query that
// touches Organization data names the Organization it is allowed to see, and
// `isolation.spec.ts` fails the build when a repository method has no scope.
// The scope comes from the authenticated principal, never from a request body
// or query parameter.

/** Exactly one Organization: what writes and ordinary reads use. */
export interface OrganizationScope {
  readonly kind: 'organization';
  readonly organizationId: string;
}

/**
 * Every Organization. Only operator read models for a Super Admin, and system
 * jobs (sweeps, workers, retention) that act on ids they already hold, may
 * ask for it, and they must say so explicitly.
 */
export interface AllOrganizations {
  readonly kind: 'all';
}

/** What a read accepts: one Organization, or all of them when asked for. */
export type ReadScope = OrganizationScope | AllOrganizations;

export const ALL_ORGANIZATIONS: AllOrganizations = { kind: 'all' };

export function organizationScope(organizationId: string): OrganizationScope {
  return { kind: 'organization', organizationId };
}
