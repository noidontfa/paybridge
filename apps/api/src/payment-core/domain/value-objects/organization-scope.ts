// The Organization scope (ADR 0006) is shared by every module that keeps
// Organization data, so it lives in `src/common`. Re-exported for Core's layers.
export {
  ALL_ORGANIZATIONS,
  organizationScope,
  type AllOrganizations,
  type OrganizationScope,
  type ReadScope,
} from '../../../common/organization-scope.js';
