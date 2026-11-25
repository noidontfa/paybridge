import type { NewOrganization, Organization } from '../domain/organization.js';

/** Persistence port for Organizations. Implemented in `infrastructure/prisma`. */
export abstract class OrganizationRepository {
  abstract findById(id: string): Promise<Organization | null>;
  abstract create(organization: NewOrganization): Promise<Organization>;
}
