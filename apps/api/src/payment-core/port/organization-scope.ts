// Part of Payment Core's public surface for other modules (checkout, webhooks):
// the Organization scope every repository method takes first (ADR 0006), so
// all modules share one definition of "which Organization may be seen".
export {
  ALL_ORGANIZATIONS,
  organizationScope,
  type AllOrganizations,
  type OrganizationScope,
  type ReadScope,
} from '../domain/value-objects/organization-scope.js';
