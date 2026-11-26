// The Organization scope (ADR 0006), for modules whose repositories follow
// the same rule as Core's: a scope is the first parameter of every method.
export {
  ALL_ORGANIZATIONS,
  organizationScope,
} from '../domain/value-objects/organization-scope.js';
export type {
  AllOrganizations,
  OrganizationScope,
  ReadScope,
} from '../domain/value-objects/organization-scope.js';
